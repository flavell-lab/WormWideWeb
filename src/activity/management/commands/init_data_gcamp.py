from django.core.management.base import BaseCommand
from connectome.models import NeuronClass
from activity.models import GCaMPDataset, GCaMPNeuron, GCaMPPaper
import numpy as np
from scipy.stats import pearsonr
import json
import math
import os

PATH_CONFIG_GCAMP_NEURON_MAP = ["config", "gcamp_neuron_name_map_manual.json"]
PATH_CONFIG_GCAMP_CLASS_MAP = ["config", "gcamp_neuron_class_name_map_manual.json"]
PATH_PAPER = ["activity", "papers.json"]

'''

Paths, import

'''
def get_dataset_path(list_part):
    current_dir = os.getcwd()
    parent_dir = os.path.dirname(current_dir)
    
    return os.path.join(parent_dir, "initial_data", *list_part)

def load_json(self, path_json):
    if not os.path.exists(path_json):
        self.stdout.write(self.style.ERROR(f"{path_json} does not exists"))
    with open(path_json, 'r') as file:
        return json.load(file)

'''

Math functions

''' 
class NumpyEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        return super().default(obj)

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
    
    truncated_numbers = []
    factor = 10.0 ** n  # Factor to shift decimal places

    for idx, num in enumerate(numbers):
        if not isinstance(num, (int, float)):
            raise ValueError(f"All items in the list must be numbers. Invalid item at index {idx}: {num}")
        
        # Truncate the number to n decimal places
        truncated = math.trunc(num * factor) / factor
        truncated_numbers.append(truncated)
    
    return truncated_numbers

def correlation_matrix_to_dict(corr_matrix):
    """
    Converts a 2D NumPy correlation matrix into a dictionary with keys as "i,j"
    and values as the correlation coefficients, excluding self-correlations and duplicates.
    
    Parameters:
    - corr_matrix (np.ndarray): 2D NumPy array representing the correlation matrix.
    
    Returns:
    - dict: Dictionary with keys in "i,j" format and correlation coefficients as values.
    """
    correlation_dict = {}
    num_traces = corr_matrix.shape[0]
    
    for i in range(num_traces):
        for j in range(i + 1, num_traces):
            key = f"{i+1},{j+1}"
            correlation_dict[key] = corr_matrix[i][j]
    
    return correlation_dict

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

    keys = ["velocity", "head_curvature", "pumping", "angular_velocity"]
    key_conversion = {"velocity": "v", "head_curvature": "hc", "pumping": "f", "angular_velocity": "av"}

    # Validate that all requested keys exist in data
    # invalid_keys = [k for k in keys if k not in data]
    # if invalid_keys:
    #     raise KeyError(f"Keys not found in data: {invalid_keys}")

    result = {}
    
    # Iterate through each trace array
    for i, trace in enumerate(list_trace_array, 1):  # Start indexing at 1
        result[i] = {}
        
        # Calculate correlation with each selected variable in data
        for variable_name in keys:
            if variable_name in data:
                variable_data = data[variable_name]
                if np.sum(variable_data) == 0.:
                    result[i][key_save] = 0.
                else:
                    # Ensure lengths match by taking the minimum length
                    min_length = min(len(trace), len(variable_data))
                    correlation, _ = pearsonr(trace[:min_length], variable_data[:min_length])
                    key_save = key_conversion[variable_name]
                    result[i][key_save] = np.around(correlation, 6)

    return result

'''

Neuron name/class functions

'''
def map_neuron_name(neuron_name, neuron_name_map):
    if neuron_name_map is None:
        return neuron_name
    else:
        return neuron_name_map[neuron_name] if neuron_name in neuron_name_map else neuron_name

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

'''

Import functions

'''
def check_list_lengths(self, list_trace_array, list_trace_original, pumping, head_curvature, body_curvature, angular_velocity, velocity):
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
        'pumping': pumping,
        'head_curvature': head_curvature,
        'body_curvature': body_curvature,
        'angular_velocity': angular_velocity,
        'velocity': velocity
    }

    # Check each additional list
    for name, lst in other_lists.items():
        if lst is not None:
            current_length = len(lst)
            if current_length != expected_length:
                raise ValueError(
                    f"List '{name}' has length {current_length}, expected {expected_length}."
                )

    # If all checks pass
    self.stdout.write(self.style.SUCCESS(f"All lists have the consistent length of {expected_length}."))

    return expected_length

def import_gcamp_data(self, path_json, paper_id, neuron_class_name_map=None, neuron_name_map=None):
    data = load_json(self, path_json)
    # import neurons
    list_trace_array = data["trace_array"]
    list_trace_original = data["trace_original"]
    
    pumping = data.get("pumping", None)
    head_curvature = data["head_curvature"]
    body_curvature = data["body_curvature"]
    angular_velocity = data["angular_velocity"]
    velocity = data["velocity"]

    expected_length = check_list_lengths(self, list_trace_array, list_trace_original,
                                         pumping, head_curvature, body_curvature, angular_velocity, velocity)

    if data["max_t"] != expected_length:
        self.stdout.write(self.style.WARNING(f"max_t ({data['max_t']}) does not match the expected length ({expected_length}). Using determined value of {expected_length}."))
        data["max_t"] = expected_length

    cor_trace = {
        "neuron": correlation_matrix_to_dict(np.around(np.corrcoef(list_trace_array), 3)),
        "behavior": calculate_cor_behavior(list_trace_array, data)
    }
    cor_trace_original = {
        "neuron": correlation_matrix_to_dict(np.around(np.corrcoef(list_trace_original), 3)),
        "behavior": calculate_cor_behavior(list_trace_original, data)
    }
    
    paper, q_created = GCaMPPaper.objects.get_or_create(paper_id=paper_id)

    dataset = GCaMPDataset.objects.create(
        paper=paper,
        dataset_id=paper.paper_id + "-" + data["uid"],
        dataset_name=data["uid"],
        dataset_type=data["dataset_type"],
        
        avg_timestep=data["avg_timestep"],
        max_t=data["max_t"],
        timestamp_confocal=truncate_floats_in_list(data["timestamp_confocal"]),
        ranges=data.get("ranges", {}),

        n_neuron=data["num_neurons"],
        n_labeled=len(data.get("labeled", [])),

        pumping=pumping if pumping is not None else [],
        head_curvature=head_curvature,
        body_curvature=body_curvature,
        angular_velocity=angular_velocity,
        velocity=velocity,
        reversal_events=data["reversal_events"],
        
        truncated_pumping=truncate_floats_in_list(pumping, 5) if pumping is not None else [],
        truncated_head_curvature=truncate_floats_in_list(head_curvature, 5),
        truncated_body_curvature=truncate_floats_in_list(body_curvature, 5),
        truncated_angular_velocity=truncate_floats_in_list(angular_velocity, 5),
        truncated_velocity=truncate_floats_in_list(velocity, 5),

        neuron_categorization = data.get("neuron_categorization", {}),
        encoding_change = data.get("encoding_changing_neurons", []),
        rel_enc_str_v = truncate_floats_in_list(data["rel_enc_str_v"]) if "rel_enc_str_v" in data else [],
        rel_enc_str_θh = truncate_floats_in_list(data["rel_enc_str_θh"]) if "rel_enc_str_θh" in data else [],
        rel_enc_str_P = truncate_floats_in_list(data["rel_enc_str_P"]) if "rel_enc_str_P" in data else [],
        forwardness = truncate_floats_in_list(data["forwardness"]) if "forwardness" in data else [],
        dorsalness = truncate_floats_in_list(data["dorsalness"]) if "dorsalness" in data else [],
        feedingness = truncate_floats_in_list(data["feedingness"]) if "feedingness" in data else [],
        tau_vals = truncate_floats_in_list(data["tau_vals"]) if "tau_vals" in data else [],

        events=data["events"] if "events" in data else {},

        neuron_cor=cor_trace,
        neuron_cor_original=cor_trace_original
    )

    # create neuron objects
    for i in range(0,len(list_trace_array)):
        idx_neuron = i + 1
        idx_neuron_str = str(idx_neuron)
        if "labeled" in data and idx_neuron_str in data["labeled"]:
            label_ = data["labeled"][idx_neuron_str]
            neuron_name = map_neuron_name(label_["label"], neuron_name_map)
            neuron_class_name = map_neuron_name(label_["neuron_class"], neuron_class_name_map)
            if not NeuronClass.objects.filter(name=neuron_class_name).exists():
                self.stdout.write(self.style.WARNING(f"Neuron class {neuron_class_name} does not exist."))

            neuron_class = NeuronClass.objects.get(name=neuron_class_name)
            lr = process_lr(label_["LR"])
            dv = process_dv(label_["DV"])
        else:
            neuron_name = ""
            neuron_class = None
            lr = "n"
            dv = "n"
        
        trace = truncate_floats_in_list(list_trace_array[i])
        trace_original = truncate_floats_in_list(list_trace_original[i])
            
        GCaMPNeuron.objects.create(
            dataset=dataset,
            neuron_name=neuron_name,
            neuron_class=neuron_class,
            idx_neuron=idx_neuron,
            lr=lr,
            dv=dv,
            trace=trace,
            trace_original=trace_original,
        )

def import_all_paper(self):
    path_paper_json = get_dataset_path(PATH_PAPER)
    papers = load_json(self, path_paper_json)

    n = 0
    n_fail = 0
    for paper in papers:
        try:
            GCaMPPaper.objects.create(paper_id=paper["paper_id"], title_short=paper["title_short"], title_full=paper["title_full"])
            n += 1
        except Exception as e:
            self.stdout.write(self.style.WARNING(f"Error importing paper: {e}"))
            n_fail += 1
    if (n_fail > 0):
        self.stdout.write(self.style.WARNING(f"Error importing {n_fail} papers"))
    self.stdout.write(self.style.SUCCESS(f"Successfully imported {n} papers"))

def import_all_gcamp(self):
    papers = GCaMPPaper.objects.values_list("paper_id")

    path_json = get_dataset_path(PATH_CONFIG_GCAMP_NEURON_MAP)
    neuron_name_map = load_json(self, path_json)
    path_json = get_dataset_path(PATH_CONFIG_GCAMP_CLASS_MAP)
    neuron_class_name_map = load_json(self, path_json)

    n = 0
    for paper_ in papers:
        paper_id = paper_[0]
        dir_datasets = get_dataset_path(["activity", "data", paper_id])

        json_files = [f for f in os.listdir(dir_datasets) if f.endswith('.json')]
        
        for filename in json_files:
            # try:
            filepath = get_dataset_path(["activity", "data", paper_id, filename])
            import_gcamp_data(self, filepath, paper_id, neuron_class_name_map, neuron_name_map)
            n = n + 1
            # except Exception as e:
            #     self.stdout.write(self.style.WARNING(f"Error importing GCaMP dataset: {filename} error: {e}"))
            self.stdout.write(self.style.NOTICE(f"Processed {filename}"))

    self.stdout.write(self.style.SUCCESS(f"Successfully imported {n} GCaMP datasets"))

class Command(BaseCommand):
    help = 'Import and initialize all GCaMP datasets'

    def handle(self, *args, **options):
        import_all_paper(self)
        import_all_gcamp(self)