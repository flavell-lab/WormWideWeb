from django.shortcuts import render
from activity.models import GCaMPDataset, GCaMPNeuron, GCaMPPaper
from connectome.models import Synapse, Dataset
from django.core.cache import cache

def index(request):
    count_data = cache.get("index_counter")

    if count_data is None:
        n_paper = GCaMPPaper.objects.count()
        n_dataset = GCaMPDataset.objects.count()
        n_neuron = GCaMPNeuron.objects.count()
        n_synapse = Synapse.objects.count()
        n_connectome_dataset = Dataset.objects.count()

        count_data = {"n_paper": n_paper, "n_dataset": n_dataset, "n_neuron": n_neuron,
        "n_synapse": n_synapse, "n_connectome_dataset": n_connectome_dataset}

        cache.set("index_counter", count_data, None)

    return render(request, "core/index.html", count_data)

def about(request):
    context = {}

    return render(request, "core/about.html", context)
