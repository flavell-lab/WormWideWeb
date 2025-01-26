import time
import json
from django.core.serializers.json import DjangoJSONEncoder
from django.http import JsonResponse, HttpResponseBadRequest
from django.shortcuts import render, get_object_or_404
from django.views.decorators.http import require_POST
from django.views.decorators.cache import cache_page
from django.urls import reverse
from .models import GCaMPDataset, GCaMPNeuron, GCaMPPaper, GCaMPDatasetType
from connectome.models import Neuron, NeuronClass, Dataset, Synapse
from core.models import JSONCache


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
        'name', 'dataset_id', 'dataset_type', 'description','animal_visual_time')), cls=DjangoJSONEncoder)
    
    match_data = get_object_or_404(JSONCache, name="atanas_kim_2023_all_encoding_dict_match").json
    context = {'datasets_json': datasets_json, "match_data": match_data}

    return render(request, "activity/encoding_connectome.html", context)    

# @cache_page(60*60*24*30)
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
        dataset_types[type.type_id] = {"type_id": type.type_id, "name": type.name, "background-color": type.color_background}

    set_dataset_paper_array = []
    for paper_id in GCaMPDataset.objects.values_list("paper", flat=True).distinct():
        paper_obj = GCaMPPaper.objects.get(pk=paper_id)
        set_dataset_paper_array.append({
            "paper_id": paper_obj.paper_id,
            "title": paper_obj.title_short
        })

    context = {
        "datasets": json.dumps(list(datasets)),
        "dataset_types": json.dumps(dataset_types),
        "papers": json.dumps(list(set_dataset_paper_array), cls=DjangoJSONEncoder)
    }

    return render(request, "activity/dataset.html", context)

@cache_page(60*60*24*30)
def get_all_dataset(request):
    datasets = GCaMPDataset.objects.all().values("dataset_id", "dataset_type", "n_neuron",
                                                 "n_labeled", "max_t", "avg_timestep")
    
    return JsonResponse(list(datasets), safe=False)

@cache_page(60*60*24*30)
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
get all encoding from Atanas & Kim et al. 2023
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

# @cache_page(60*60*24*14)
def get_behavior(request, dataset_id):
    dataset = get_object_or_404(GCaMPDataset, dataset_id=dataset_id)
    behavior = dataset.behavior
    data = {
        "data": {
            "behavior": behavior,
            "events": dataset.events
        },
        "dataset_id": dataset_id,
        "avg_timestep": dataset.avg_timestep,
        "max_t": dataset.max_t
    }

    return JsonResponse(data)

def get_dataset_neuron_data(dataset):
    neuron_data = {}
    for neuron in dataset.neurons.all():
        neuron_data[neuron.idx_neuron] = {
            "name": str(neuron.idx_neuron) if neuron.neuron_name == "" else f"{neuron.idx_neuron} ({neuron.neuron_name})",
            "label": neuron.neuron_name,
            "class": neuron.neuron_class.name if neuron.neuron_class else "",
            "idx_neruon": neuron.idx_neuron
        }

    return neuron_data


def plot_dataset(request, dataset_id):
    dataset = get_object_or_404(GCaMPDataset, dataset_id=dataset_id)
    neuron_data = get_dataset_neuron_data(dataset)
    encoding = dataset.encoding

    # neural trace for initial plot
    trace_init = {}
    str_neuron_list = request.GET.get("n")
    if str_neuron_list:
        list_neuron = str_neuron_list.split('-')
        try:
            list_idx_neuron = [int(x) for x in list_neuron]
            for idx_neuron in list_idx_neuron:
                neuron = get_object_or_404(GCaMPNeuron, dataset=dataset, idx_neuron=idx_neuron)
                trace_init[idx_neuron] = {"trace": neuron.trace, "idx_neuron": neuron.idx_neuron, "dataset_id": dataset_id}
        except ValueError:
            return HttpResponseBadRequest("Invalid neurons or error loading neurons.")

    data = {
        "neuron": neuron_data,
        "dataset_id": dataset_id,
        "dataset_name": dataset.dataset_name,
        "dataset_type": dataset.dataset_type,
        "avg_timestep": dataset.avg_timestep,
        "max_t": dataset.max_t,
        "cor": dataset.neuron_cor,
        "encoding_data_exists": bool(encoding),
    }

    if dataset.events:
        data["events"] = dataset.events
    if len(trace_init) > 0:
        data["trace_init"] = trace_init
    
    # connectome dataset
    datasets = Dataset.objects.all()
    datasets_json = json.dumps(list(datasets.values(
        'name', 'dataset_id', 'dataset_type', 'description','animal_visual_time')), cls=DjangoJSONEncoder)

    context = {
        "paper": dataset.paper,
        "dataset_id": dataset_id,
        "dataset_name": dataset.dataset_name,
        "dataset_type": dataset.dataset_type,
        "data": json.dumps(data, cls=DjangoJSONEncoder),
        'datasets_json': datasets_json,
        "show_connectome": "neuropal" in dataset.dataset_type,
        "show_encoding": bool(encoding)
    }
    
    return render(request, "activity/explore.html", context)


"""
render plot multiple datasets from the selected datsets from the find_neuron view
"""
def plot_multiple(request):
    # start_time = time.time()  # Record start time
    data = request.session.pop("plot-multiple-data", {})
    dataset_ids = list(data.keys())
    datasets = GCaMPDataset.objects.filter(dataset_id__in=dataset_ids)
    dataset_map = {dataset.dataset_id: dataset for dataset in datasets}

    plots = []
    colors = {}
    list_dataset_meta = []
    for dataset_id in data:
        dataset = dataset_map[dataset_id]

        list_idx_neuron = data[dataset_id]
        neurons = GCaMPNeuron.objects.filter(dataset__dataset_id=dataset_id, idx_neuron__in=list_idx_neuron)
        neuron_map = {neuron.idx_neuron: neuron for neuron in neurons}

        trace_data = []
        for idx_neuron in list_idx_neuron:
            neuron = neuron_map[idx_neuron]
            neuron_name = neuron.neuron_name
            trace_data.append({"idx_neuron": idx_neuron, "trace": neuron.trace, "name": neuron_name}) # "trace_original": neuron.trace_original
            if neuron_name not in colors:
                colors[neuron_name] = len(colors)

        plots.append({
            "dataset_type": dataset.dataset_type,
            "dataset_id": dataset.dataset_id,
            "dataset_name": dataset.dataset_name,
            "trace_data": trace_data,
            "avg_timestep": dataset.avg_timestep,
            "max_t": dataset.max_t
        })
        list_dataset_meta.append({
            "dataset_id": dataset.dataset_id,
            "dataset_name": dataset.dataset_name,
            "dataset_type": dataset.dataset_type,
        })
    
    context = {
        "list_dataset_meta": list_dataset_meta,
        "plots": json.dumps({"data": plots, "colors": colors}, cls=DjangoJSONEncoder)
    }
    # end_time = time.time()  # Record end time
    # processing_time = end_time - start_time
    # print(f"View processing time: {processing_time:.4f} seconds")

    return render(request, "activity/plot_multiple.html", context)

"""
plot multipel datasets. receive data request and handle
"""
@require_POST
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