from django.core.management.base import BaseCommand
from connectome.models import NeuronClass
from activity.models import (
    GCaMPDataset,
    GCaMPNeuron,
    GCaMPPaper,
    GCaMPDatasetType,
    GCaMPEventStyle,
)
import numpy as np
import time
import json
import os
from core.utility import sha256

PATH_CONFIG_GCAMP_NEURON_MAP = ["config", "gcamp_neuron_name_map_manual.json"]
PATH_CONFIG_GCAMP_CLASS_MAP = ["config", "gcamp_neuron_class_name_map_manual.json"]
PATH_PAPER = ["activity", "papers.json"]
PATH_TYPE = ["activity", "dataset_types.json"]
PATH_EVENT_STYLE = ["activity", "event_styles.json"]

"""

Paths, import

"""


def get_dataset_path(list_part):
    current_dir = os.getcwd()
    parent_dir = os.path.dirname(current_dir)

    return os.path.join(parent_dir, "initial_data", *list_part)


def load_json(self, path_json):
    if not os.path.exists(path_json):
        self.stdout.write(self.style.ERROR(f"{path_json} does not exists"))
    with open(path_json, "r") as file:
        return json.load(file)


"""

Math functions

"""


class NumpyEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        return super().default(obj)


def truncate_numpy_array(array, n=6):
    factor = 10.0**n
    return np.trunc(array * factor) / factor


def truncate_floats_in_list(numbers, n=6):
    """
    Truncates each float in a list to n decimal places using float operations.

    Parameters:
    - numbers (list): A list of numbers (int or float).
    - n (int): Number of decimal places to truncate to.

    Returns:
    - list: A new list with each number truncated to n decimal places.
    """
    if not isinstance(numbers, list):
        raise TypeError("Input data must be a list.")

    try:
        array = np.asarray(numbers, dtype=np.float64)
    except (TypeError, ValueError) as exc:
        raise ValueError("All items in the list must be numbers.") from exc

    return truncate_numpy_array(array, n).tolist()


def truncate_floats_in_2d_list(numbers, n=6):
    if not isinstance(numbers, list):
        raise TypeError("Input data must be a list.")

    try:
        array = np.asarray(numbers, dtype=np.float64)
    except (TypeError, ValueError) as exc:
        raise ValueError("All items in the 2D list must be numbers.") from exc

    if array.ndim != 2:
        raise ValueError("Input data must be a 2D list.")

    return truncate_numpy_array(array, n).tolist()


def correlation_matrix_to_dict(corr_matrix):
    """
    Converts a 2D NumPy correlation matrix into a dictionary with keys as "i,j"
    and values as the correlation coefficients, excluding self-correlations and duplicates.

    Parameters:
    - corr_matrix (np.ndarray): 2D NumPy array representing the correlation matrix.

    Returns:
    - dict: Dictionary with keys in "i,j" format and correlation coefficients as values.
    """
    num_traces = corr_matrix.shape[0]
    i_idx, j_idx = np.triu_indices(num_traces, k=1)

    return {f"{i + 1},{j + 1}": float(corr_matrix[i][j]) for i, j in zip(i_idx, j_idx)}


def correlate_traces_with_variable(trace_array, variable_data):
    min_length = min(trace_array.shape[1], len(variable_data))
    traces = trace_array[:, :min_length]
    variable = np.asarray(variable_data[:min_length], dtype=np.float64)

    if np.sum(variable) == 0.0:
        return np.zeros(traces.shape[0], dtype=np.float64)

    variable_centered = variable - np.mean(variable)
    traces_centered = traces - np.mean(traces, axis=1, keepdims=True)
    numerator = np.sum(traces_centered * variable_centered, axis=1)
    denominator = np.sqrt(
        np.sum(traces_centered**2, axis=1) * np.sum(variable_centered**2)
    )

    with np.errstate(divide="ignore", invalid="ignore"):
        correlations = np.divide(
            numerator,
            denominator,
            out=np.full(traces.shape[0], np.nan, dtype=np.float64),
            where=denominator != 0,
        )

    return np.around(correlations, 6)


def calculate_cor_behavior(list_trace_array, data):
    """
    Calculate Pearson correlation coefficients between each trace array and selected data variables.

    Parameters:
    list_trace_array (list): List of 1D numeric arrays
    data (dict): Dictionary containing variables to correlate with (velocity, head_curvature, pumping)

    Returns:
    dict: Nested dictionary where result[i][variable] gives correlation coefficient
          between i-th trace array and the variable
    """
    # If no keys specified, use all keys from data

    keys = ["velocity", "head_angle", "pumping", "angular_velocity"]
    key_conversion = {
        "velocity": "v",
        "head_angle": "hc",
        "pumping": "f",
        "angular_velocity": "av",
    }

    # Validate that all requested keys exist in data
    # invalid_keys = [k for k in keys if k not in data]
    # if invalid_keys:
    #     raise KeyError(f"Keys not found in data: {invalid_keys}")

    trace_array = np.asarray(list_trace_array, dtype=np.float64)
    if trace_array.ndim != 2:
        raise ValueError("list_trace_array must be a 2D array-like structure.")

    result = {i: {} for i in range(1, trace_array.shape[0] + 1)}

    for variable_name in keys:
        if variable_name not in data:
            continue

        key_save = key_conversion[variable_name]
        correlations = correlate_traces_with_variable(trace_array, data[variable_name])
        for i, correlation in enumerate(correlations, 1):
            result[i][key_save] = float(correlation)

    return result


"""

Neuron name/class functions

"""


def map_neuron_name(neuron_name, neuron_name_map):
    if neuron_name_map is None:
        return neuron_name
    else:
        return (
            neuron_name_map[neuron_name]
            if neuron_name in neuron_name_map
            else neuron_name
        )


def process_lr(lr):
    if lr.lower() == "undefined":
        return "x"
    elif lr.lower() in ["l", "r"]:
        return lr.lower()
    elif lr == "missing":
        return "?"
    else:
        return "n"


def process_dv(dv):
    if dv.lower() == "undefined":
        return "x"
    elif dv.lower() in ["d", "v"]:
        return dv.lower()
    elif dv == "missing":
        return "?"
    else:
        return "n"


"""

Import functions

"""


def check_list_lengths(
    self,
    list_trace_array,
    list_trace_original,
    pumping,
    head_curvature,
    angular_velocity,
    velocity,
):
    if not list_trace_array:
        raise ValueError("list_trace_array is empty.")

    # Get the expected length from the first inner list
    expected_length = len(list_trace_array[0])

    # Check that all inner lists in list_trace_array have the same length
    for idx, inner_list in enumerate(list_trace_array):
        current_length = len(inner_list)
        if current_length != expected_length:
            raise ValueError(
                f"Inner list at index {idx} in list_trace_array has length {current_length}, "
                f"expected {expected_length}."
            )

    for idx, inner_list in enumerate(list_trace_original):
        current_length = len(inner_list)
        if current_length != expected_length:
            raise ValueError(
                f"Inner list at index {idx} in list_trace_original has length {current_length}, "
                f"expected {expected_length}."
            )

    # Dictionary of other lists to check
    other_lists = {
        "pumping": pumping,
        "head_curvature": head_curvature,
        "angular_velocity": angular_velocity,
        "velocity": velocity,
    }

    # Check each additional list
    for name, lst in other_lists.items():
        if lst is not None:
            current_length = len(lst)
            if current_length != expected_length:
                raise ValueError(
                    f"List '{name}' has length {current_length}, expected {expected_length}."
                )

    return expected_length


def import_gcamp_data(
    self,
    path_json,
    checksum,
    paper_id,
    neuron_class_name_map=None,
    neuron_name_map=None,
    neuron_class_cache=None,
    paper_cache=None,
    dataset_type_cache=None,
):
    if neuron_class_cache is None:
        neuron_class_cache = {nc.name: nc for nc in NeuronClass.objects.all()}
    if paper_cache is None:
        paper_cache = {paper.paper_id: paper for paper in GCaMPPaper.objects.all()}
    if dataset_type_cache is None:
        dataset_type_cache = {
            dataset_type.type_id: dataset_type
            for dataset_type in GCaMPDatasetType.objects.all()
        }

    data = load_json(self, path_json)
    gcamp = data["gcamp"]
    behavior = data["behavior"]
    timing = data["timing"]
    labels = data.get("label", None)
    encoding = data.get("encoding", None)
    metadata = data["metadata"]

    # import neurons
    list_trace_array = gcamp["trace_array"]
    list_trace_original = gcamp["trace_array_original"]

    pumping = behavior.get("pumping", None)
    head_curvature = behavior["head_angle"]
    angular_velocity = behavior["angular_velocity"]
    velocity = behavior["velocity"]

    expected_length = check_list_lengths(
        self,
        list_trace_array,
        list_trace_original,
        pumping,
        head_curvature,
        angular_velocity,
        velocity,
    )

    if timing["max_t"] != expected_length:
        self.stdout.write(
            self.style.WARNING(
                f"max_t ({timing['max_t']}) does not match the expected length ({expected_length}). Using determined value of {expected_length}."
            )
        )
        timing["max_t"] = expected_length

    trace_array = np.asarray(list_trace_array, dtype=np.float64)
    cor_trace = {
        "neuron": correlation_matrix_to_dict(np.around(np.corrcoef(trace_array), 3)),
        "behavior": calculate_cor_behavior(trace_array, behavior),
    }

    # behavior data
    def create_trace_data(data_list, multiplier=1, truncate=False):
        trace_data = np.asarray(data_list, dtype=np.float64) * multiplier
        if truncate:
            return truncate_numpy_array(trace_data, 5).tolist()
        return trace_data.tolist()

    i_b = 0
    data_behavior = {"traces": {}}
    data_behavior_truncated = {"traces": {}}

    # Define attributes for each data type
    trace_attributes = {
        "v": {
            "name": "Velocity",
            "unit": "0.1 mm/s",
            "data": velocity,
            "multiplier": 10,
        },
        "hc": {"name": "Head Curve", "unit": "rad", "data": head_curvature},
        "av": {"name": "Angular Velocity", "unit": "rad/s", "data": angular_velocity},
        "f": {"name": "Feeding", "unit": "pumps/s", "data": pumping},
    }

    for key, attr in trace_attributes.items():
        if attr["data"] is not None:
            trace_data = create_trace_data(attr["data"], attr.get("multiplier", 1))
            truncated_data = create_trace_data(
                attr["data"], attr.get("multiplier", 1), truncate=True
            )

            # Add to full behavior data
            data_behavior["traces"][key] = {
                "i": i_b,
                "name_short": key,
                "name": attr["name"],
                "unit": attr["unit"],
                "data": trace_data,
            }

            # Add to truncated behavior data
            data_behavior_truncated["traces"][key] = {
                "i": i_b,
                "name_short": key,
                "name": attr["name"],
                "unit": attr["unit"],
                "data": truncated_data,
            }

            i_b += 1

    # Add reversal events if present
    if "reversal_events" in behavior:
        data_behavior["reversal_events"] = behavior["reversal_events"]
        data_behavior_truncated["reversal_events"] = behavior["reversal_events"]

    # encoding
    data_encoding = {}
    if encoding is not None:
        data_encoding["ranges"] = (encoding.get("ranges", {}),)
        list_key = [
            "neuron_categorization",
            "encoding_changing_neurons",
            "rel_enc_str_v",
            "rel_enc_str_θh",
            "rel_enc_str_P",
            "forwardness",
            "dorsalness",
            "feedingness",
            "tau_vals",
        ]
        for key in list_key:
            if key in encoding:
                data_encoding[key] = encoding[key]

    paper = paper_cache.get(paper_id)
    if paper is None:
        paper, _ = GCaMPPaper.objects.get_or_create(paper_id=paper_id)
        paper_cache[paper_id] = paper

    dataset = GCaMPDataset.objects.create(
        paper=paper,
        dataset_id=paper.paper_id + "-" + metadata["uid"],
        dataset_name=metadata["uid"],
        dataset_meta=data["metadata"] if "metadata" in data else {},
        avg_timestep=timing["mean_timestep"] / 60,
        max_t=timing["max_t"],
        timestamp_confocal=truncate_floats_in_list(timing["timestamp_confocal"]),
        n_neuron=metadata["n_neuron"],
        n_labeled=len(data.get("label", [])),
        behavior=data_behavior,
        truncated_behavior=data_behavior_truncated,
        encoding=data_encoding,
        events=timing.get("event", {}),
        neuron_cor=cor_trace,
        dataset_sha256=checksum,
    )

    # add dataset type
    dataset_types = []
    for type_ in metadata["dataset_type"]:
        # Construct the type_id
        type_id = f"{paper.paper_id}-{type_}"

        # Try to get the dataset_type by the constructed type_id
        dataset_type = dataset_type_cache.get(type_id)

        if dataset_type is None:
            # Fallback to retrieve, common type
            dataset_type = dataset_type_cache.get(f"common-{type_}")

        if dataset_type is None:
            raise GCaMPDatasetType.DoesNotExist(
                f"Dataset type for '{type_}' does not exist."
            )

        dataset_types.append(dataset_type)

    if dataset_types:
        dataset.dataset_type.add(*dataset_types)

    # create neuron objects
    truncated_trace_array = truncate_floats_in_2d_list(list_trace_array)
    truncated_trace_original = truncate_floats_in_2d_list(list_trace_original)
    new_neurons = []
    for i in range(len(truncated_trace_array)):
        idx_neuron = i + 1
        idx_neuron_str = str(idx_neuron)
        if labels is not None and idx_neuron_str in labels:
            label_ = labels[idx_neuron_str]
            neuron_name = map_neuron_name(label_["label"], neuron_name_map)
            neuron_class_name = map_neuron_name(
                label_["neuron_class"], neuron_class_name_map
            )
            if neuron_class_name not in neuron_class_cache:
                self.stdout.write(
                    self.style.WARNING(
                        f"Neuron class {neuron_class_name} does not exist. dataset: {metadata['uid']} idx_neuron: {idx_neuron}"
                    )
                )
            neuron_class = neuron_class_cache[neuron_class_name]
            lr = process_lr(label_["LR"])
            dv = process_dv(label_["DV"])
        else:
            neuron_name = ""
            neuron_class = None
            lr = "n"
            dv = "n"

        trace = truncated_trace_array[i]
        trace_original = truncated_trace_original[i]

        new_neurons.append(
            GCaMPNeuron(
                dataset=dataset,
                neuron_name=neuron_name,
                neuron_class=neuron_class,
                idx_neuron=idx_neuron,
                lr=lr,
                dv=dv,
                trace=trace,
                trace_original=trace_original,
            )
        )
    GCaMPNeuron.objects.bulk_create(new_neurons)


def import_all_paper(self):
    path_paper_json = get_dataset_path(PATH_PAPER)
    papers = load_json(self, path_paper_json)

    n = 0
    n_fail = 0
    for paper in papers:
        if "skip" in paper and paper["skip"]:
            self.stdout.write(self.style.NOTICE(f"Skipping paper {paper['paper_id']}"))
            continue
        try:
            GCaMPPaper.objects.create(
                paper_id=paper["paper_id"],
                title_short=paper["title_short"],
                title_full=paper["title_full"],
            )
            n += 1
        except Exception as e:
            self.stdout.write(self.style.WARNING(f"Error importing paper: {e}"))
            n_fail += 1
    if n_fail > 0:
        self.stdout.write(self.style.WARNING(f"Error importing {n_fail} papers"))
    self.stdout.write(self.style.SUCCESS(f"Successfully imported {n} papers"))


def import_all_type(self):
    path_type = get_dataset_path(PATH_TYPE)
    types = load_json(self, path_type)
    path_paper_json = get_dataset_path(PATH_PAPER)
    papers = {paper["paper_id"]: paper for paper in load_json(self, path_paper_json)}

    n = 0
    for paper_id in types.keys():
        if (
            paper_id != "common"
            and "skip" in papers[paper_id]
            and papers[paper_id]["skip"]
        ):
            self.stdout.write(
                self.style.NOTICE(f"Skipping dataset types for paper {paper_id}")
            )
            continue

        paper = (
            GCaMPPaper.objects.get(paper_id=paper_id) if paper_id != "common" else None
        )
        for type_ in types[paper_id]:
            if paper:
                GCaMPDatasetType.objects.create(
                    type_id=paper_id + "-" + type_["id"],
                    name=type_["name"],
                    description=type_["description"],
                    color_background=type_["color_background"],
                    paper=paper,
                )
            else:
                GCaMPDatasetType.objects.create(
                    type_id=paper_id + "-" + type_["id"],
                    name=type_["name"],
                    description=type_["description"],
                    color_background=type_["color_background"],
                )
            n += 1
    self.stdout.write(self.style.SUCCESS(f"Successfully imported {n} dataset types"))


def import_all_event_style(self):
    path_event_style = get_dataset_path(PATH_EVENT_STYLE)
    event_styles = load_json(self, path_event_style)
    path_paper_json = get_dataset_path(PATH_PAPER)
    papers = {paper["paper_id"]: paper for paper in load_json(self, path_paper_json)}

    n = 0
    for paper_id, styles in event_styles.items():
        if not isinstance(styles, list):
            self.stdout.write(
                self.style.WARNING(
                    f"Invalid event style format for '{paper_id}'. Expected a list."
                )
            )
            continue

        if paper_id == "common":
            paper = None
        else:
            paper_meta = papers.get(paper_id)
            if paper_meta is None:
                self.stdout.write(
                    self.style.WARNING(
                        f"Skipping event styles for unknown paper '{paper_id}'."
                    )
                )
                continue

            if paper_meta.get("skip"):
                self.stdout.write(
                    self.style.NOTICE(
                        f"Skipping event styles for skipped paper '{paper_id}'."
                    )
                )
                continue
            paper = GCaMPPaper.objects.get(paper_id=paper_id)

        for style in styles:
            if not isinstance(style, dict):
                self.stdout.write(
                    self.style.WARNING(
                        f"Skipping invalid event style entry for '{paper_id}': {style}"
                    )
                )
                continue

            event_id = style.get("id")
            color = style.get("color")
            width = style.get("width")

            if (
                not isinstance(event_id, str)
                or not event_id
                or not isinstance(color, str)
                or not color
                or not isinstance(width, (int, float))
            ):
                self.stdout.write(
                    self.style.WARNING(
                        f"Skipping malformed event style for '{paper_id}': {style}"
                    )
                )
                continue

            GCaMPEventStyle.objects.create(
                event_id=event_id,
                color=color,
                width=float(width),
                paper=paper,
            )
            n += 1

    self.stdout.write(self.style.SUCCESS(f"Successfully imported {n} event styles"))


def import_all_gcamp(self):
    t1 = time.time_ns()
    papers = list(GCaMPPaper.objects.values_list("paper_id", flat=True))
    paper_cache = {paper.paper_id: paper for paper in GCaMPPaper.objects.all()}
    neuron_class_cache = {nc.name: nc for nc in NeuronClass.objects.all()}
    dataset_type_cache = {
        dataset_type.type_id: dataset_type
        for dataset_type in GCaMPDatasetType.objects.all()
    }

    path_json = get_dataset_path(PATH_CONFIG_GCAMP_NEURON_MAP)
    neuron_name_map = load_json(self, path_json)
    path_json = get_dataset_path(PATH_CONFIG_GCAMP_CLASS_MAP)
    neuron_class_name_map = load_json(self, path_json)

    n = 0
    for paper_id in papers:
        dir_datasets = get_dataset_path(["activity", "data", paper_id])

        json_files = [f for f in os.listdir(dir_datasets) if f.endswith(".json")]

        for filename in json_files:
            # try:
            filepath = get_dataset_path(["activity", "data", paper_id, filename])
            checksum = sha256(filepath)

            import_gcamp_data(
                self,
                filepath,
                checksum,
                paper_id,
                neuron_class_name_map,
                neuron_name_map,
                neuron_class_cache,
                paper_cache,
                dataset_type_cache,
            )
            n = n + 1
            # except Exception as e:
            #     self.stdout.write(self.style.WARNING(f"Error importing GCaMP dataset: {filename} error: {e}"))
            self.stdout.write(self.style.NOTICE(f"Processed {filename}"))

    t2 = time.time_ns()
    self.stdout.write(
        self.style.SUCCESS(
            f"Successfully imported {n} GCaMP datasets. Time: {(t2 - t1) / 1e9} s"
        )
    )


class Command(BaseCommand):
    help = "Import and initialize all GCaMP datasets"

    def handle(self, *args, **options):
        import_all_paper(self)
        import_all_type(self)
        import_all_event_style(self)
        import_all_gcamp(self)
