from django.core.management.base import BaseCommand
from django.db import transaction
from connectome.models import Neuron, NeuronClass, Dataset, Synapse
import json
import os
import time
from core.utility import sha256

def has_redundant_items(l):
  return len(l) != len(set(l))

def find_redundant_items(l):
  s, d = set(), []
  for i in l:
    if i in s and i not in d: d.append(i)
    else: s.add(i)
  return d


PATH_DATSETS = ["connectome", "connectome_datasets.json"]
PATH_NEURONS = ["connectome", "connectome_neurons.json"]
PATH_CONNECTOME_DIR = ["connectome", "connectome"]
PATH_NEURON_CLASS_SPLIT = ["config", "neuron_class_split.json"]
PATH_CHECKSUM = ["config", "data_checksum.json"]

def get_dataset_path(list_part):
    current_dir = os.getcwd()
    parent_dir = os.path.dirname(current_dir)
    
    return os.path.join(parent_dir, "initial_data", *list_part)


def str_diff(str1, str2):
    """
    Finds the difference between two strings, assuming str1 is a prefix of str2.

    Args:
        str1: The shorter string (or prefix).
        str2: The longer string.

    Returns:
        The difference between the strings (the suffix of str2), or None if str1 is not a prefix of str2.
        Returns empty string if the strings are the same.
    """
    if str2.startswith(str1):
        if len(str1) < len(str2):
            return str2[len(str1):]
        else:
            return "" #Strings are the same
    else:
        return None

# Define a helper function to validate split variables
def validate_split(self, split_var, split_name, neuron_name, neuron_suffix):
    if not isinstance(split_var, bool):
        self.stdout.write(
            self.style.WARNING(
                f"{neuron_name} {neuron_suffix} but {split_name}: {split_var}"
            )
        )

# Define a mapping for neuron_suffix to their corresponding lr and dv values and split checks
NEURON_SUFFIX_MAP = {
    "D": {"lr": "", "dv": "d", "split": "split_dv"},
    "V": {"lr": "", "dv": "v", "split": "split_dv"},
    "L": {"lr": "l", "dv": "", "split": "split_lr"},
    "R": {"lr": "r", "dv": "", "split": "split_lr"},
    "DL": {"lr": "l", "dv": "d", "split": "split_d_lr"},
    "DR": {"lr": "r", "dv": "d", "split": "split_d_lr"},
    "VL": {"lr": "l", "dv": "v", "split": "split_v_lr"},
    "VR": {"lr": "r", "dv": "v", "split": "split_v_lr"},
}

class Command(BaseCommand):
    help = 'Import and initialize connectome data'

    # dataset
    def import_dataset(self):
        try:
            with transaction.atomic():
                t1 = time.time_ns()
                path_json = get_dataset_path(PATH_DATSETS)
                with open(path_json, 'r') as file:
                    json_data = json.load(file)

                new_datasets = []
                for dataset in json_data:
                    new_datasets.append(
                        Dataset(dataset_id = dataset["id"], name = dataset["name"], dataset_type = dataset["type"],
                                animal_time = dataset["time"], animal_visual_time = dataset["visualTime"],
                                description = dataset["description"], citation="$".join(dataset["citation"]))
                    )
                
                if new_datasets:
                    Dataset.objects.bulk_create(new_datasets)
                
                t2 = time.time_ns()
                self.stdout.write(self.style.SUCCESS(f"Imported {len(new_datasets)} connectome dataset. Time: {(t2-t1)/1e9} s"))
        except:
            self.stdout.write(self.style.ERROR("Error importing datasets"))

    # neuron classes and neurons
    def import_neuron(self):
        try:
            with transaction.atomic():
                t1 = time.time_ns()
                # connectome neuron data
                path_json = get_dataset_path(PATH_NEURONS)
                with open(path_json, 'r') as file:
                    json_data = json.load(file)
                
                # neuron class L/R, D/V split info
                path_json = get_dataset_path(PATH_NEURON_CLASS_SPLIT)
                with open(path_json, 'r') as file:
                    neuron_class_split = json.load(file)
                    neuron_class_split = neuron_class_split["others"] | neuron_class_split["manual"]

                new_neurons = []
                for neuron in json_data:
                    neuron_class_str = neuron["classes"]
                    neuron_name = neuron["name"]

                    # load the manual split for d/v and l/r
                    if neuron_class_str in neuron_class_split:
                        split_lr, split_dv, split_d_lr, split_v_lr = neuron_class_split[neuron_class_str]
                    else:
                        self.stdout.write(self.style.ERROR(f"neuron class {neuron_class_str} not found in neuron_class_split.json"))
                        raise KeyError
                    
                    # create neuron class
                    neuron_class_obj, q_created = NeuronClass.objects.get_or_create(name=neuron_class_str,
                                                                                    split_lr=split_lr, split_dv=split_dv,
                                                                                    split_d_lr=split_d_lr, split_v_lr=split_v_lr)

                    neuron_suffix = str_diff(neuron_class_str, neuron_name)

                    # Initialize lr and dv
                    lr, dv = '', ''

                    if neuron_suffix in NEURON_SUFFIX_MAP:
                        config = NEURON_SUFFIX_MAP[neuron_suffix]
                        split_var = config["split"]
                        split_var_value = locals().get(split_var)
                        
                        # Validate the split variable
                        validate_split(self, split_var_value, split_var, neuron_name, neuron_suffix)
                        
                        lr = config["lr"]
                        dv = config["dv"]
                        
                    elif neuron_class_str.startswith("BWM"):
                        # Validate all relevant split variables
                        for split_var in ["split_v_lr", "split_d_lr", "split_dv"]:
                            split_var_value = locals().get(split_var)
                            if not isinstance(split_var_value, bool):
                                self.stdout.write(
                                    self.style.WARNING(
                                        f"{neuron_name} {neuron_suffix} error in {split_var}"
                                    )
                                )
                        
                        # Ensure neuron_name has enough characters
                        if len(neuron_name) >= 6:
                            dv = neuron_name[4].lower()
                            lr = neuron_name[5].lower()
                        else:
                            self.stdout.write(
                                self.style.WARNING(
                                    f"{neuron_name} does not have enough characters for dv and lr extraction."
                                )
                            )
                            dv, lr = '', ''
                            
                    elif neuron_class_str == "g1":
                        if neuron_name.startswith("g1A"):
                            split_var_value = split_lr
                            validate_split(self, split_var_value, "split_lr", neuron_name, neuron_suffix)
                            
                            if len(neuron_name) >= 4:
                                lr = neuron_name[3].lower()
                            else:
                                self.stdout.write(
                                    self.style.WARNING(
                                        f"{neuron_name} does not have enough characters for lr extraction."
                                    )
                                )
                                lr = ''
                            dv = ''
                        else:
                            lr, dv = '', ''
                            
                    elif neuron_class_str == "DefecationMuscles":
                        if neuron_name.startswith("intmu"):
                            split_var_value = split_lr
                            validate_split(self, split_var_value, "split_lr", neuron_name, neuron_suffix)
                            
                            if len(neuron_name) >= 6:
                                lr = neuron_name[5].lower()
                            else:
                                self.stdout.write(
                                    self.style.WARNING(
                                        f"{neuron_name} does not have enough characters for lr extraction."
                                    )
                                )
                                lr = ''
                            dv = ''
                        else:
                            # Reset split variables to None
                            split_lr, split_dv, split_d_lr, split_v_lr = None, None, None, None
                            lr, dv = '', ''
                            
                    else:
                        # Check if any split variables are not None
                        if any(
                            var is not None
                            for var in [split_lr, split_dv, split_d_lr, split_v_lr]
                        ):
                            self.stdout.write(
                                self.style.WARNING(
                                    f"{neuron_name} {neuron_suffix} split_ should all be None"
                                )
                            )
                        lr, dv = '', ''
                        self.stdout.write(
                            self.style.WARNING(
                                f"No D/V L/R split info: class: {neuron_class_str} name: {neuron_name}"
                            )
                        )

                    # cerate neuron
                    new_neurons.append(
                        Neuron(
                            name=neuron_name,
                            neuron_class=neuron_class_obj,
                            in_head=(neuron["inhead"] == 1),
                            in_tail=(neuron["intail"] == 1),
                            neurotransmitter_type=neuron["nt"],
                            is_embryonic=(neuron["emb"] == 1),
                            cell_type=neuron["typ"],
                            lr=lr,
                            dv=dv
                        )
                    )

                if new_neurons:
                    Neuron.objects.bulk_create(new_neurons)

                t2 = time.time_ns()
                self.stdout.write(self.style.SUCCESS(f"Imported neurons. count: {len(new_neurons)}. Time: {(t2-t1)/1e9} s"))
        except Exception as e:
            self.stdout.write(self.style.ERROR("Error importing neurons: " + str(e)))
            

    # add connectome
    def import_connectome(self):
        with transaction.atomic():
            t1 = time.time_ns()
            # Neuron, NeuronClass, and Dataset cache
            neuron_map = {n.name: n for n in Neuron.objects.all()}
            datasets = {d.dataset_id: d for d in Dataset.objects.all()}
            neuron_to_id = {n.name: n.id for n in Neuron.objects.all()}
            neuron_to_neuron_class_id = {n.name: n.neuron_class.id for n in Neuron.objects.all()}

            # Load files
            path_connectome_dir = get_dataset_path(PATH_CONNECTOME_DIR)
            json_files = [f for f in os.listdir(path_connectome_dir) if f.endswith('.json')]

            # Checksum
            path_checksumn = get_dataset_path(PATH_CHECKSUM)
            with open(path_checksumn, 'r') as file:
                dict_checksum = json.load(file)["connectome"]

            # Process each connectome dataset
            for json_name in json_files:
                path_json = os.path.join(path_connectome_dir, json_name)
                with open(path_json, 'r') as file:
                    json_data = json.load(file)

                assert sha256(path_json) == dict_checksum[json_name], "Checksum error for " + dataset_name

                dataset_name = os.path.splitext(json_name)[0]

                # Get synapse data
                new_synapse_dict = {}
                for syn in json_data:
                    syn_type = "c" if syn["typ"] == 0 else "e" if syn["typ"] == 2 else None
                    assert syn_type is not None, f"Invalid synapse type: {syn['typ']}"
                    
                    syn_key = (syn["pre"], syn["post"], syn_type)
                    if syn_key in new_synapse_dict:
                        new_synapse_dict[syn_key]["synapse_count"] += sum(syn["syn"])
                    else:
                        new_synapse_dict[syn_key] = {
                            "pre": syn["pre"],
                            "post": syn["post"],
                            "synapse_type": syn_type,
                            "synapse_count": sum(syn["syn"]),
                        }
                                    
                # Create Synapse objects
                new_synapses = []
                available_neuron_ids = set()
                available_neuron_class_ids = set()
                for syn_key, syn_data in new_synapse_dict.items():
                    pre, post, syn_type, syn_count = syn_data["pre"], syn_data["post"], syn_data["synapse_type"], syn_data["synapse_count"]

                    # check if pre and post exists
                    both_neuron_exist = True
                    if pre not in neuron_map:
                        both_neuron_exist = False
                        self.stdout.write(self.style.WARNING(dataset_name + ": " + pre + " -> " + post + " (pre) does not exist"))
                    if post not in neuron_map:
                        both_neuron_exist = False
                        self.stdout.write(self.style.WARNING(dataset_name + ": " + pre + " -> " + post + " (post) does not exist"))

                    # create Synapse object
                    if both_neuron_exist:
                        available_neuron_ids.update([neuron_to_id[pre], neuron_to_id[post]])
                        available_neuron_class_ids.update([neuron_to_neuron_class_id[pre], neuron_to_neuron_class_id[post]])

                        new_synapses.append(
                            Synapse(
                                dataset=datasets[dataset_name],
                                pre=neuron_map[pre],
                                post=neuron_map[post],
                                synapse_type=syn_type,
                                synapse_count=syn_count,
                            )
                        )

                Synapse.objects.bulk_create(new_synapses)
                if available_neuron_ids:
                    datasets[dataset_name].available_neurons.add(*available_neuron_ids)
                if available_neuron_class_ids:
                    datasets[dataset_name].available_classes.add(*available_neuron_class_ids)

                self.stdout.write(self.style.SUCCESS("Imported " + str(len(new_synapses)) + " synapses from " + dataset_name))
            t2 = time.time_ns()
            self.stdout.write(self.style.SUCCESS(f"Imported {len(json_files)} connectome. Total time: {(t2-t1)/1e9} seconds"))

    def handle(self, *args, **options):
        self.import_dataset()
        self.import_neuron()
        self.import_connectome()