from django.core.management.base import BaseCommand
from connectome.models import Neuron, NeuronClass, Dataset, Synapse
import json
import os

PATH_WITVLIET_DATSETS = ["connectome", "witvliet_datasets.json"]
PATH_WITVLIET_NEURONS = ["connectome", "witvliet_neurons.json"]
PATH_WITVLIET_CONNECTOME_DIR = ["connectome", "connectome"]
PATH_NEURON_CLASS_SPLIT = ["config", "neuron_class_split.json"]

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
            path_json = get_dataset_path(PATH_WITVLIET_DATSETS)
            with open(path_json, 'r') as file:
                json_data = json.load(file)

            for dataset in json_data:
                dataset_obj, q_created = Dataset.objects.get_or_create(dataset_id = dataset["id"], name = dataset["name"], dataset_type = dataset["type"],
                                    animal_time = dataset["time"], animal_visual_time = dataset["visualTime"],
                                    description = dataset["description"])
                
            self.stdout.write(self.style.SUCCESS("Imported dataset"))
        except:
            self.stdout.write(self.style.ERROR("Error importing datasets"))

    # neuron classes and neurons
    def import_neuron(self):
        try:
            # connectome neuron data
            path_json = get_dataset_path(PATH_WITVLIET_NEURONS)
            with open(path_json, 'r') as file:
                json_data = json.load(file)
            
            # neuron class L/R, D/V split info
            path_json = get_dataset_path(PATH_NEURON_CLASS_SPLIT)
            with open(path_json, 'r') as file:
                neuron_class_split = json.load(file)
                neuron_class_split = neuron_class_split["others"] | neuron_class_split["manual"]

            n = 0
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

                # Assume 'str_diff' is defined elsewhere
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
                Neuron.objects.create(name=neuron_name, neuron_class=neuron_class_obj, in_head=neuron["inhead"]==1,
                                    in_tail=neuron["intail"]==1, neurotransmitter_type=neuron["nt"],
                                    is_embryonic=neuron["emb"]==1, cell_type=neuron["typ"], lr=lr, dv=dv)
                n = n + 1
            self.stdout.write(self.style.SUCCESS("Imported neurons. count: " + str(n)))
        except Exception as e:
            self.stdout.write(self.style.ERROR("Error importing neurons: " + str(e)))
            

    # add connectome
    def import_connectome(self):
        path_connectome_dir = get_dataset_path(PATH_WITVLIET_CONNECTOME_DIR)
        json_files = [f for f in os.listdir(path_connectome_dir) if f.endswith('.json')]

        for json_name in json_files:
            n = 0
            path_json = os.path.join(path_connectome_dir, json_name)
            with open(path_json, 'r') as file:
                json_data = json.load(file)
            dataset_name = os.path.splitext(json_name)[0]
            dataset_ = Dataset.objects.get(dataset_id=dataset_name)
            for syn in json_data:
                try:
                    pre_ = Neuron.objects.get(name=syn["pre"])
                except:
                    self.stdout.write(self.style.WARNING(dataset_name + ": " + syn["pre"] + " -> " + syn["post"] + " (pre) does not exist"))
                try:
                    post_ = Neuron.objects.get(name=syn["post"])
                except:
                    self.stdout.write(self.style.WARNING(dataset_name + ": " + syn["pre"] + " -> " + syn["post"] + " (post) does not exist"))

                # determine synapse type
                syn_type = None
                if syn["typ"] == 0:
                    syn_type = "c" # chem
                elif syn["typ"] == 2:
                    syn_type = "e" # electrical
                
                # create synapse
                Synapse.objects.create(pre=pre_, post=post_, dataset=dataset_,
                                    synapse_count=sum(syn["syn"]), synapse_type=syn_type)
                n = n + 1

                # add available neuron and neuron calss
                dataset_.available_classes.add(pre_.neuron_class, post_.neuron_class)
                dataset_.available_neurons.add(pre_, post_)
            self.stdout.write(self.style.SUCCESS("Imported " + str(n) + " synapses from " + dataset_name))
        self.stdout.write(self.style.SUCCESS("Imported connectome"))

    def handle(self, *args, **options):
        self.import_dataset()
        self.import_neuron()
        self.import_connectome()