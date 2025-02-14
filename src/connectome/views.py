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

    # Retrieve only the primary keys for datasets.
    dataset_ids = list(
        Dataset.objects.filter(dataset_id__in=datasets).values_list('pk', flat=True)
    )
    # Map each dataset primary key to its index.
    dataset_index_map = {ds_id: idx for idx, ds_id in enumerate(dataset_ids)}
    
    # Retrieve neuron classes and neurons.
    neuron_class_objs = list(NeuronClass.objects.filter(name__in=classes_input))
    neuron_objs = list(Neuron.objects.filter(name__in=neurons_input))
    neuron_ids = {neuron.pk for neuron in neuron_objs}
    
    # Precompute the set of neuron class names from the retrieved neurons.
    list_separate_class = {neuron.neuron_class.name for neuron in neuron_objs}

    # Build the base synapse filter.
    synapse_filters = Q(dataset__pk__in=dataset_ids)
    
    # Apply additional filtering based on the connectivity flag.
    if not show_connected_neuron:
        synapse_filters &= (
            Q(pre__in=neuron_objs, post__in=neuron_objs) |
            Q(pre__in=neuron_objs, post__neuron_class__in=neuron_class_objs) |
            Q(pre__neuron_class__in=neuron_class_objs, post__in=neuron_objs) |
            Q(pre__neuron_class__in=neuron_class_objs, post__neuron_class__in=neuron_class_objs)
        )
    else:
        synapse_filters &= (
            Q(pre__in=neuron_objs) | Q(post__in=neuron_objs) |
            Q(pre__neuron_class__in=neuron_class_objs) | Q(post__neuron_class__in=neuron_class_objs)
        )
    
    # Retrieve synapses with related objects to avoid extra queries.
    synapses = Synapse.objects.select_related(
        'pre__neuron_class', 'post__neuron_class', 'dataset'
    ).filter(synapse_filters)
    
    # Prepare data structures.
    synapse_dict = defaultdict(lambda: {"count": 0, "list_count": [0] * len(dataset_ids)})
    list_nodes = set()

    # Create a local in-function label cache to avoid recalculating labels for the same neuron.
    label_cache = {}

    def get_label(neuron):
        # Return cached label if already computed.
        if neuron.pk in label_cache:
            return label_cache[neuron.pk]
        cls_name = neuron.neuron_class.name
        # Choose label based on the provided conditions.
        if cls_name in classes_input:
            label = cls_name
        elif show_individual_neuron or neuron.pk in neuron_ids or cls_name in list_separate_class:
            label = neuron.name
        else:
            label = cls_name
        label_cache[neuron.pk] = label
        return label

    # Process synapses and aggregate counts.
    for synapse in synapses:
        pre = synapse.pre
        post = synapse.post
        pre_label = get_label(pre)
        post_label = get_label(post)
        
        # Add the computed labels to the set of nodes.
        list_nodes.add(pre_label)
        list_nodes.add(post_label)
        
        # Use the tuple (pre_label, post_label, synapse_type) as key.
        key = (pre_label, post_label, synapse.synapse_type)
        synapse_dict[key]["count"] += synapse.synapse_count
        ds_idx = dataset_index_map.get(synapse.dataset.pk)
        if ds_idx is not None:
            synapse_dict[key]["list_count"][ds_idx] += synapse.synapse_count

    # Build the final list of synapse data.
    list_synapse_dict = []
    list_e_synapse_key = set()
    for (pre_label, post_label, synapse_type), value in synapse_dict.items():
        if synapse_type == "e":
            # For symmetric "e" type edges, avoid processing duplicate inverse keys.
            e_key = pre_label + post_label
            e_key_inverse = post_label + pre_label
            if e_key_inverse in list_e_synapse_key:
                continue
            list_e_synapse_key.add(e_key)
        list_synapse_dict.append({
            "pre": pre_label,
            "post": post_label,
            "type": synapse_type,
            "count": value["count"],
            "list_count": value["list_count"],
        })

    # Add orphaned nodes if not showing connected neurons.
    if not show_connected_neuron:
        for neuron_class in neuron_class_objs:
            list_nodes.add(neuron_class.name)
        for neuron in neuron_objs:
            list_nodes.add(neuron.name)

    # Format and return the response.
    response = {
        "datasets": datasets,
        "neurons": sorted(list_nodes),
        "synapses": list_synapse_dict,
    }
    return response


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
