from django.core.management.base import BaseCommand
from connectome.views import get_edge_response_data, connectome_datasets
from connectome.models import Dataset
import time

def cache_datasets(self):
    t1 = time.time_ns()
    connectome_datasets()

    set_neurons = set()
    set_classes = set()
    list_datasets = []

    datasets = Dataset.objects.all()
    for dataset in datasets:
        list_datasets.append(dataset.dataset_id)
        set_neurons.update(list(dataset.available_neurons.values_list("name", flat=True)))
        set_classes.update(list(dataset.available_classes.values_list("name", flat=True)))
    
    list_datasets.sort()
    
    data = {}
    data["datasets"] = list_datasets
    data["show_individual_neuron"] = True
    data["show_connected_neuron"] = True

    data["neurons"] = list(sorted(set_neurons))
    data["classes"] = []
    get_edge_response_data(data)

    data["neurons"] = []
    data["classes"] = list(sorted(set_classes))
    get_edge_response_data(data)

    t2 = time.time_ns()
    self.stdout.write(self.style.SUCCESS(f"Cached connectome data. Time: {(t2-t1)/1e9} s"))

class Command(BaseCommand):
    help = 'Cache connectome module data'

    def handle(self, *args, **options):
        cache_datasets(self)