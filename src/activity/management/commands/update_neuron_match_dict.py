from django.core.management.base import BaseCommand
from activity.models import GCaMPDataset, GCaMPNeuron
from core.models import JSONCache
from collections import defaultdict
import json

def generate_match_dict():
    # Initialize dictionaries
    class_to_combinations = defaultdict(set)
    class_lr_dv_to_dataset_neurons = defaultdict(lambda: defaultdict(list))
    
    # Query all GCaMPNeurons with related NeuronClass and Dataset, excluding neurons with no NeuronClass
    neurons = GCaMPNeuron.objects.select_related('neuron_class', 'dataset').filter(
        neuron_class__isnull=False
    ).values(
        'neuron_class__name',  # NeuronClass name
        'dv',                   # Dorsal/Ventral
        'lr',                   # Left/Right
        'dataset__dataset_id',  # Dataset ID
        'idx_neuron'            # Neuron index
    )
    
    # Iterate through each neuron to populate both dictionaries
    for neuron in neurons:
        class_name = neuron['neuron_class__name']
        dv = neuron['dv']
        lr = neuron['lr']
        dataset_id = neuron['dataset__dataset_id']
        idx_neuron = neuron['idx_neuron']
        
        # Dictionary 1
        class_to_combinations[class_name].add(tuple([dv, lr]))  # Use tuple for set uniqueness
        
        # Dictionary 2
        outer_key = f"{class_name}_{lr}_{dv}"
        class_lr_dv_to_dataset_neurons[outer_key][dataset_id].append(idx_neuron)
    
    # Convert sets to lists for Dictionary 1
    class_combinations_dict = { 
        class_name: [list(combination) for combination in combinations] 
        for class_name, combinations in class_to_combinations.items()
    }
    
    # Convert nested defaultdicts to regular dicts for Dictionary 2
    dict_match = { 
        outer_key: dict(inner_dict) 
        for outer_key, inner_dict in class_lr_dv_to_dataset_neurons.items()
    }
    
    neuropal_datasets = GCaMPDataset.objects.filter(dataset_type__icontains='neuropal').values(
        'paper__paper_id',
        'paper__title_short',
        'dataset_id',
        'dataset_type',
        'n_neuron',
        'n_labeled',
        'max_t'
    )
    
    neuropal_datasets_data = [
        {   'paper': {'paper_id': dataset['paper__paper_id'], 'title': dataset['paper__title_short']},
            'dataset_id': dataset['dataset_id'],
            'dataset_type': dataset['dataset_type'],
            'n_neuron': dataset['n_neuron'],
            'n_labeled': dataset['n_labeled'],
            'max_t': dataset['max_t']
        }
        for dataset in neuropal_datasets
    ]

    return class_combinations_dict, dict_match, neuropal_datasets_data

class Command(BaseCommand):
    help = 'Update the neuron class match JSON data'

    def handle(self, *args, **options):
        dict_class, dict_match, neuropal_datasets_data = generate_match_dict()
        data = {"class": dict_class, "match": dict_match, "neuropal_datasets_data": neuropal_datasets_data}
        json_str = json.dumps(data)

        obj, created = JSONCache.objects.get_or_create(name="neuropal_match")
        obj.json = json_str
        obj.save()
        