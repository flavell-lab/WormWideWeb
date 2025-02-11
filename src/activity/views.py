import time
import json
from django.core.serializers.json import DjangoJSONEncoder
from django.http import JsonResponse, HttpResponseBadRequest
from django.shortcuts import render, get_object_or_404
from django.views.decorators.http import require_POST
from django.views.decorators.cache import cache_page
from django.views.decorators.csrf import csrf_exempt
from django.urls import reverse
from .models import GCaMPDataset, GCaMPNeuron, GCaMPPaper, GCaMPDatasetType
from connectome.models import Neuron, NeuronClass, Dataset, Synapse
from core.models import JSONCache
from collections import defaultdict

def index(request):
    context = {}
    
    return render(request, "activity/index.html", context)

def index_encoding(request):
    context = {}

    return render(request, "activity/index_encoding.html", context)    

def encoding_table(request):
    context = {}

    return render(request, "activity/encoding.html", context)    

def encoding_connectome(request):
    datasets = Dataset.objects.all()
    datasets_json = json.dumps(list(datasets.values(
        'name', 'dataset_id', 'dataset_type', 'description','animal_visual_time', 'citation')), cls=DjangoJSONEncoder)
    
    match_data = get_object_or_404(JSONCache, name="atanas_kim_2023_all_encoding_dict_match").json
    context = {'datasets_json': datasets_json, "match_data": match_data}

    return render(request, "activity/encoding_connectome.html", context)    

@cache_page(None)
def dataset(request):
    datasets = []
    for dataset in GCaMPDataset.objects.all():
        datasets.append({
            "paper": {"paper_id": dataset.paper.paper_id, "title": dataset.paper.title_short},
            "dataset_id": dataset.dataset_id,
            "dataset_name": dataset.dataset_name,
            "dataset_type": [type.type_id for type in dataset.dataset_type.all()],
            "n_neuron": dataset.n_neuron,
            "n_labeled": dataset.n_labeled,
            "max_t": dataset.max_t,
            "avg_timestep": dataset.avg_timestep
        })

    dataset_types = {}
    for type in GCaMPDatasetType.objects.all():
        dataset_types[type.type_id] = {"type_id": type.type_id, "description": type.description, "name": type.name, "background-color": type.color_background}

    dataset_papers = {}
    for paper_id in GCaMPDataset.objects.values_list("paper", flat=True).distinct():
        paper_obj = GCaMPPaper.objects.get(pk=paper_id)
        dataset_papers[paper_obj.paper_id] = {
            "paper_id": paper_obj.paper_id,
            "title_short": paper_obj.title_short
        }

    dataset_type_per_paper = {"common":{}, "papers":{}}
    for paper in GCaMPPaper.objects.all():
        dataset_type_per_paper["papers"][paper.paper_id] = [type.type_id for type in paper.dataset_types.all()]    
    dataset_type_per_paper["common"] = [type.type_id for type in GCaMPDatasetType.objects.filter(paper=None).all()]

    context = {
        "datasets": json.dumps(list(datasets)),
        "dataset_types": json.dumps(dataset_types),
        "dataset_type_per_paper": json.dumps(dataset_type_per_paper),
        "papers": json.dumps(dataset_papers)
    }

    return render(request, "activity/dataset.html", context)

@cache_page(None)
def get_all_dataset(request):
    datasets = GCaMPDataset.objects.all().values("dataset_id", "dataset_type", "n_neuron",
                                                 "n_labeled", "max_t", "avg_timestep")
    
    return JsonResponse(list(datasets), safe=False)

@cache_page(None)
def get_find_neuron_data(request):
    data = get_object_or_404(JSONCache, name="neuropal_match").json

    return JsonResponse(json.loads(data))

def find_neuron(request):
    context = {}

    return render(request, "activity/find_neuron.html", context)

def get_neural_trace(request, dataset_id, idx_neuron):
    dataset = get_object_or_404(GCaMPDataset, dataset_id=dataset_id)
    neuron = get_object_or_404(GCaMPNeuron, dataset=dataset, idx_neuron=idx_neuron)
    data = {"trace": neuron.trace, "idx_neuron": neuron.idx_neuron, "dataset_id": dataset_id}

    return JsonResponse(data)

"""
get all encoding from 
"""
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
def get_encoding(request, dataset_id):
    dataset = get_object_or_404(GCaMPDataset, dataset_id=dataset_id)

    return JsonResponse(get_dataset_encoding(dataset))

@cache_page(None)
def get_behavior(request, dataset_id):
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
    return JsonResponse(data)

def get_dataset_neuron_data(dataset):
    qs = dataset.neurons.select_related("neuron_class").all()
    return {
        neuron.idx_neuron: {
            "name": f"{neuron.idx_neuron} ({neuron.neuron_name})" if neuron.neuron_name else str(neuron.idx_neuron),
            "label": neuron.neuron_name,
            "class": neuron.neuron_class.name if neuron.neuron_class else "",
            "idx_neruon": neuron.idx_neuron
        }
        for neuron in qs
    }
from django.db.models import Prefetch

def plot_dataset(request, dataset_id):
    # Fetch dataset with related objects
    # Adjust these field lists as needed.
    dataset_fields = (
        'dataset_id', 'dataset_name', 'avg_timestep', 'max_t', 'neuron_cor', 'encoding', 'events', 'paper', 'dataset_meta'
    )
    paper_fields = ('id', 'title')  # Adjust to the fields you actually need from paper.
    dataset_type_fields = ('type_id', 'description', 'name', 'color_background')

    # Build a queryset that only selects the necessary fields.
    dataset_qs = (
        GCaMPDataset.objects
        .only(*dataset_fields)
        .select_related('paper')  # For paper, if you need to restrict further, see note below.
        .prefetch_related(
            Prefetch('dataset_type', queryset=GCaMPDatasetType.objects.only(*dataset_type_fields))
        )
    )

    dataset = get_object_or_404(dataset_qs, dataset_id=dataset_id)
    neuron_data = get_dataset_neuron_data(dataset)  # Ensure this function uses select_related as needed.
    encoding = dataset.encoding

    # Build initial trace data using a batched query for neurons,
    # and restrict the fields to only what is needed.
    trace_init = {}
    str_neuron_list = request.GET.get("n")
    if str_neuron_list:
        try:
            list_idx_neuron = [int(x) for x in str_neuron_list.split('-')]
        except ValueError:
            return HttpResponseBadRequest("Invalid neurons or error loading neurons.")
        # Batch query: fetch only the fields needed.
        neurons_qs = list(
            GCaMPNeuron.objects.filter(dataset=dataset, idx_neuron__in=list_idx_neuron)
            .only('idx_neuron', 'trace')
        )
        # Ensure all requested neurons are found.
        if len(neurons_qs) != len(list_idx_neuron):
            return HttpResponseBadRequest("Invalid neurons or error loading neurons.")
        neurons_map = {neuron.idx_neuron: neuron for neuron in neurons_qs}
        for idx_neuron in list_idx_neuron:
            neuron = neurons_map.get(idx_neuron)
            trace_init[idx_neuron] = {
                "trace": neuron.trace,
                "idx_neuron": neuron.idx_neuron,
                "dataset_id": dataset_id
            }

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
    datasets_qs = Dataset.objects.all().values(
        'name', 'dataset_id', 'dataset_type', 'description', 'animal_visual_time', 'citation'
    )
    datasets_json = json.dumps(list(datasets_qs), cls=DjangoJSONEncoder)

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

"""
render plot multiple datasets from the selected datsets from the find_neuron view
"""
def plot_multiple(request):
    # Pop session data, which is a dict mapping dataset_id -> list of neuron indices.
    data = request.session.pop("plot-multiple-data", {})
    if not data:
        # Early exit if no data
        return render(request, "activity/plot_multiple.html", {"list_dataset_meta": [], "plots": "{}"})

    dataset_ids = list(data.keys())

    # Prefetch related dataset types, limiting the fields.
    dt_qs = GCaMPDatasetType.objects.only('type_id', 'description', 'name', 'color_background')
    # Fetch only needed fields for datasets.
    datasets_qs = (
        GCaMPDataset.objects.filter(dataset_id__in=dataset_ids)
        .select_related('paper')
        .prefetch_related(Prefetch('dataset_type', queryset=dt_qs))
        .only('dataset_id', 'dataset_name', 'avg_timestep', 'max_t', 'paper__paper_id', 'paper__title_short')
    )
    # Map dataset_id to dataset.
    dataset_map = {ds.dataset_id: ds for ds in datasets_qs}

    # Instead of querying neurons one dataset at a time, batch query all needed neurons.
    # Gather all neuron indices requested across datasets.
    all_required_idx = {idx for idx_list in data.values() for idx in idx_list}
    # Query neurons for all datasets that are in our list.
    neurons_qs = (
        GCaMPNeuron.objects.filter(
            dataset__dataset_id__in=dataset_ids,
            idx_neuron__in=all_required_idx
        )
        .select_related('dataset')
        .only('dataset__dataset_id', 'idx_neuron', 'neuron_name', 'trace')
    )
    # Group neurons by their dataset's dataset_id and idx_neuron.
    neurons_grouped = defaultdict(dict)
    for neuron in neurons_qs:
        ds_id = neuron.dataset.dataset_id
        neurons_grouped[ds_id][neuron.idx_neuron] = neuron

    plots = []
    colors = {}
    list_dataset_meta = []
    dataset_types = {}

    # Process each dataset from the session data.
    for dataset_id, list_idx_neuron in data.items():
        dataset = dataset_map[dataset_id]

        # Cache the prefetched dataset types to avoid re-querying.
        dtypes = list(dataset.dataset_type.all())
        # Update the global dataset_types mapping.
        for dtype in dtypes:
            if dtype.type_id not in dataset_types:
                dataset_types[dtype.type_id] = {
                    "type_id": dtype.type_id,
                    "description": dtype.description,
                    "name": dtype.name,
                    "background-color": dtype.color_background,
                }

        # Get neurons for this dataset from the grouped results.
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
            # Assign a new color index if needed.
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

"""
plot multipel datasets. receive data request and handle
"""
@require_POST
@csrf_exempt
def plot_multiple_data(request):
    try:
        # Parse the JSON data from the request body
        data = json.loads(request.body)
        
        # Validate that data is a dictionary
        if not isinstance(data, dict):
            return JsonResponse({'status': 'error', 'message': 'Data must be a JSON object.'}, status=400)
        
        # Validate the structure of data
        for dataset_id, neuron_ids in data.items():
            if not isinstance(dataset_id, str):
                return JsonResponse({'status': 'error', 'message': f'Invalid dataset_id: {dataset_id}'}, status=400)
            if not isinstance(neuron_ids, list) or not all(isinstance(n, int) for n in neuron_ids):
                return JsonResponse({'status': 'error', 'message': f'Invalid neuron_ids for dataset_id {dataset_id}.'}, status=400)
        
        # Store the validated data in the session
        request.session["plot-multiple-data"] = data
        
        # Get the URL to redirect to
        url = reverse("activity-plot_multiple")
        
        return JsonResponse({'status': 'success', 'redirect': url}, status=200)
    
    except json.JSONDecodeError:
        return JsonResponse({'status': 'error', 'message': 'Invalid JSON.'}, status=400)
    except Exception as e:
        # Optionally log the exception
        # logger.error(f"Error in plot_multiple_data: {e}")
        return JsonResponse({'status': 'error', 'message': 'An unexpected error occurred.'}, status=500)