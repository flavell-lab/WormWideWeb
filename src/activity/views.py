import json
import uuid
from collections import defaultdict

import networkx as nx
import numpy as np
from django.core.cache import cache
from django.core.serializers.json import DjangoJSONEncoder
from django.db.models import Prefetch
from django.http import JsonResponse, HttpResponseBadRequest, Http404
from django.shortcuts import render, get_object_or_404
from django.urls import reverse
from django.views.decorators.cache import cache_page, cache_control
from django.views.decorators.http import require_GET, require_POST

from connectome.views import connectome_datasets, get_edge_response_data
from connectome.models import Dataset as ConnectomeDataset
from .models import GCaMPDataset, GCaMPNeuron, GCaMPPaper, GCaMPDatasetType
from core.models import JSONCache

ACTIVITY_CACHE_TTL_LONG = 60 * 60 * 24 * 14
ACTIVITY_CACHE_TTL_MEDIUM = 60 * 60 * 24 * 14
ACTIVITY_CACHE_TTL_SHORT = 60 * 60 * 12
ACTIVITY_REPLAY_CACHE_TTL = ACTIVITY_CACHE_TTL_SHORT
ACTIVITY_PAGE_CACHE_TTL = 60 * 60 * 6
ACTIVITY_DATA_PAGE_CACHE_TTL = 60 * 60 * 12
ACTIVITY_ENCODING_TABLE_CACHE_TTL = 60 * 60 * 24
ACTIVITY_NEURAL_TRACE_HTTP_CACHE_TTL = 60 * 60 * 24 * 3
ACTIVITY_ENCODING_BEHAVIOR_HTTP_CACHE_TTL = 60 * 60 * 24 * 7
ACTIVITY_PLOT_MULTIPLE_CACHE_TTL = 60 * 30
ACTIVITY_CACHE_VERSION = "v1"


def _activity_cache_key(*parts):
    return "activity_" + ACTIVITY_CACHE_VERSION + "_" + "_".join(
        str(part) for part in parts
    )


ACTIVITY_REPLAY_CONNECTOME_DEGREE_CACHE_KEY = _activity_cache_key(
    "replay_connectome_degree_index"
)
ACTIVITY_REPLAY_BEHAVIOR_CORR_CACHE_KEY_PREFIX = _activity_cache_key(
    "replay_behavior_corr"
) + "_"
ACTIVITY_REPLAY_PAYLOAD_CACHE_KEY_PREFIX = _activity_cache_key("replay_payload") + "_"
PLOT_MULTIPLE_DATA_CACHE_KEY_PREFIX = _activity_cache_key("plot_multiple_data") + "_"


def _dedupe_int_list(values):
    seen = set()
    output = []
    for value in values:
        if value not in seen:
            seen.add(value)
            output.append(value)
    return output


def _validate_plot_multiple_payload(data):
    if not isinstance(data, dict):
        return None, 'Data must be a JSON object.'
    if not data:
        return None, 'Data must contain at least one dataset.'

    normalized = {}
    for dataset_id, neuron_ids in data.items():
        if not isinstance(dataset_id, str) or not dataset_id:
            return None, f'Invalid dataset_id: {dataset_id}'
        if not isinstance(neuron_ids, list):
            return None, f'Invalid neuron_ids for dataset_id {dataset_id}.'
        if not all(isinstance(n, int) and n > 0 for n in neuron_ids):
            return None, f'Invalid neuron_ids for dataset_id {dataset_id}.'

        normalized[dataset_id] = _dedupe_int_list(neuron_ids)

    return normalized, None


@cache_page(ACTIVITY_PAGE_CACHE_TTL)
def index(request):
    context = {}
    
    return render(request, "activity/index.html", context)


@cache_page(ACTIVITY_PAGE_CACHE_TTL)
def index_encoding(request):
    context = {}

    return render(request, "activity/index_encoding.html", context)    


@cache_page(ACTIVITY_PAGE_CACHE_TTL)
def encoding_table(request):
    context = {}

    return render(request, "activity/encoding.html", context)    


def encoding_connectome(request):
    """
    Render the encoding connectome page using cached connectome dataset data.
    If the data is not in cache, fetch it and store it.
    """
    cache_key = _activity_cache_key("encoding_connectome_data")
    encoding_data = cache.get(cache_key)
    if encoding_data is None:
        datasets_json = connectome_datasets()
        match_data = get_object_or_404(
            JSONCache, name="atanas_kim_2023_all_encoding_dict_match"
        ).json
        encoding_data = {"datasets_json": datasets_json, "match_data": match_data}
        cache.set(cache_key, encoding_data, timeout=ACTIVITY_CACHE_TTL_LONG)

    return render(request, "activity/encoding_connectome.html", encoding_data)


def dataset(request):
    """
    Render the datasets page.
    Optimizes queries by fetching papers and dataset types in bulk,
    and caches the resulting JSON structures.
    """
    cache_key = _activity_cache_key("dataset_data")
    context = cache.get(cache_key)
    if context is None:
        # Build list of datasets with required fields.
        datasets = [
            {
                "paper": {"paper_id": ds.paper.paper_id, "title": ds.paper.title_short},
                "dataset_id": ds.dataset_id,
                "dataset_name": ds.dataset_name,
                "dataset_type": [dtype.type_id for dtype in ds.dataset_type.all()],
                "n_neuron": ds.n_neuron,
                "n_labeled": ds.n_labeled,
                "max_t": ds.max_t,
                "avg_timestep": ds.avg_timestep,
            }
            for ds in GCaMPDataset.objects.all()
        ]

        # Build mapping for dataset types.
        dataset_types = {
            dt.type_id: {
                "type_id": dt.type_id,
                "description": dt.description,
                "name": dt.name,
                "paper": dt.paper.paper_id if dt.paper else "common",
                "background-color": dt.color_background,
            }
            for dt in GCaMPDatasetType.objects.all()
        }

        # Optimize fetching papers in one query.
        paper_ids = GCaMPDataset.objects.values_list("paper", flat=True).distinct()
        papers = GCaMPPaper.objects.filter(pk__in=paper_ids).only("paper_id", "title_short")
        dataset_papers = {
            paper.paper_id: {
                "paper_id": paper.paper_id,
                "title_short": paper.title_short,
            }
            for paper in papers
        }

        # Build mapping of dataset types per paper.
        dataset_type_per_paper = {
            "papers": {
                paper.paper_id: [dtype.type_id for dtype in paper.dataset_types.all()]
                for paper in GCaMPPaper.objects.all()
            },
            "common": [dt.type_id for dt in GCaMPDatasetType.objects.filter(paper=None)],
        }

        context = {
            "datasets": json.dumps(datasets),
            "dataset_types": json.dumps(dataset_types),
            "dataset_type_per_paper": json.dumps(dataset_type_per_paper),
            "papers": json.dumps(dataset_papers),
        }
        cache.set(cache_key, context, timeout=ACTIVITY_CACHE_TTL_LONG)

    return render(request, "activity/dataset.html", context)


@cache_page(ACTIVITY_DATA_PAGE_CACHE_TTL)
def get_all_dataset(request):
    datasets = GCaMPDataset.objects.all().values("dataset_id", "dataset_type", "n_neuron",
                                                 "n_labeled", "max_t", "avg_timestep")
    
    return JsonResponse(list(datasets), safe=False)


@cache_page(ACTIVITY_DATA_PAGE_CACHE_TTL)
def get_find_neuron_data(request):
    data = get_object_or_404(JSONCache, name="neuropal_match").json

    return JsonResponse(json.loads(data))


@cache_page(ACTIVITY_PAGE_CACHE_TTL)
def find_neuron(request):
    context = {}

    return render(request, "activity/find_neuron.html", context)


@cache_page(ACTIVITY_DATA_PAGE_CACHE_TTL)
def signal_propagation_replay(request):
    activity_datasets = [
        {
            "dataset_id": dataset.dataset_id,
            "dataset_name": dataset.dataset_name,
            "paper_title": dataset.paper.title_short if dataset.paper else "",
        }
        for dataset in (
            GCaMPDataset.objects
            .filter(dataset_type__type_id__icontains="neuropal")
            .distinct()
            .select_related("paper")
            .only("dataset_id", "dataset_name", "paper__title_short")
            .order_by("dataset_name")
        )
    ]

    context = {
        "activity_datasets": json.dumps(activity_datasets, cls=DjangoJSONEncoder),
        "connectome_datasets": connectome_datasets(),
    }
    return render(request, "activity/replay.html", context)


def _parse_bool_query(value, default):
    if value is None:
        return default

    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"Invalid boolean value: {value}")


def _parse_int_query(value, default, field_name, min_value=None, max_value=None):
    if value in {None, ""}:
        parsed = default
    else:
        try:
            parsed = int(value)
        except ValueError as error:
            raise ValueError(
                f"Invalid integer for '{field_name}': {value}"
            ) from error

    if min_value is not None and parsed < min_value:
        raise ValueError(f"'{field_name}' must be >= {min_value}.")
    if max_value is not None and parsed > max_value:
        raise ValueError(f"'{field_name}' must be <= {max_value}.")
    return parsed


def _is_valid_named_neuron(name):
    if not name:
        return False
    clean_name = name.strip()
    if not clean_name:
        return False
    if "?" in clean_name:
        return False
    return True


def _aggregate_replay_traces(dataset):
    traces_by_name = defaultdict(list)
    idx_by_name = defaultdict(list)
    neuron_data = get_dataset_neuron_data(dataset)
    if not neuron_data:
        return {}

    idx_values = []
    for idx_raw in neuron_data.keys():
        try:
            idx_values.append(int(idx_raw))
        except (TypeError, ValueError):
            continue
    idx_values = _dedupe_int_list(idx_values)

    trace_cache_key_map = {
        _activity_cache_key("trace", dataset.dataset_id, idx_neuron): idx_neuron
        for idx_neuron in idx_values
    }
    cached_traces = cache.get_many(list(trace_cache_key_map.keys()))
    trace_by_idx = {}
    missing_indices = []
    for cache_key, idx_neuron in trace_cache_key_map.items():
        trace_entry = cached_traces.get(cache_key)
        if trace_entry is not None:
            trace_by_idx[idx_neuron] = trace_entry
        else:
            missing_indices.append(idx_neuron)

    if missing_indices:
        missing_neurons = (
            GCaMPNeuron.objects
            .filter(dataset=dataset, idx_neuron__in=missing_indices)
            .only("idx_neuron", "trace")
        )
        new_cache_entries = {}
        for neuron in missing_neurons:
            trace_entry = {
                "trace": neuron.trace,
                "idx_neuron": neuron.idx_neuron,
                "dataset_id": dataset.dataset_id,
            }
            trace_by_idx[neuron.idx_neuron] = trace_entry
            new_cache_entries[
                _activity_cache_key("trace", dataset.dataset_id, neuron.idx_neuron)
            ] = trace_entry
        if new_cache_entries:
            cache.set_many(new_cache_entries, timeout=ACTIVITY_CACHE_TTL_MEDIUM)

    for idx_neuron, neuron_info in neuron_data.items():
        try:
            idx_neuron = int(idx_neuron)
        except (TypeError, ValueError):
            continue

        neuron_name = ""
        if isinstance(neuron_info, dict):
            neuron_name = str(neuron_info.get("label", "")).strip()
        if not _is_valid_named_neuron(neuron_name):
            continue

        trace_entry = trace_by_idx.get(idx_neuron)
        if trace_entry is None:
            continue

        trace = np.asarray(trace_entry.get("trace", []), dtype=float)
        if trace.ndim != 1 or trace.size < 3:
            continue
        clean_name = neuron_name
        traces_by_name[clean_name].append(trace)
        idx_by_name[clean_name].append(idx_neuron)

    aggregated = {}
    for neuron_name, traces in traces_by_name.items():
        min_len = min(trace.size for trace in traces)
        if min_len < 3:
            continue

        aligned = np.vstack([trace[:min_len] for trace in traces])
        mean_trace = np.nanmean(aligned, axis=0)
        if np.isnan(mean_trace).all():
            continue

        representative_idx = min(idx_by_name[neuron_name]) if idx_by_name[neuron_name] else None
        aggregated[neuron_name] = {
            "trace": np.nan_to_num(
                mean_trace,
                nan=0.0,
                posinf=0.0,
                neginf=0.0,
            ),
            "representative_idx_neuron": representative_idx,
        }

    return aggregated


def _normalize_trace(trace):
    mean = float(np.mean(trace))
    std = float(np.std(trace))
    if std == 0.0:
        std = 1.0
    normalized = (trace - mean) / std
    normalized = np.clip(normalized, -3.0, 3.0) / 3.0
    return normalized


def _extract_behavior_traces(dataset, trace_length):
    behavior_data = get_behavior_data(dataset.dataset_id)
    truncated_behavior = behavior_data.get("data", {}).get("behavior", {})
    if not isinstance(truncated_behavior, dict):
        return {
            "traces": {},
            "default_behavior": None,
            "reversal_events": [],
            "events": {},
        }

    traces = truncated_behavior.get("traces")
    if not isinstance(traces, dict):
        return {
            "traces": {},
            "default_behavior": None,
            "reversal_events": [],
            "events": {},
        }

    output = {}
    for behavior_key, behavior_dict in traces.items():
        if not isinstance(behavior_dict, dict):
            continue
        raw_data = behavior_dict.get("data")
        if not isinstance(raw_data, list):
            continue

        arr = np.asarray(raw_data, dtype=float)
        if arr.ndim != 1 or arr.size < trace_length:
            continue

        color_index = behavior_dict.get("i")
        try:
            color_index = int(color_index)
        except (TypeError, ValueError):
            color_index = None

        output_entry = {
            "name": str(behavior_dict.get("name", behavior_key)),
            "unit": str(behavior_dict.get("unit", "")),
            "data": np.nan_to_num(
                arr[:trace_length],
                nan=0.0,
                posinf=0.0,
                neginf=0.0,
            ).tolist(),
        }
        if color_index is not None:
            output_entry["i"] = color_index

        output[behavior_key] = output_entry

    reversal_events = []
    raw_reversals = truncated_behavior.get("reversal_events")
    if isinstance(raw_reversals, list):
        for reversal in raw_reversals:
            if not isinstance(reversal, (list, tuple)) or len(reversal) < 2:
                continue
            try:
                start_idx = int(reversal[0])
                end_idx = int(reversal[1])
            except (TypeError, ValueError):
                continue
            start_idx = max(1, start_idx)
            end_idx = min(trace_length, end_idx)
            if end_idx < start_idx:
                continue
            reversal_events.append([start_idx, end_idx])

    events_output = {}
    raw_events = behavior_data.get("data", {}).get("events", {})
    if isinstance(raw_events, dict):
        for event_key, event_indices in raw_events.items():
            if not isinstance(event_indices, list):
                continue
            sanitized_indices = []
            for index in event_indices:
                try:
                    idx = int(index)
                except (TypeError, ValueError):
                    continue
                # Keep indices compatible with both 0-based and 1-based inputs.
                if idx < 0 or idx > trace_length:
                    continue
                sanitized_indices.append(idx)
            if sanitized_indices:
                events_output[str(event_key)] = sanitized_indices

    default_behavior = "v" if "v" in output else (next(iter(output), None))
    return {
        "traces": output,
        "default_behavior": default_behavior,
        "reversal_events": reversal_events,
        "events": events_output,
    }


def _extract_behavior_arrays(dataset):
    behavior_data = get_behavior_data(dataset.dataset_id)
    truncated_behavior = behavior_data.get("data", {}).get("behavior", {})
    if not isinstance(truncated_behavior, dict):
        return {}

    traces = truncated_behavior.get("traces")
    if not isinstance(traces, dict):
        return {}

    output = {}
    for behavior_key, behavior_dict in traces.items():
        if not isinstance(behavior_dict, dict):
            continue
        raw_data = behavior_dict.get("data")
        if not isinstance(raw_data, list):
            continue
        arr = np.asarray(raw_data, dtype=float)
        if arr.ndim != 1 or arr.size < 3:
            continue
        output[behavior_key] = np.nan_to_num(
            arr,
            nan=0.0,
            posinf=0.0,
            neginf=0.0,
        )
    return output


def _safe_pearson_corr(x, y):
    if x.size < 3 or y.size < 3:
        return 0.0

    x_centered = x - float(np.mean(x))
    y_centered = y - float(np.mean(y))
    denom = float(np.linalg.norm(x_centered) * np.linalg.norm(y_centered))
    if denom <= 1e-12:
        return 0.0

    corr = float(np.dot(x_centered, y_centered) / denom)
    return float(np.clip(corr, -1.0, 1.0))


def _compute_activity_behavior_correlation_index(activity_dataset, traces_by_name=None):
    if traces_by_name is None:
        traces_by_name = _aggregate_replay_traces(activity_dataset)
    if not traces_by_name:
        return {}

    behavior_arrays = _extract_behavior_arrays(activity_dataset)
    if not behavior_arrays:
        return {}

    by_neuron = {}
    for neuron_name, neuron_data in traces_by_name.items():
        trace = np.asarray(neuron_data.get("trace", []), dtype=float)
        if trace.ndim != 1 or trace.size < 3:
            continue

        normalized_trace = _normalize_trace(trace)
        neuron_corr = {}
        for behavior_key, behavior_arr in behavior_arrays.items():
            overlap = min(normalized_trace.size, behavior_arr.size)
            if overlap < 3:
                continue
            neuron_corr[behavior_key] = _safe_pearson_corr(
                normalized_trace[:overlap],
                behavior_arr[:overlap],
            )
        by_neuron[neuron_name] = neuron_corr

    return by_neuron


def _get_activity_behavior_correlation_index(activity_dataset, traces_by_name=None):
    cache_key = (
        f"{ACTIVITY_REPLAY_BEHAVIOR_CORR_CACHE_KEY_PREFIX}"
        f"{activity_dataset.dataset_id}"
    )
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    index = _compute_activity_behavior_correlation_index(
        activity_dataset,
        traces_by_name=traces_by_name,
    )
    cache.set(cache_key, index, timeout=ACTIVITY_CACHE_TTL_LONG)
    return index


def _add_weighted_edge(graph, source, target, weight):
    if graph.has_edge(source, target):
        graph[source][target]["weight"] += weight
    else:
        graph.add_edge(source, target, weight=weight)


def _compute_connectome_full_degree_index():
    """
    Build full-graph node metrics for every node in every connectome dataset.

    This index is independent of replay visualization filtering (selected neurons,
    activity/connectome overlap, and per-request edge thresholds), and can be reused
    across replay requests.
    """
    metric_index = defaultdict(
        lambda: defaultdict(
            lambda: {
                "degree_in_full": 0.0,
                "degree_out_full": 0.0,
                "degree_total_full": 0.0,
                "pagerank_centrality": 0.0,
                "eigenvector_centrality": 0.0,
            }
        )
    )
    directed_graph_by_dataset = {}
    undirected_graph_by_dataset = {}
    neurons_by_dataset = defaultdict(set)

    # Ensure all dataset-neuron pairs exist in the index (including isolated neurons).
    for dataset_id, neuron_name in ConnectomeDataset.objects.values_list(
        "dataset_id",
        "available_neurons__name",
    ):
        if not dataset_id:
            continue
        directed_graph = directed_graph_by_dataset.setdefault(dataset_id, nx.DiGraph())
        undirected_graph = undirected_graph_by_dataset.setdefault(dataset_id, nx.Graph())
        if neuron_name:
            directed_graph.add_node(neuron_name)
            undirected_graph.add_node(neuron_name)
            neurons_by_dataset[dataset_id].add(neuron_name)
            _ = metric_index[dataset_id][neuron_name]
        else:
            _ = metric_index[dataset_id]

    for dataset_id in directed_graph_by_dataset.keys():
        dataset_neurons = sorted(neurons_by_dataset.get(dataset_id, set()))
        if not dataset_neurons:
            continue

        edge_response = get_edge_response_data(
            {
                "datasets": [dataset_id],
                "neurons": dataset_neurons,
                "classes": [],
                "show_individual_neuron": True,
                "show_connected_neuron": True,
            }
        )

        directed_graph = directed_graph_by_dataset.setdefault(dataset_id, nx.DiGraph())
        undirected_graph = undirected_graph_by_dataset.setdefault(dataset_id, nx.Graph())
        for synapse in edge_response.get("synapses", []):
            pre_name = synapse.get("pre")
            post_name = synapse.get("post")
            if not pre_name or not post_name:
                continue

            try:
                weight = float(synapse.get("count"))
            except (TypeError, ValueError):
                continue

            synapse_type = synapse.get("type")
            if not directed_graph.has_node(pre_name):
                directed_graph.add_node(pre_name)
                undirected_graph.add_node(pre_name)
                _ = metric_index[dataset_id][pre_name]
            if not directed_graph.has_node(post_name):
                directed_graph.add_node(post_name)
                undirected_graph.add_node(post_name)
                _ = metric_index[dataset_id][post_name]

            pre_metrics = metric_index[dataset_id][pre_name]
            post_metrics = metric_index[dataset_id][post_name]

            pre_metrics["degree_out_full"] += weight
            post_metrics["degree_in_full"] += weight
            _add_weighted_edge(directed_graph, pre_name, post_name, weight)
            _add_weighted_edge(undirected_graph, pre_name, post_name, weight)

            # Gap junctions are effectively bidirectional.
            if synapse_type == "e":
                post_metrics["degree_out_full"] += weight
                pre_metrics["degree_in_full"] += weight
                _add_weighted_edge(directed_graph, post_name, pre_name, weight)

    output = {}
    for dataset_id, node_map in metric_index.items():
        directed_graph = directed_graph_by_dataset.get(dataset_id, nx.DiGraph())
        undirected_graph = undirected_graph_by_dataset.get(dataset_id, nx.Graph())

        pagerank = {node: 0.0 for node in directed_graph.nodes}
        if directed_graph.number_of_nodes() > 0 and directed_graph.number_of_edges() > 0:
            try:
                pagerank = nx.pagerank(directed_graph, weight="weight")
            except Exception:
                pass

        eigenvector = {node: 0.0 for node in undirected_graph.nodes}
        if undirected_graph.number_of_nodes() > 0 and undirected_graph.number_of_edges() > 0:
            try:
                eigenvector = nx.eigenvector_centrality(
                    undirected_graph,
                    weight="weight",
                    max_iter=1000,
                    tol=1.0e-6,
                )
            except Exception:
                try:
                    eigenvector = nx.eigenvector_centrality_numpy(
                        undirected_graph,
                        weight="weight",
                    )
                except Exception:
                    pass

        output[dataset_id] = {}
        for neuron_name, metrics in node_map.items():
            degree_in = float(metrics["degree_in_full"])
            degree_out = float(metrics["degree_out_full"])
            output[dataset_id][neuron_name] = {
                "degree_in_full": degree_in,
                "degree_out_full": degree_out,
                "degree_total_full": degree_in + degree_out,
                "pagerank_centrality": float(pagerank.get(neuron_name, 0.0)),
                "eigenvector_centrality": float(eigenvector.get(neuron_name, 0.0)),
            }

    return output


def _get_connectome_full_degree_index():
    cached = cache.get(ACTIVITY_REPLAY_CONNECTOME_DEGREE_CACHE_KEY)
    if cached is not None:
        return cached

    index = _compute_connectome_full_degree_index()
    cache.set(
        ACTIVITY_REPLAY_CONNECTOME_DEGREE_CACHE_KEY,
        index,
        timeout=ACTIVITY_CACHE_TTL_LONG,
    )
    return index


def _build_signal_replay_payload(
    activity_dataset_id,
    connectome_dataset_id,
    include_electrical,
    min_synapse_chemical,
    min_synapse_electrical,
    show_connected,
):
    activity_dataset = get_object_or_404(
        GCaMPDataset.objects.only(
            "dataset_id",
            "dataset_name",
            "avg_timestep",
        ),
        dataset_id=activity_dataset_id,
    )
    connectome_dataset = get_object_or_404(
        ConnectomeDataset.objects.only("dataset_id", "name"),
        dataset_id=connectome_dataset_id,
    )

    traces_by_name = _aggregate_replay_traces(activity_dataset)
    if not traces_by_name:
        raise ValueError(
            "No valid named neuron traces found in the selected activity dataset."
        )

    connectome_neuron_rows = list(
        connectome_dataset.available_neurons.values_list("name", "cell_type")
    )
    connectome_names = {
        neuron_name for neuron_name, _ in connectome_neuron_rows if neuron_name
    }
    connectome_cell_type_by_name = {
        neuron_name: (cell_type or "")
        for neuron_name, cell_type in connectome_neuron_rows
        if neuron_name
    }
    matched_names = sorted(set(traces_by_name.keys()) & connectome_names)
    if len(matched_names) < 3:
        raise ValueError(
            "Insufficient overlap between activity and connectome neurons "
            "(need at least 3 named neurons)."
        )

    warnings = []

    trace_arrays = [traces_by_name[name]["trace"] for name in matched_names]
    min_len = min(trace.size for trace in trace_arrays)
    if min_len < 3:
        raise ValueError("Neuron traces are too short for replay.")

    normalized_traces = {}
    for name in matched_names:
        normalized_traces[name] = _normalize_trace(
            np.asarray(traces_by_name[name]["trace"][:min_len], dtype=float)
        )

    activity_matrix = np.vstack([normalized_traces[name] for name in matched_names])
    global_signal = np.mean(np.abs(activity_matrix), axis=0)
    time_minutes = (
        np.arange(min_len, dtype=float) * float(activity_dataset.avg_timestep)
    ).tolist()

    node_degree_in = defaultdict(float)
    node_degree_out = defaultdict(float)
    edges = []
    max_edge_weight = 0.0
    connectome_metric_map = _get_connectome_full_degree_index().get(
        connectome_dataset.dataset_id,
        {},
    )
    behavior_corr_by_neuron = _get_activity_behavior_correlation_index(
        activity_dataset,
        traces_by_name=traces_by_name,
    )

    matched_set = set(matched_names)
    visible_node_names = set(matched_names)

    edge_response = get_edge_response_data(
        {
            "datasets": [connectome_dataset.dataset_id],
            "neurons": matched_names,
            "classes": [],
            # Replay is NeuroPAL-only and should resolve to individual neurons.
            "show_individual_neuron": True,
            "show_connected_neuron": show_connected,
        }
    )

    for synapse in edge_response.get("synapses", []):
        pre_name = synapse.get("pre")
        post_name = synapse.get("post")
        synapse_type = synapse.get("type")
        synapse_count = synapse.get("count")
        if not pre_name or not post_name:
            continue
        if (not show_connected) and (pre_name not in matched_set or post_name not in matched_set):
            continue
        try:
            synapse_count = float(synapse_count)
        except (TypeError, ValueError):
            continue

        if synapse_type == "c":
            if synapse_count < min_synapse_chemical:
                continue
        elif synapse_type == "e":
            if not include_electrical:
                continue
            if synapse_count < min_synapse_electrical:
                continue
        else:
            continue

        weight = float(synapse_count)
        max_edge_weight = max(max_edge_weight, weight)

        edge_type = "electrical" if synapse_type == "e" else "chemical"
        edges.append(
            {
                "source": pre_name,
                "target": post_name,
                "weight": weight,
                "edge_type": edge_type,
            }
        )
        node_degree_out[pre_name] += weight
        node_degree_in[post_name] += weight
        visible_node_names.add(pre_name)
        visible_node_names.add(post_name)

        # Gap junctions are effectively bidirectional for replay flow.
        if synapse_type == "e":
            edges.append(
                {
                    "source": post_name,
                    "target": pre_name,
                    "weight": weight,
                    "edge_type": edge_type,
                }
            )
            node_degree_out[post_name] += weight
            node_degree_in[pre_name] += weight

    if not edges:
        warnings.append(
            "No connectome edges matched the selected filters in this neuron overlap."
        )

    behavior = _extract_behavior_traces(activity_dataset, min_len)
    behavior_keys = list(behavior.get("traces", {}).keys())
    connected_only_names = sorted(name for name in visible_node_names if name not in matched_set)

    nodes = []
    for name in sorted(visible_node_names):
        has_activity = name in normalized_traces
        trace = normalized_traces.get(name, np.zeros(min_len, dtype=float))
        full_metrics = connectome_metric_map.get(name, {})
        node_behavior_corr = behavior_corr_by_neuron.get(name, {}) if has_activity else {}
        filtered_behavior_corr = {
            behavior_key: float(node_behavior_corr.get(behavior_key, 0.0))
            for behavior_key in behavior_keys
        }
        degree_in_full = float(full_metrics.get("degree_in_full", 0.0))
        degree_out_full = float(full_metrics.get("degree_out_full", 0.0))
        degree_total_full = float(
            full_metrics.get("degree_total_full", degree_in_full + degree_out_full)
        )
        nodes.append(
            {
                "id": name,
                "trace": trace.tolist(),
                "variance": float(np.var(trace)),
                "mean_abs_activity": float(np.mean(np.abs(trace))),
                "has_activity": has_activity,
                "cell_type": connectome_cell_type_by_name.get(name, ""),
                "degree_in": float(node_degree_in[name]),
                "degree_out": float(node_degree_out[name]),
                "degree_in_full": degree_in_full,
                "degree_out_full": degree_out_full,
                "degree_total_full": degree_total_full,
                "pagerank_centrality": float(full_metrics.get("pagerank_centrality", 0.0)),
                "eigenvector_centrality": float(
                    full_metrics.get("eigenvector_centrality", 0.0)
                ),
                "behavior_correlations": filtered_behavior_corr,
                "representative_idx_neuron": traces_by_name[name]["representative_idx_neuron"]
                if has_activity
                else None,
            }
        )

    return {
        "status": "ok",
        "meta": {
            "activity_dataset_id": activity_dataset.dataset_id,
            "activity_dataset_name": activity_dataset.dataset_name,
            "connectome_dataset_id": connectome_dataset.dataset_id,
            "connectome_dataset_name": connectome_dataset.name,
            "include_electrical": include_electrical,
            "show_connected": show_connected,
            "min_synapse_chemical": min_synapse_chemical,
            "min_synapse_electrical": min_synapse_electrical,
            "trace_length": int(min_len),
            "avg_timestep": float(activity_dataset.avg_timestep),
            "n_activity_nodes": len(matched_names),
            "n_connected_only_nodes": len(connected_only_names),
            "n_nodes": len(nodes),
            "n_edges": len(edges),
            "max_edge_weight": float(max_edge_weight),
        },
        "warnings": warnings,
        "nodes": nodes,
        "edges": edges,
        "timeline": {
            "time_minutes": time_minutes,
            "global_signal": global_signal.tolist(),
        },
        "behavior": behavior,
    }


@require_GET
@cache_control(public=True, max_age=ACTIVITY_REPLAY_CACHE_TTL)
def get_signal_replay_data(request):
    activity_dataset_id = request.GET.get("activity_dataset")
    connectome_dataset_id = request.GET.get("connectome_dataset")
    if not activity_dataset_id or not connectome_dataset_id:
        return JsonResponse(
            {
                "status": "error",
                "message": (
                    "Query params 'activity_dataset' and "
                    "'connectome_dataset' are required."
                ),
            },
            status=400,
        )

    try:
        include_electrical = _parse_bool_query(
            request.GET.get("include_electrical"),
            default=True,
        )
        show_connected = _parse_bool_query(
            request.GET.get("show_connected"),
            default=False,
        )
        min_synapse_chemical = _parse_int_query(
            request.GET.get("min_synapse_chemical"),
            default=1,
            field_name="min_synapse_chemical",
            min_value=1,
            max_value=5000,
        )
        min_synapse_electrical = _parse_int_query(
            request.GET.get("min_synapse_electrical"),
            default=1,
            field_name="min_synapse_electrical",
            min_value=1,
            max_value=5000,
        )
    except ValueError as error:
        return JsonResponse({"status": "error", "message": str(error)}, status=400)

    cache_key = (
        f"{ACTIVITY_REPLAY_PAYLOAD_CACHE_KEY_PREFIX}"
        f"{activity_dataset_id}_{connectome_dataset_id}_"
        f"{int(include_electrical)}_{int(show_connected)}_"
        f"{min_synapse_chemical}_{min_synapse_electrical}"
    )
    cached_payload = cache.get(cache_key)
    if cached_payload is not None:
        return JsonResponse(cached_payload)

    try:
        payload = _build_signal_replay_payload(
            activity_dataset_id=activity_dataset_id,
            connectome_dataset_id=connectome_dataset_id,
            include_electrical=include_electrical,
            show_connected=show_connected,
            min_synapse_chemical=min_synapse_chemical,
            min_synapse_electrical=min_synapse_electrical,
        )
    except Http404:
        return JsonResponse(
            {"status": "error", "message": "Dataset not found."},
            status=404,
        )
    except ValueError as error:
        return JsonResponse({"status": "error", "message": str(error)}, status=400)

    cache.set(cache_key, payload, timeout=ACTIVITY_REPLAY_CACHE_TTL)
    return JsonResponse(payload)


def get_neural_trace_data(dataset_id, idx_neuron):
    cache_key = _activity_cache_key("trace", dataset_id, idx_neuron)
    neuron = cache.get(cache_key)
    if neuron is None:
        neuron = (
            GCaMPNeuron.objects
            .filter(dataset__dataset_id=dataset_id, idx_neuron=idx_neuron)
            .values("trace", "idx_neuron")
            .first()
        )
        if neuron is None:
            return None
        neuron["dataset_id"] = dataset_id
        cache.set(cache_key, neuron, timeout=ACTIVITY_CACHE_TTL_MEDIUM)

    return neuron


@cache_control(public=True, max_age=ACTIVITY_NEURAL_TRACE_HTTP_CACHE_TTL)
def get_neural_trace(request, dataset_id, idx_neuron):
    neuron = get_neural_trace_data(dataset_id, idx_neuron)
    if neuron is None:
        raise Http404
    return JsonResponse(neuron)


"""
get all encoding from 
"""
@cache_page(ACTIVITY_ENCODING_TABLE_CACHE_TTL)
def get_all_dataset_encoding(request):
    data = get_object_or_404(JSONCache, name="atanas_kim_2023_all_encoding_dict").json

    return JsonResponse(json.loads(data))


def get_dataset_encoding(dataset):
    encoding = dataset.encoding
    data = {
        "n_neuron": dataset.n_neuron,
        "neuron_categorization": encoding["neuron_categorization"],
        "rel_enc_str_θh": encoding["rel_enc_str_θh"],
        "rel_enc_str_P": encoding["rel_enc_str_P"],
        "rel_enc_str_v": encoding["rel_enc_str_v"],
        "dorsalness": encoding["dorsalness"],
        "forwardness": encoding["forwardness"],
        "feedingness": encoding["feedingness"],
        "encoding_changing_neurons": encoding["encoding_changing_neurons"],
        "tau_vals": encoding["tau_vals"]
    }

    return data


def get_encoding_data(dataset_id):
    cache_key = _activity_cache_key("encoding", dataset_id)
    encoding = cache.get(cache_key)
    if encoding is None:
        dataset = get_object_or_404(GCaMPDataset, dataset_id=dataset_id)
        encoding = get_dataset_encoding(dataset)
        cache.set(cache_key, encoding, timeout=ACTIVITY_CACHE_TTL_MEDIUM)

    return encoding


"""
get encoding data of a dataset
"""
@cache_control(public=True, max_age=ACTIVITY_ENCODING_BEHAVIOR_HTTP_CACHE_TTL)
def get_encoding(request, dataset_id):
    return JsonResponse(get_encoding_data(dataset_id))

def get_behavior_data(dataset_id):
    cache_key = _activity_cache_key("behavior", dataset_id)
    data = cache.get(cache_key)
    if data is None:
        dataset = get_object_or_404(
            GCaMPDataset.objects.only("truncated_behavior", "events", "avg_timestep", "max_t"),
            dataset_id=dataset_id
        )
        data = {
            "data": {
                "behavior": dataset.truncated_behavior,
                "events": dataset.events
            },
            "dataset_id": dataset_id,
            "avg_timestep": dataset.avg_timestep,
            "max_t": dataset.max_t
        }
        cache.set(cache_key, data, timeout=ACTIVITY_CACHE_TTL_MEDIUM)

    return data


@cache_control(public=True, max_age=ACTIVITY_ENCODING_BEHAVIOR_HTTP_CACHE_TTL)
def get_behavior(request, dataset_id):

    return JsonResponse(get_behavior_data(dataset_id))


def get_dataset_neuron_data(dataset):
    cache_key = _activity_cache_key("dataset_neuron_data", dataset.dataset_id)
    neuron_data = cache.get(cache_key)
    if neuron_data is None:
        qs = dataset.neurons.select_related("neuron_class").all()
        neuron_data = {
            neuron.idx_neuron: {
                "name": f"{neuron.idx_neuron} ({neuron.neuron_name})" if neuron.neuron_name else str(neuron.idx_neuron),
                "label": neuron.neuron_name,
                "class": neuron.neuron_class.name if neuron.neuron_class else "",
                "idx_neuron": neuron.idx_neuron
            }
            for neuron in qs
        }
        cache.set(cache_key, neuron_data, timeout=ACTIVITY_CACHE_TTL_LONG)

    return neuron_data


def plot_dataset(request, dataset_id):
    # Fetch dataset with related objects
    dataset_fields = (
        'dataset_id', 'dataset_name', 'avg_timestep', 'max_t', 'neuron_cor', 'encoding', 'events', 'paper', 'dataset_meta'
    )
    dataset_type_fields = ('type_id', 'description', 'name', 'color_background')

    # Build a queryset that only selects the necessary fields.
    dataset_qs = (
        GCaMPDataset.objects
        .only(*dataset_fields)
        .select_related('paper')
        .prefetch_related(
            Prefetch('dataset_type', queryset=GCaMPDatasetType.objects.only(*dataset_type_fields))
        )
    )

    dataset = get_object_or_404(dataset_qs, dataset_id=dataset_id)
    neuron_data = get_dataset_neuron_data(dataset)  # using select_related. cached
    encoding = dataset.encoding

    # initial trace data with cache look up and batch query
    trace_init = {}
    neuron_str = request.GET.get("n")
    if neuron_str:
        try:
            list_idx_neuron = [int(x) for x in neuron_str.split('-')]
        except ValueError:
            return HttpResponseBadRequest("Invalid neurons or error loading neurons.")

        # Map each neuron index to its cache key.
        cache_key_map = {
            _activity_cache_key("trace", dataset_id, idx): idx for idx in list_idx_neuron
        }
        
        # Retrieve cached traces.
        cached_traces = cache.get_many(list(cache_key_map.keys()))
        
        # Identify indices that were not found in cache.
        missing_indices = [
            idx for key, idx in cache_key_map.items() if key not in cached_traces
        ]
        
        new_traces = {}
        if missing_indices:
            # Batch query to fetch missing neurons with only the needed fields.
            neurons = list(
                GCaMPNeuron.objects.filter(dataset=dataset, idx_neuron__in=missing_indices)
                .only('idx_neuron', 'trace')
            )
            # Validate that all requested neurons were returned.
            if len(neurons) != len(missing_indices):
                return HttpResponseBadRequest("Invalid neurons or error loading neurons.")
            
            # Create a mapping of neuron index to its trace data.
            new_traces = {
                neuron.idx_neuron: {
                    "trace": neuron.trace,
                    "idx_neuron": neuron.idx_neuron,
                    "dataset_id": dataset_id
                }
                for neuron in neurons
            }
            # Cache the new traces in bulk.
            cache.set_many({
                _activity_cache_key("trace", dataset_id, neuron.idx_neuron): trace_data for neuron_idx,
                trace_data in new_traces.items() for neuron in neurons if neuron.idx_neuron == neuron_idx
            }, timeout=ACTIVITY_CACHE_TTL_MEDIUM)

        # Convert cached keys back to neuron indices.
        cached_traces_parsed = {
            cache_key_map[key]: value for key, value in cached_traces.items()
            if key in cache_key_map
        }

        # Merge cached and newly fetched traces.
        trace_init = {**cached_traces_parsed, **new_traces}

    # Build the main data structure.
    data = {
        "neuron": neuron_data,
        "dataset_id": dataset_id,
        "dataset_name": dataset.dataset_name,
        "avg_timestep": dataset.avg_timestep,
        "max_t": dataset.max_t,
        "cor": dataset.neuron_cor,
        "encoding_data_exists": bool(encoding),
        "dataset_type": {
            dtype.type_id: {
                "type_id": dtype.type_id,
                "description": dtype.description,
                "name": dtype.name,
                "background-color": dtype.color_background,
            }
            for dtype in dataset.dataset_type.all()
        }
    }
    if dataset.events:
        data["events"] = dataset.events
    if trace_init:
        data["trace_init"] = trace_init

    # Retrieve connectome datasets with only the needed fields.
    datasets_json = connectome_datasets()

    context = {
        "paper": dataset.paper,
        "dataset_id": dataset_id,
        "dataset_sha256": dataset.dataset_sha256,
        "dataset_name": dataset.dataset_name,
        "data": json.dumps(data, cls=DjangoJSONEncoder),
        "datasets_json": datasets_json,
        "show_connectome": "common-neuropal" in data["dataset_type"],
        "show_encoding": bool(encoding)
    }

    # dataset note
    if "note" in dataset.dataset_meta:
        context["dataset_note"] = dataset.dataset_meta["note"]

    return render(request, "activity/explore.html", context)


def plot_multiple(request):
    """
    Render the plot multiple view using input data stored in the cache keyed by a token.
    The token is passed via a GET parameter (e.g., ?token=...).
    """
    token = request.GET.get("token")
    if not token:
        # No token provided; return an empty page.
        return render(request, "activity/plot_multiple.html", {"list_dataset_meta": [], "plots": "{}"})
    
    # Retrieve the input data from cache using the token.
    cache_key = PLOT_MULTIPLE_DATA_CACHE_KEY_PREFIX + token
    data = cache.get(cache_key)
    if not data:
        # Token not found or expired.
        return render(request, "activity/plot_multiple.html", {"list_dataset_meta": [], "plots": "{}"})
    
    dataset_ids = list(data.keys())
    
    # Prefetch dataset types with limited fields.
    dt_qs = GCaMPDatasetType.objects.only('type_id', 'description', 'name', 'color_background')
    datasets_qs = (
        GCaMPDataset.objects.filter(dataset_id__in=dataset_ids)
        .select_related('paper')
        .prefetch_related(Prefetch('dataset_type', queryset=dt_qs))
        .only('dataset_id', 'dataset_name', 'avg_timestep', 'max_t', 'paper__paper_id', 'paper__title_short')
    )
    # Map dataset_id to dataset instance.
    dataset_map = {ds.dataset_id: ds for ds in datasets_qs}
    
    # Batch query neurons across all requested datasets.
    all_required_idx = {idx for idx_list in data.values() for idx in idx_list}
    neurons_qs = (
        GCaMPNeuron.objects.filter(
            dataset__dataset_id__in=dataset_ids,
            idx_neuron__in=all_required_idx
        )
        .select_related('dataset')
        .only('dataset__dataset_id', 'idx_neuron', 'neuron_name', 'trace')
    )
    # Group neurons by dataset_id and their index.
    neurons_grouped = defaultdict(dict)
    for neuron in neurons_qs:
        ds_id = neuron.dataset.dataset_id
        neurons_grouped[ds_id][neuron.idx_neuron] = neuron

    plots = []
    colors = {}
    list_dataset_meta = []
    dataset_types = {}

    # Process each dataset from the cached data.
    for dataset_id, list_idx_neuron in data.items():
        dataset = dataset_map.get(dataset_id)
        if not dataset:
            continue

        # Get dataset types.
        dtypes = list(dataset.dataset_type.all())
        for dtype in dtypes:
            if dtype.type_id not in dataset_types:
                dataset_types[dtype.type_id] = {
                    "type_id": dtype.type_id,
                    "description": dtype.description,
                    "name": dtype.name,
                    "background-color": dtype.color_background,
                }

        # Retrieve neurons for this dataset.
        neuron_map = neurons_grouped.get(dataset_id, {})
        trace_data = []
        for idx_neuron in list_idx_neuron:
            neuron = neuron_map.get(idx_neuron)
            if not neuron:
                continue  # Optionally handle missing neurons.
            neuron_name = neuron.neuron_name
            trace_data.append({
                "idx_neuron": idx_neuron,
                "trace": neuron.trace,
                "name": neuron_name
            })
            if neuron_name not in colors:
                colors[neuron_name] = len(colors)

        plots.append({
            "dataset_type": [dtype.type_id for dtype in dtypes],
            "dataset_id": dataset.dataset_id,
            "dataset_name": dataset.dataset_name,
            "trace_data": trace_data,
            "avg_timestep": dataset.avg_timestep,
            "max_t": dataset.max_t
        })
        list_dataset_meta.append({
            "paper_id": dataset.paper.paper_id,
            "paper_title_short": dataset.paper.title_short,
            "dataset_id": dataset.dataset_id,
            "dataset_name": dataset.dataset_name,
        })

    context = {
        "list_dataset_meta": list_dataset_meta,
        "plots": json.dumps({
            "dataset_types": dataset_types,
            "data": plots,
            "colors": colors
        }, cls=DjangoJSONEncoder)
    }
    return render(request, "activity/plot_multiple.html", context)


@require_POST
def plot_multiple_data(request):
    """
    Accept a POST request with JSON data mapping dataset_id -> list of neuron indices.
    Instead of using the session, store the validated data in the cache with a unique token.
    The returned JSON includes a redirect URL with the token in a query parameter.
    """
    try:
        data = json.loads(request.body)
        normalized_data, validation_error = _validate_plot_multiple_payload(data)
        if validation_error:
            return JsonResponse({'status': 'error', 'message': validation_error}, status=400)

        # Generate a unique token and store the data in the cache.
        token = uuid.uuid4().hex
        cache_key = PLOT_MULTIPLE_DATA_CACHE_KEY_PREFIX + token
        cache.set(
            cache_key,
            normalized_data,
            timeout=ACTIVITY_PLOT_MULTIPLE_CACHE_TTL,
        )

        # Build the redirect URL with the token as a GET parameter.
        url = reverse("activity-plot_multiple") + f"?token={token}"
        return JsonResponse({'status': 'success', 'redirect': url}, status=200)

    except json.JSONDecodeError:
        return JsonResponse({'status': 'error', 'message': 'Invalid JSON.'}, status=400)
    except Exception:
        # Optionally log the exception.
        return JsonResponse({'status': 'error', 'message': 'An unexpected error occurred.'}, status=500)
