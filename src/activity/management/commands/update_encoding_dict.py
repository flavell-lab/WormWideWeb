from django.core.management.base import BaseCommand
from activity.models import GCaMPDataset
from activity.views import get_dataset_encoding, get_dataset_neuron_data
from core.models import JSONCache
import json

def generate_encoding_dict():
    datasets = GCaMPDataset.objects.filter(paper__paper_id="atanas_kim_2023")
    
    data = {}
    for dataset in datasets:
        list_dataset = dataset.dataset_type
        if dataset.n_labeled > 0 and all([dtype in ["baseline", "neuropal"] for dtype in list_dataset]):
            encoding_data = get_dataset_encoding(dataset)
            neuron_data = get_dataset_neuron_data(dataset)
            data[dataset.dataset_id] = {"neuron": neuron_data, "encoding": encoding_data, "dataset_name": dataset.dataset_name}

    return data

class Command(BaseCommand):
    help = 'Update the encoding dictionary (aggregate of neurons across datasets) JSON data'

    def handle(self, *args, **options):
        data = generate_encoding_dict()
        json_str = json.dumps(data)

        obj, created = JSONCache.objects.get_or_create(name="atanas_kim_2023_all_encoding_dict")
        obj.json = json_str
        obj.save()        