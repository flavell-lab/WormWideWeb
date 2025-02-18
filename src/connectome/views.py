import json
import networkx as nx
from django.shortcuts import render
from django.http import JsonResponse, HttpResponse
from django.core.serializers.json import DjangoJSONEncoder
from django.core.cache import cache
from django.views.decorators.cache import cache_page, cache_control
from django.views.decorators.csrf import csrf_exempt
from django.db.models import Q, Prefetch
from .models import Neuron, NeuronClass, Dataset, Synapse
from collections import defaultdict
import connectome.graph_data 

def connectome_datasets(cache_key="connectome_datasets_json"):
    datasets_json = cache.get(cache_key)
    if datasets_json is None:
        datasets = Dataset.objects.all()
        datasets_json = json.dumps(list(datasets.values(
            'name', 'dataset_id', 'dataset_type', 'description','animal_visual_time','citation')), cls=DjangoJSONEncoder)
        cache.set(cache_key, datasets_json, timeout=None)

    return datasets_json


@cache_page(60*60*24*30)
def index(request):
    context = {}
    
    return render(request, "connectome/index.html", context)


@cache_page(60*60*24*30)
def explore(request):
    context = {'datasets_json': connectome_datasets()}

    return render(request, "connectome/explore.html", context)


@cache_page(60*60*24*30)
def path(request):
    context = {'datasets_json': connectome_datasets()}

    return render(request, "connectome/path.html", context)


@cache_control(public=True, max_age=60*60*24*90)
def available_neurons(request):
    """
    Return a JSON response with available neurons and neuron classes for each dataset
    specified by the "datasets" GET parameter. Instead of caching every combination,
    the results are cached per dataset_id.
    """
    datasets_str = request.GET.get('datasets')
    if not datasets_str:
        return HttpResponse("Error: datasets parameter not found", status=400)
    
    # Get the list of dataset IDs from the request.
    dataset_ids = datasets_str.split(',')
    
    # Final union dictionaries.
    final_neurons = {}
    final_neuron_classes = {}

    # For each dataset, try to get its available neurons from cache; if not, query and cache.
    for dataset_id in dataset_ids:
        cache_key = f"available_neurons_{dataset_id}"
        dataset_result = cache.get(cache_key)
        if dataset_result is None:
            # Prepare querysets with only needed fields.
            neuron_qs = (
                Neuron.objects
                .only('name', 'cell_type', 'neurotransmitter_type', 'in_head', 'in_tail', 'is_embryonic', 'neuron_class__name')
                .select_related('neuron_class')
            )
            neuron_class_qs = (
                NeuronClass.objects
                .only('name')
                .prefetch_related(Prefetch('neurons', queryset=Neuron.objects.only('name')))
            )
            # Fetch the dataset with prefetches for available neurons and classes.
            dataset_obj = (
                Dataset.objects
                .filter(dataset_id=dataset_id)
                .only('dataset_id')
                .prefetch_related(
                    Prefetch('available_neurons', queryset=neuron_qs),
                    Prefetch('available_classes', queryset=neuron_class_qs)
                )
                .first()
            )
            if not dataset_obj:
                continue  # Skip if no such dataset exists.
            
            # Collect available neurons and classes.
            neurons_set = set(dataset_obj.available_neurons.all())
            neuron_classes_set = set(dataset_obj.available_classes.all())
            
            # Serialize neurons keyed by name.
            neurons_data = {
                neuron.name: {
                    'neuron_class': neuron.neuron_class.name if neuron.neuron_class else None,
                    'name': neuron.name,
                    'cell_type': neuron.cell_type,
                    'neurotransmitter_type': neuron.neurotransmitter_type,
                    'in_head': neuron.in_head,
                    'in_tail': neuron.in_tail,
                    'is_embryonic': neuron.is_embryonic
                }
                for neuron in neurons_set
            }
            # Serialize neuron classes mapping class name to list of neuron names.
            neuron_classes_data = {
                cls.name: [n.name for n in cls.neurons.all()]
                for cls in neuron_classes_set
            }
            
            dataset_result = {
                'neurons': neurons_data,
                'neuron_classes': neuron_classes_data
            }
            # Cache the serialized result for this dataset.
            cache.set(cache_key, dataset_result, timeout=None)
        
        # Combine the dataset result into the final union.
        for neuron_name, neuron_info in dataset_result.get('neurons', {}).items():
            final_neurons[neuron_name] = neuron_info
        
        for cls_name, neuron_list in dataset_result.get('neuron_classes', {}).items():
            if cls_name in final_neuron_classes:
                # Merge lists and remove duplicates.
                final_neuron_classes[cls_name] = list(set(final_neuron_classes[cls_name]).union(neuron_list))
            else:
                final_neuron_classes[cls_name] = neuron_list

    data = {
        'neurons': final_neurons,
        'neuron_classes': final_neuron_classes
    }

    return JsonResponse(data)


def get_edge_response_data(data):
    datasets = data["datasets"]
    neurons_input = data["neurons"]
    classes_input = set(data["classes"])
    show_individual_neuron = data["show_individual_neuron"]
    show_connected_neuron = data["show_connected_neuron"]

    list_class_split = list(Neuron.objects.filter(name__in=neurons_input).values_list("neuron_class__name", flat=True))

    all_synapses = {}
    for dataset in datasets:
        all_synapses[dataset] = {}

    # fetch from cache
    query_manifest = []
    for dataset in datasets:
        for (type_, neuron_or_class) in [("neuron", n) for n in neurons_input] + [("class", c) for c in classes_input]:
            key_ = f"{dataset}!{neuron_or_class}"
            synapses = cache.get(key_)
            if synapses:
                all_synapses[dataset][neuron_or_class] = synapses
            else:
                query_manifest.append((dataset, type_, neuron_or_class))

    # query database
    for (dataset_, type_, neuron_or_class_) in query_manifest:
        if type_ == "neuron":
            synapses = Synapse.objects.filter(
            Q(pre__name=neuron_or_class_) | Q(post__name=neuron_or_class_),
            dataset__dataset_id=dataset_
            ).values_list('pre__name', 'pre__neuron_class__name', 'post__name', 'post__neuron_class__name', 'synapse_type', 'synapse_count')
        else:  # type_ == "class"
            synapses = Synapse.objects.filter(
            Q(pre__neuron_class__name=neuron_or_class_) | Q(post__neuron_class__name=neuron_or_class_),
            dataset__dataset_id=dataset_
            ).values_list('pre__name', 'pre__neuron_class__name', 'post__name', 'post__neuron_class__name', 'synapse_type', 'synapse_count')

        synapse_list = []
        for synapse in synapses:
            synapse_list.append(synapse)            
        cache.set(f"{dataset_}!{neuron_or_class_}", synapse_list, timeout=None)
        all_synapses[dataset_][neuron_or_class_] = synapse_list

    def select_label(neuron, neuron_class):
        if neuron in neurons_input:
            return neuron
        elif neuron_class in classes_input:
            return neuron_class
        else:
            if show_individual_neuron:
                return neuron
            else:
                if neuron_class in list_class_split:
                    return neuron
                else:
                    return neuron_class

    def get_synapse_key(pre_, post_, type_):
        if type_ == "e":
            if pre_ < post_:
                return f"{pre_}!{post_}!{type_}"
            else:
                return f"{post_}!{pre_}!{type_}"
        else:
            return f"{pre_}!{post_}!{type_}"

    # collect synapses to return
    collect_synapses = {}
    for dataset, synapse_collections in all_synapses.items():
        i_dataset = datasets.index(dataset)
        set_pair_added = set()
        for neuron_or_class, synapses in synapse_collections.items():
            for synapse in synapses:
                pre_ = synapse[0]
                pre_class_ = synapse[1]
                post_ = synapse[2]
                post_class_ = synapse[3]
                type_ = synapse[4]
                
                add_synapse = False
                if not show_connected_neuron:
                    if ((pre_ in neurons_input) or (pre_class_ in classes_input)) and \
                        ((post_ in neurons_input) or (post_class_ in classes_input)):
                        add_synapse = True
                else:
                    add_synapse = True

                if add_synapse:
                    key_ = get_synapse_key(select_label(pre_, pre_class_), select_label(post_, post_class_), type_)
                    if key_ not in collect_synapses:
                        collect_synapses[key_] = [0 for i in range(0, len(datasets))]
                    
                    key_neurons = get_synapse_key(pre_, post_, type_)
                    if key_neurons not in set_pair_added:
                        collect_synapses[key_][i_dataset] += synapse[5]
                        set_pair_added.add(key_neurons)

    return_dict = {
        "datasets": datasets,
        "neurons": [],
        "synapses": []
    }

    list_synapse_keys = sorted(collect_synapses.keys())
    for synapse_key in list_synapse_keys:
        pre_, post_, type_ = synapse_key.split("!")
        return_dict["synapses"].append({"pre": pre_, "post": post_, "type": type_, "count": sum(collect_synapses[synapse_key]), "list_count": collect_synapses[synapse_key]})
        if pre_ not in return_dict["neurons"]:
            return_dict["neurons"].append(pre_)
        if post_ not in return_dict["neurons"]:
            return_dict["neurons"].append(post_)

    return_dict["neurons"].sort()

    return return_dict


@csrf_exempt
def get_edges(request):
    if request.method == "POST":
        try:
            # Parse the JSON data
            data = json.loads(request.body)
            return JsonResponse(get_edge_response_data(data))
        except json.JSONDecodeError:
            return JsonResponse({'status': 'error', 'message': 'Invalid JSON'}, status=400)
    return JsonResponse({'status': 'error', 'message': 'Invalid request method'}, status=405)


def find_paths(request):
    """
    Find paths between two neurons within a dataset. 
    Higher edge count means shorter path. Option to exclude electrical synapses.
    Return paths with edge details.
    """
    if connectome.graph_data.GRAPH_OBJECTS is None:
        # Handle the case where initialization failed
        return JsonResponse({'error': 'Graph precompute data is not available'}, status=400)

    dataset_graphs = connectome.graph_data.GRAPH_OBJECTS

    # try:
    # parse query parameters
    dataset = request.GET.get('dataset')
    start_neuron = request.GET.get('start')
    end_neuron = request.GET.get('end')
    weighted = request.GET.get('weighted', 'true').lower() == 'true'
    gap_junction = request.GET.get('gap_junction', 'true').lower() == 'true'
    use_class = request.GET.get('class', 'false').lower() == 'true'

    # validate dataset
    if dataset not in dataset_graphs:
        return JsonResponse({'error': 'Invalid dataset'}, status=400)
    
    # get graph
    graph = dataset_graphs[dataset]["class" if use_class else "neuron"]["all" if gap_junction else "chemical_only"]

    # find all shortest paths
    try:
        paths = list(nx.all_shortest_paths(graph, source=start_neuron, target=end_neuron, method="dijkstra", weight=(lambda u, v, data: 1 / data['weight']) if weighted else None))
    except nx.NetworkXNoPath:
        return JsonResponse({'paths': [], 'message': 'No path found'})
    except nx.NodeNotFound:
        return JsonResponse({'error': 'Start or end neuron not found in the dataset'}, status=400)

    # add edge information for each path
    node_set = set()
    paths_with_details = []
    for path in paths:
        path_edges = []
        total_weight = 0
        for i in range(len(path) - 1):
            u, v = path[i], path[i + 1]
            node_set.update([u, v])
            edge_data = graph.get_edge_data(u, v)
            path_edges.append({
                'pre': u,
                'post': v,
                'count': edge_data.get('weight'),
                'type': edge_data.get('synapse_type')
            })
            total_weight += edge_data.get('weight')
        paths_with_details.append({
            'path': path,
            'edges': path_edges,
            'total_weight': total_weight
        })

    # Format response
    response = {
        'dataset_id': dataset,
        'start_neuron': start_neuron,
        'end_neuron': end_neuron,
        'use_weights': weighted,
        'use_gap_junction': gap_junction,
        'nodes': list(node_set),
        'paths': paths_with_details
    }
    return JsonResponse(response)
