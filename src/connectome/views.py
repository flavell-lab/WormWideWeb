import json
import networkx as nx
from django.shortcuts import render
from django.http import JsonResponse, HttpResponse
from django.core.serializers.json import DjangoJSONEncoder
from django.views.decorators.cache import cache_page
from django.views.decorators.csrf import csrf_exempt
from django.db.models import Q, Prefetch
from .models import Neuron, NeuronClass, Dataset, Synapse
from collections import defaultdict
import connectome.graph_data 

def index(request):
    context = {}
    
    return render(request, "connectome/index.html", context)

def explore(request):
    datasets = Dataset.objects.all()
    datasets_json = json.dumps(list(datasets.values(
        'name', 'dataset_id', 'dataset_type', 'description','animal_visual_time')), cls=DjangoJSONEncoder)
    context = {'datasets_json': datasets_json}

    return render(request, "connectome/explore.html", context)

def path(request):
    datasets = Dataset.objects.all()
    datasets_json = json.dumps(list(datasets.values(
        'name', 'dataset_id', 'dataset_type', 'description','animal_visual_time')), cls=DjangoJSONEncoder)
    context = {'datasets_json': datasets_json}

    return render(request, "connectome/path.html", context)

# @cache_page(60*60) # in seconds
@cache_page(60*60*24*14)
def available_neurons(request):
    datasets_str = request.GET.get('datasets') 
    if datasets_str is None:
        return HttpResponse("Error: datasets parameter not found", status=400)
    dataset_ids = datasets_str.split(',')

    # filter datasets
    datasets = Dataset.objects.filter(dataset_id__in=dataset_ids)

    # Use sets to collect unique neurons and neuron classes
    neurons = set()
    neuron_classes = set()
    for dataset in datasets:
        neurons.update(dataset.available_neurons.all())
        neuron_classes.update(dataset.available_classes.all())

    # Serialize neurons and neuron classes
    neurons_data = {}
    neuron_classes_data = {}
    for neuron in neurons:
        neurons_data[neuron.name] = {'neuron_class': neuron.neuron_class.name, 'name': neuron.name,
                                'cell_type': neuron.cell_type, 'neurotransmitter_type': neuron.neurotransmitter_type,
                                'in_head': neuron.in_head, 'in_tail': neuron.in_tail, 'is_embryonic': neuron.is_embryonic}
    for cls in neuron_classes:
        neuron_classes_data[cls.name] = [neuron.name for neuron in cls.neurons.all()]

    data = {
        'neurons': neurons_data,
        'neuron_classes': neuron_classes_data
    }

    return JsonResponse(data)

def get_edge_response_data(data):
    list_nodes = set()
    datasets = data["datasets"]
    neurons = data["neurons"]
    classes = data["classes"]
    show_individual_neuron = data["show_individual_neuron"]
    show_connected_neuron = data["show_connected_neuron"]

    # Fetch datasets
    dataset_objs = list(Dataset.objects.filter(dataset_id__in=datasets))

    # Fetch neuron classes and neurons
    neuron_class_objs = list(NeuronClass.objects.filter(name__in=classes))
    neuron_objs = list(Neuron.objects.filter(name__in=neurons))

    # Restrict synapses based on show_connected_neuron
    synapse_filters = Q(dataset__in=dataset_objs)
    if not show_connected_neuron:
        synapse_filters &= (
            Q(pre__in=neuron_objs, post__in=neuron_objs) |  # Between neurons
            Q(pre__in=neuron_objs, post__neuron_class__in=neuron_class_objs) |  # Neuron to class
            Q(pre__neuron_class__in=neuron_class_objs, post__in=neuron_objs) |  # Class to neuron
            Q(pre__neuron_class__in=neuron_class_objs, post__neuron_class__in=neuron_class_objs)  # Between classes
        )
    else:
        synapse_filters &= (
            Q(pre__in=neuron_objs) | Q(post__in=neuron_objs) |
            Q(pre__neuron_class__in=neuron_class_objs) | Q(post__neuron_class__in=neuron_class_objs)
        )

    synapses = Synapse.objects.select_related(
        'pre__neuron_class', 'post__neuron_class', 'dataset'
    ).filter(synapse_filters)

    # Prepare response structure
    synapse_dict = defaultdict(lambda: {"count": 0, "list_count": [0] * len(dataset_objs)})

    # Separate class logic
    list_separate_class = {neuron.neuron_class.name for neuron in neuron_objs}

    # Process synapses
    dataset_index_map = {dataset: idx for idx, dataset in enumerate(dataset_objs)}

    for synapse in synapses:
        # Determine `pre`
        if synapse.pre.neuron_class.name in classes:
            pre = synapse.pre.neuron_class.name
        elif show_individual_neuron or synapse.pre in neuron_objs:
            pre = synapse.pre.name
        elif synapse.pre.neuron_class.name in list_separate_class:
            pre = synapse.pre.name
        else:
            pre = synapse.pre.neuron_class.name

        # Determine `post`
        if synapse.post.neuron_class.name in classes:
            post = synapse.post.neuron_class.name
        elif show_individual_neuron or synapse.post in neuron_objs:
            post = synapse.post.name
        elif synapse.post.neuron_class.name in list_separate_class:
            post = synapse.post.name
        else:
            post = synapse.post.neuron_class.name

        list_nodes.update([pre, post])

        # Create key and aggregate data
        key = (pre, post, synapse.synapse_type)
        synapse_dict[key]['count'] += synapse.synapse_count
        synapse_dict[key]['list_count'][dataset_index_map[synapse.dataset]] += synapse.synapse_count


    # Build unique synapse list
    list_e_synapse_key = set()
    list_synapse_dict = []
    for (pre, post, synapse_type), value in synapse_dict.items():
        e_key = pre + post
        e_key_inverse = post + pre

        if synapse_type == "e" and e_key_inverse in list_e_synapse_key:
            continue

        list_synapse_dict.append({
            "pre": pre,
            "post": post,
            "type": synapse_type,
            "count": value["count"],
            "list_count": value["list_count"],
        })

        if synapse_type == "e":
            list_e_synapse_key.add(e_key)

    # add orphaned nodes
    if not show_connected_neuron:
        for neuron_class in neuron_class_objs:
            if neuron_class not in list_nodes:
                list_nodes.add(neuron_class.name)
        for neuron in neuron_objs:
            if neuron not in list_nodes:
                list_nodes.add(neuron.name)

    # Format the response
    response = {
        "datasets": datasets,
        "neurons": sorted(list(list_nodes)),
        "synapses": list_synapse_dict,
    }

    return response

# @csrf_exempt
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

    # except Exception as e:
    #     return JsonResponse({'error': str(e)}, status=500)
