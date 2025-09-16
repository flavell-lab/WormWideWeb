from django.core.management.base import BaseCommand
from django.db import transaction
from connectome.models import Neuron, NeuronClass, Dataset, Synapse
import json
import csv
import os
import time
from core.utility import sha256, load_csv

PATH_DATSETS = ["connectome", "connectome_datasets.json"]
PATH_NEURONS = ["connectome", "connectome_neurons.csv"]
PATH_NEURONS_REPLACEMENT = ["config", "connectome_neurons_replacement.csv"]
PATH_CONNECTOME_DIR = ["connectome", "connectome"]
PATH_NEURON_CLASS_SPLIT = ["config", "connectome_neuron_class_split.csv"]
PATH_CHECKSUM = ["config", "data_checksum.json"]

def get_dataset_path(list_part):
    current_dir = os.getcwd()
    parent_dir = os.path.dirname(current_dir)
    
    return os.path.join(parent_dir, "initial_data", *list_part)

def convert_split_str(str_):
    if str_ == "1":
        return True
    elif str_ == "-1":
        return None
    elif str_ == "0":
        return False
    else:
        raise ValueError
        

class Command(BaseCommand):
    help = 'Import and initialize connectome data'

    # dataset
    def import_dataset(self):
        path_checksumn = get_dataset_path(PATH_CHECKSUM)
        with open(path_checksumn, 'r') as file:
            dict_checksum = json.load(file)["connectome"]

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
                            description = dataset["description"], citation="$".join(dataset["citation"]),
                            dataset_sha256 = dict_checksum[dataset["id"] + ".json"])
                )
            
            if new_datasets:
                Dataset.objects.bulk_create(new_datasets)
            
            t2 = time.time_ns()
            self.stdout.write(self.style.SUCCESS(f"Imported {len(new_datasets)} connectome dataset. Time: {(t2-t1)/1e9} s"))

    def import_neuron(self):
        t1 = time.time_ns()

        with transaction.atomic():
            # connectome neuron and neuron class split data
            data_neuron = load_csv(get_dataset_path(PATH_NEURONS))
            
            data_split = {}
            for split_ in load_csv(get_dataset_path(PATH_NEURON_CLASS_SPLIT))[1:]:
                class_name = split_[0]
                split_lr = convert_split_str(split_[1])
                split_dv = convert_split_str(split_[2])
                split_d_lr = convert_split_str(split_[3])
                split_v_lr = convert_split_str(split_[4])
                data_split[class_name] = (split_lr, split_dv, split_d_lr, split_v_lr)

            new_neurons = []
            for neuron in data_neuron[1:]:
                # name	class	type	type_code	category	dv	lr
                neuron_name = neuron[0]
                neuron_class_str = neuron[1]
                neuron_type = neuron[2]
                neuron_type_code = neuron[3]
                neuron_category = neuron[4]
                neuron_dv = neuron[5]
                neuron_lr = neuron[6]

                # load the manual split for d/v and l/r
                if neuron_class_str in data_split:
                    split_lr, split_dv, split_d_lr, split_v_lr = data_split[neuron_class_str]
                else:
                    self.stdout.write(self.style.ERROR(f"neuron class {neuron_class_str} not found in neuron_class_split.json"))
                    raise KeyError

                # create neuron class
                neuron_class_obj, q_created = NeuronClass.objects.get_or_create(
                    name=neuron_class_str,
                    split_lr=split_lr, split_dv=split_dv,
                    split_d_lr=split_d_lr, split_v_lr=split_v_lr
                )

                # create neuron
                new_neurons.append(
                    Neuron(
                        name=neuron_name,
                        neuron_class=neuron_class_obj,
                        cell_type=neuron_type_code,
                        cell_type_desc=neuron_type,
                        cell_category=neuron_category,
                        lr=neuron_lr,
                        dv=neuron_dv
                    )
                )

            if new_neurons:
                Neuron.objects.bulk_create(new_neurons)

        t2 = time.time_ns()
        self.stdout.write(self.style.SUCCESS(f"Imported neurons. count: {len(new_neurons)}. Time: {(t2-t1)/1e9} s"))

    # add connectome
    def import_connectome(self):
        name_replacement = {}
        for n in load_csv(get_dataset_path(PATH_NEURONS_REPLACEMENT))[1:]:
            name_replacement[n[0]] = n[1]

        def replace_name(name):
            if name in name_replacement:
                return name_replacement[name]
            else:
                return name

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

                dataset_name = os.path.splitext(json_name)[0]
                assert sha256(path_json) == dict_checksum[json_name], "Checksum error for " + dataset_name

                # Get synapse data
                new_synapse_dict = {}
                for syn in json_data:
                    syn_type = "c" if syn["typ"] == 0 else "e" if syn["typ"] == 2 else None
                    assert syn_type is not None, f"Invalid synapse type: {syn['typ']}"
                    
                    syn["pre"] = replace_name(syn["pre"])
                    syn["post"] = replace_name(syn["post"])

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
                        # raise KeyError
                    if post not in neuron_map:
                        both_neuron_exist = False
                        self.stdout.write(self.style.WARNING(dataset_name + ": " + pre + " -> " + post + " (post) does not exist"))
                        # raise KeyError
                    
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