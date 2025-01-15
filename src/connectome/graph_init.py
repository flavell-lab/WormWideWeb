import networkx as nx
import time
from .models import Dataset, Synapse
from django.db.models import Prefetch

def add_min_edge(g, a, b, syn_weight, syn_type):
    """
    Add or update an edge in the graph with the given attributes.
    Updates the edge only if the new weight is smaller.
    """
    if g.has_edge(a, b):
        if syn_weight > g[a][b]["weight"]:
            g[a][b]["weight"] = syn_weight
            g[a][b]["synapse_type"] = syn_type
    else:
        g.add_edge(a, b, weight=syn_weight, synapse_type=syn_type)

def add_edge(graphs, pre, post, pre_class, post_class, weight, synapse_type):
    """
    Add edges to multiple graphs, including neuron and neuron class graphs.
    """
    g, g_class, g_no_e, g_class_no_e = graphs

    # Add edge to all graphs
    add_min_edge(g, pre, post, weight, synapse_type)
    add_min_edge(g_class, pre_class, post_class, weight, synapse_type)

    # Exclude electrical synapses for certain graphs
    if synapse_type == "c":
        add_min_edge(g_no_e, pre, post, weight, synapse_type)
        add_min_edge(g_class_no_e, pre_class, post_class, weight, synapse_type)

def initialize_graphs():
    """Initialize graphs for each dataset."""
    print("init graph")
    t1 = time.time_ns()

    dataset_graphs = {}

    # Prefetch related data for optimization
    synapse_prefetch = Synapse.objects.select_related("pre", "post", "pre__neuron_class", "post__neuron_class")
    datasets = Dataset.objects.prefetch_related(Prefetch("synapses", queryset=synapse_prefetch))

    for dataset in datasets:
        # Initialize graphs
        g = nx.DiGraph()
        g_no_e = nx.DiGraph()
        g_class = nx.DiGraph()
        g_class_no_e = nx.DiGraph()

        # Populate graphs
        for synapse in dataset.synapses.all():
            pre_name = synapse.pre.name
            post_name = synapse.post.name
            pre_class_name = synapse.pre.neuron_class.name
            post_class_name = synapse.post.neuron_class.name

            add_edge(
                (g, g_class, g_no_e, g_class_no_e),
                pre_name, post_name,
                pre_class_name, post_class_name,
                synapse.synapse_count, synapse.synapse_type
            )

        # Store graphs for the dataset
        dataset_graphs[dataset.dataset_id] = {
            "neuron": {"all": g, "chemical_only": g_no_e},
            "class": {"all": g_class, "chemical_only": g_class_no_e},
        }

    t2 = time.time_ns()
    print(f"init graph done. elapsed: {(t2-t1)/1e9} seconds")

    return dataset_graphs