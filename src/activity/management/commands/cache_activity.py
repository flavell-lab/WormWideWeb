from django.core.management.base import BaseCommand
from activity.views import get_dataset_encoding, get_neural_trace_data, get_behavior_data, get_encoding_data
from activity.models import GCaMPDataset
import time

def cache_datasets(self):
    t1 = time.time_ns()
    datasets = GCaMPDataset.objects.all()

    for dataset in datasets:
        dataset_id = dataset.dataset_id
        n_neuron = dataset.n_neuron
        n_labeled = dataset.n_labeled
        
        # behavior
        get_behavior_data(dataset_id)

        # encoding
        if dataset.encoding:
            get_encoding_data(dataset_id)

        # neural traces
        for idx_neuron in range(1, n_neuron+1):
            get_neural_trace_data(dataset_id, idx_neuron)
    
    t2 = time.time_ns()
    self.stdout.write(self.style.SUCCESS(f"Neural/behavior datacached for {len(datasets)} datasets. Time: {(t2-t1)/1e9} s"))

class Command(BaseCommand):
    help = 'Cache activity module data'

    def handle(self, *args, **options):
        cache_datasets(self)