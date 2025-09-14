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
            'name', 'dataset_id', 'dataset_type', 'description','animal_visual_time','citation','dataset_sha256')), cls=DjangoJSONEncoder)
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
    neurons_input = set(data["neurons"])
    classes_input = set(data["classes"])
    show_individual_neuron = data["show_individual_neuron"]
    show_connected_neuron = data["show_connected_neuron"]

    # neuron_class names for neurons in neurons_input.
    list_class_split = set(
        Neuron.objects.filter(name__in=neurons_input).values_list("neuron_class__name", flat=True)
    )

    # Initialize synapses structure.
    all_synapses = {dataset: {} for dataset in datasets}

    # Build all cache keys we need and a mapping for later splitting.
    keys_needed = []
    key_mapping = {}  # key -> (dataset, type, neuron_or_class)
    for dataset in datasets:
        for n in neurons_input:
            key = f"{dataset}!{n}"
            keys_needed.append(key)
            key_mapping[key] = (dataset, "neuron", n)
        for c in classes_input:
            key = f"{dataset}!{c}"
            keys_needed.append(key)
            key_mapping[key] = (dataset, "class", c)

    # Bulk fetch from cache.
    cached_results = cache.get_many(keys_needed)
    missing_keys = []
    for key in keys_needed:
        if key in cached_results and cached_results[key] is not None:
            k_dataset = key_mapping[key][0]
            k_neuron_or_class = key_mapping[key][2]
            all_synapses[k_dataset][k_neuron_or_class] = cached_results[key]
        else:
            missing_keys.append(key)

    # Group missing keys by (dataset, type) for bulk database queries.
    missing_group = defaultdict(list)
    for key in missing_keys:
        dataset, typ, value = key_mapping[key]
        missing_group[(dataset, typ)].append(value)

    # For each group, fetch synapses in one query and then split results.
    for (dataset, typ), values in missing_group.items():
        if typ == "neuron":
            qs = Synapse.objects.filter(
                dataset__dataset_id=dataset,
            ).filter(
                Q(pre__name__in=values) | Q(post__name__in=values)
            ).values_list(
                'pre__name', 'pre__neuron_class__name',
                'post__name', 'post__neuron_class__name',
                'synapse_type', 'synapse_count'
            )
        else:  # typ == "class"
            qs = Synapse.objects.filter(
                dataset__dataset_id=dataset,
            ).filter(
                Q(pre__neuron_class__name__in=values) | Q(post__neuron_class__name__in=values)
            ).values_list(
                'pre__name', 'pre__neuron_class__name',
                'post__name', 'post__neuron_class__name',
                'synapse_type', 'synapse_count'
            )

        # Prepare a dictionary to collect results per value.
        result_mapping = {val: [] for val in values}
        for syn in qs:
            pre_name, pre_class, post_name, post_class, syn_type, syn_count = syn
            if typ == "neuron":
                for val in values:
                    if pre_name == val or post_name == val:
                        result_mapping[val].append(syn)
            else:  # type "class"
                for val in values:
                    if pre_class == val or post_class == val:
                        result_mapping[val].append(syn)

        # Cache each result and update all_synapses.
        for val, syn_list in result_mapping.items():
            key = f"{dataset}!{val}"
            cache.set(key, syn_list, timeout=None)
            all_synapses[dataset][val] = syn_list

    # Helper functions.
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

    def get_synapse_key(pre_val, post_val, syn_type):
        # For type 'e', sort the labels to ensure consistency, since gap junctions are bidrectional
        if syn_type == "e":
            return f"{min(pre_val, post_val)}!{max(pre_val, post_val)}!{syn_type}"
        return f"{pre_val}!{post_val}!{syn_type}"

    # Precompute dataset indices.
    dataset_index = {dataset: idx for idx, dataset in enumerate(datasets)}

    # Aggregate synapse counts.
    collect_synapses = {}
    for dataset, synapse_collection in all_synapses.items():
        i_dataset = dataset_index[dataset]
        # Maintain a per-dataset set to avoid double counting.
        set_pair_added = set()
        for neuron_or_class, syn_list in synapse_collection.items():
            for syn in syn_list:
                pre_name, pre_class, post_name, post_class, syn_type, syn_count = syn

                # Decide whether to add the synapse based on filter conditions.
                if not show_connected_neuron:
                    if ((pre_name in neurons_input) or (pre_class in classes_input)) and \
                       ((post_name in neurons_input) or (post_class in classes_input)):
                        add_synapse = True
                    else:
                        add_synapse = False
                else:
                    add_synapse = True

                if add_synapse:
                    key = get_synapse_key(select_label(pre_name, pre_class),
                                          select_label(post_name, post_class),
                                          syn_type)
                    if key not in collect_synapses:
                        collect_synapses[key] = [0] * len(datasets)

                    # Use a secondary key to avoid double counting within this dataset.
                    # i.e. ADAL->AVA might show up twice if both ADAL and AVA were given
                    key_neurons = get_synapse_key(pre_name, post_name, syn_type)
                    if key_neurons not in set_pair_added:
                        collect_synapses[key][i_dataset] += syn_count
                        set_pair_added.add(key_neurons)

    # Build the return dictionary.
    return_dict = {
        "datasets": datasets,
        "neurons": [],
        "synapses": []
    }

    for syn_key in sorted(collect_synapses.keys()):
        pre, post, syn_type = syn_key.split("!")
        list_count = collect_synapses[syn_key]
        return_dict["synapses"].append({
            "pre": pre,
            "post": post,
            "type": syn_type,
            "count": sum(list_count),
            "list_count": list_count,
        })
        if pre not in return_dict["neurons"]:
            return_dict["neurons"].append(pre)
        if post not in return_dict["neurons"]:
            return_dict["neurons"].append(post)

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
