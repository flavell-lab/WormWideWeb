import json
import uuid
from collections import defaultdict

from django.core.cache import cache
from django.core.serializers.json import DjangoJSONEncoder
from django.db.models import Prefetch
from django.http import JsonResponse, HttpResponseBadRequest, Http404
from django.shortcuts import render, get_object_or_404
from django.urls import reverse
from django.views.decorators.cache import cache_page, cache_control
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

from connectome.views import connectome_datasets
from .models import GCaMPDataset, GCaMPNeuron, GCaMPPaper, GCaMPDatasetType
from connectome.models import Dataset
from core.models import JSONCache

@cache_page(60*60*24*30)
def index(request):
    context = {}
    
    return render(request, "activity/index.html", context)


@cache_page(60*60*24*30)
def index_encoding(request):
    context = {}

    return render(request, "activity/index_encoding.html", context)    


@cache_page(60*60*24*30)
def encoding_table(request):
    context = {}

    return render(request, "activity/encoding.html", context)    


def encoding_connectome(request):
    """
    Render the encoding connectome page using cached connectome dataset data.
    If the data is not in cache, fetch it and store it.
    """
    encoding_data = cache.get("encoding_connectome_data")
    if encoding_data is None:
        datasets_json = connectome_datasets()
        match_data = get_object_or_404(
            JSONCache, name="atanas_kim_2023_all_encoding_dict_match"
        ).json
        encoding_data = {"datasets_json": datasets_json, "match_data": match_data}
        cache.set("encoding_connectome_data", encoding_data, timeout=None)

    return render(request, "activity/encoding_connectome.html", encoding_data)


def dataset(request):
    """
    Render the datasets page.
    Optimizes queries by fetching papers and dataset types in bulk,
    and caches the resulting JSON structures.
    """
    context = cache.get("dataset_data")
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
        cache.set("dataset_data", context, timeout=None)

    return render(request, "activity/dataset.html", context)


@cache_page(60*60*24)
def get_all_dataset(request):
    datasets = GCaMPDataset.objects.all().values("dataset_id", "dataset_type", "n_neuron",
                                                 "n_labeled", "max_t", "avg_timestep")
    
    return JsonResponse(list(datasets), safe=False)


@cache_page(60*60*24)
def get_find_neuron_data(request):
    data = get_object_or_404(JSONCache, name="neuropal_match").json

    return JsonResponse(json.loads(data))


@cache_page(60*60*24*30)
def find_neuron(request):
    context = {}

    return render(request, "activity/find_neuron.html", context)


def get_neural_trace_data(dataset_id, idx_neuron):
    neuron = cache.get(f"{dataset_id}_{idx_neuron}")
    if neuron is None:
        neuron = (
            GCaMPNeuron.objects
            .filter(dataset__dataset_id=dataset_id, idx_neuron=idx_neuron)
            .values("trace", "idx_neuron")
            .first()
        )
        if neuron is None: return None
        neuron["dataset_id"] = dataset_id
        cache.set(f"{dataset_id}_{idx_neuron}", neuron, timeout=None)

    return neuron


@cache_control(public=True, max_age=1*24*3600)
def get_neural_trace(request, dataset_id, idx_neuron):
    neuron = get_neural_trace_data(dataset_id, idx_neuron)
    if neuron is None:
        raise Http404
    return JsonResponse(neuron)


"""
get all encoding from 
"""
@cache_page(60*60*24*30)
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


"""
get encoding data of a dataset
"""
@cache_control(public=True, max_age=60*60*24*7)
def get_encoding(request, dataset_id):
    encoding = cache.get(f"{dataset_id}_encoding")
    if encoding is None:
        dataset = get_object_or_404(GCaMPDataset, dataset_id=dataset_id)
        encoding = get_dataset_encoding(dataset)
        cache.set(f"{dataset_id}_encoding", encoding, timeout=None)

    return JsonResponse(encoding)


@cache_control(public=True, max_age=60*60*24*7)
def get_behavior(request, dataset_id):
    data = cache.get(f"{dataset_id}_behavior")
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
        cache.set(f"{dataset_id}_behavior", data, timeout=None)

    return JsonResponse(data)


def get_dataset_neuron_data(dataset):
    neuron_data = cache.get(f"{dataset.dataset_id}_dataset_neuron_data")
    if neuron_data is None:
        qs = dataset.neurons.select_related("neuron_class").all()
        neuron_data = {
            neuron.idx_neuron: {
                "name": f"{neuron.idx_neuron} ({neuron.neuron_name})" if neuron.neuron_name else str(neuron.idx_neuron),
                "label": neuron.neuron_name,
                "class": neuron.neuron_class.name if neuron.neuron_class else "",
                "idx_neruon": neuron.idx_neuron
            }
            for neuron in qs
        }
        cache.set(f"{dataset.dataset_id}_dataset_neuron_data", neuron_data, timeout=None)

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
        cache_key_map = {f"{dataset_id}_{idx}": idx for idx in list_idx_neuron}
        
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
                f"{dataset_id}_{neuron.idx_neuron}": trace_data for neuron_idx,
                trace_data in new_traces.items() for neuron in neurons if neuron.idx_neuron == neuron_idx
            }, timeout=3600*24*14)

        # Convert cached keys back to neuron indices.
        cached_traces_parsed = {
            int(key.split("_")[-1]): value for key, value in cached_traces.items()
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
    cache_key = "plot_multiple_data:" + token
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
@csrf_exempt
def plot_multiple_data(request):
    """
    Accept a POST request with JSON data mapping dataset_id -> list of neuron indices.
    Instead of using the session, store the validated data in the cache with a unique token.
    The returned JSON includes a redirect URL with the token in a query parameter.
    """
    try:
        data = json.loads(request.body)
        if not isinstance(data, dict):
            return JsonResponse({'status': 'error', 'message': 'Data must be a JSON object.'}, status=400)

        # Validate the structure of the data.
        for dataset_id, neuron_ids in data.items():
            if not isinstance(dataset_id, str):
                return JsonResponse({'status': 'error', 'message': f'Invalid dataset_id: {dataset_id}'}, status=400)
            if not isinstance(neuron_ids, list) or not all(isinstance(n, int) for n in neuron_ids):
                return JsonResponse({'status': 'error', 'message': f'Invalid neuron_ids for dataset_id {dataset_id}.'}, status=400)

        # Generate a unique token and store the data in the cache.
        token = uuid.uuid4().hex
        cache_key = "plot_multiple_data:" + token
        cache.set(cache_key, data, timeout=600)  # Store for 10 minutes (adjust as needed).

        # Build the redirect URL with the token as a GET parameter.
        url = reverse("activity-plot_multiple") + f"?token={token}"
        return JsonResponse({'status': 'success', 'redirect': url}, status=200)

    except json.JSONDecodeError:
        return JsonResponse({'status': 'error', 'message': 'Invalid JSON.'}, status=400)
    except Exception as e:
        # Optionally log the exception.
        return JsonResponse({'status': 'error', 'message': 'An unexpected error occurred.'}, status=500)
