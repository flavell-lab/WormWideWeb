from django.core.management.base import BaseCommand
from django.core.management.base import CommandError
from django.db import transaction
from connectome.models import Neuron, NeuronClass, Dataset, Synapse
import json
import os
import time
from pathlib import Path
from core.utility import sha256, load_csv

PATH_DATSETS = ["connectome", "connectome_datasets.json"]
PATH_NEURONS = ["connectome", "connectome_neurons.csv"]
PATH_NEURONS_REPLACEMENT = ["config", "connectome_neurons_replacement.csv"]
PATH_CONNECTOME_DIR = ["connectome", "connectome"]
PATH_NEURON_CLASS_SPLIT = ["config", "connectome_neuron_class_split.csv"]
PATH_CHECKSUM = ["config", "data_checksum.json"]
INITIAL_DATA_DIR = Path(__file__).resolve().parents[4] / "initial_data"

def get_dataset_path(list_part):
    return INITIAL_DATA_DIR.joinpath(*list_part)

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
        path_checksum = get_dataset_path(PATH_CHECKSUM)
        with open(path_checksum, 'r') as file:
            dict_checksum = json.load(file)["connectome"]

        with transaction.atomic():
            t1 = time.time_ns()
            path_json = get_dataset_path(PATH_DATSETS)
            with open(path_json, 'r') as file:
                json_data = json.load(file)

            n_created = 0
            n_updated = 0
            for dataset in json_data:
                checksum_key = dataset["id"] + ".json"
                if checksum_key not in dict_checksum:
                    raise CommandError(f"Missing checksum for connectome dataset file '{checksum_key}'")

                _, created = Dataset.objects.update_or_create(
                    dataset_id=dataset["id"],
                    defaults={
                        "name": dataset["name"],
                        "dataset_type": dataset["type"],
                        "animal_time": dataset["time"],
                        "animal_visual_time": dataset["visualTime"],
                        "description": dataset["description"],
                        "citation": "$".join(dataset["citation"]),
                        "dataset_sha256": dict_checksum[checksum_key],
                    },
                )
                if created:
                    n_created += 1
                else:
                    n_updated += 1
            
            t2 = time.time_ns()
            self.stdout.write(
                self.style.SUCCESS(
                    f"Imported/updated connectome datasets. created={n_created} updated={n_updated}. "
                    f"Time: {(t2-t1)/1e9} s"
                )
            )

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

            n_neuron_class_created = 0
            n_neuron_class_updated = 0
            n_neuron_created = 0
            n_neuron_updated = 0
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
                    raise CommandError(f"Missing neuron class split metadata for '{neuron_class_str}'")

                # create neuron class
                neuron_class_obj, neuron_class_created = NeuronClass.objects.update_or_create(
                    name=neuron_class_str,
                    defaults={
                        "split_lr": split_lr,
                        "split_dv": split_dv,
                        "split_d_lr": split_d_lr,
                        "split_v_lr": split_v_lr,
                    },
                )
                if neuron_class_created:
                    n_neuron_class_created += 1
                else:
                    n_neuron_class_updated += 1

                # create neuron
                _, neuron_created = Neuron.objects.update_or_create(
                    name=neuron_name,
                    defaults={
                        "neuron_class": neuron_class_obj,
                        "cell_type": neuron_type_code,
                        "cell_type_desc": neuron_type,
                        "cell_category": neuron_category,
                        "lr": neuron_lr,
                        "dv": neuron_dv,
                    },
                )
                if neuron_created:
                    n_neuron_created += 1
                else:
                    n_neuron_updated += 1

        t2 = time.time_ns()
        self.stdout.write(
            self.style.SUCCESS(
                "Imported/updated neurons. "
                f"neuron_classes(created={n_neuron_class_created}, updated={n_neuron_class_updated}), "
                f"neurons(created={n_neuron_created}, updated={n_neuron_updated}). "
                f"Time: {(t2-t1)/1e9} s"
            )
        )

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

        path_json = get_dataset_path(PATH_DATSETS)
        with open(path_json, 'r') as file:
            data_datasets = json.load(file)
        skip_gap_junction = {}
        for dataset in data_datasets:
            if "skip_gap_junction" in dataset:
                skip_gap_junction[dataset["id"]] = dataset["skip_gap_junction"]
            else:
                skip_gap_junction[dataset["id"]] = False

        with transaction.atomic():
            t1 = time.time_ns()
            # Neuron, NeuronClass, and Dataset cache
            neuron_map = {n.name: n for n in Neuron.objects.all()}
            datasets = {d.dataset_id: d for d in Dataset.objects.all()}
            neuron_to_id = {n.name: n.id for n in Neuron.objects.all()}
            neuron_to_neuron_class_id = {n.name: n.neuron_class.id for n in Neuron.objects.all()}

            # Load files
            path_connectome_dir = get_dataset_path(PATH_CONNECTOME_DIR)
            json_files = sorted([f for f in os.listdir(path_connectome_dir) if f.endswith('.json')])
            file_dataset_ids = {os.path.splitext(name)[0] for name in json_files}
            dataset_ids = set(datasets.keys())
            missing_files = sorted(dataset_ids - file_dataset_ids)
            if missing_files:
                raise CommandError(
                    "Dataset metadata exists without connectome JSON files for: "
                    + ", ".join(missing_files)
                )
            extra_files = sorted(file_dataset_ids - dataset_ids)
            if extra_files:
                raise CommandError(
                    "Connectome JSON files exist without dataset metadata for: "
                    + ", ".join(extra_files)
                )

            # Checksum
            path_checksum = get_dataset_path(PATH_CHECKSUM)
            with open(path_checksum, 'r') as file:
                dict_checksum = json.load(file)["connectome"]

            # Process each connectome dataset
            total_synapses = 0
            for json_name in json_files:
                path_json = os.path.join(path_connectome_dir, json_name)
                with open(path_json, 'r') as file:
                    json_data = json.load(file)

                dataset_name = os.path.splitext(json_name)[0]
                if json_name not in dict_checksum:
                    raise CommandError(f"Missing checksum entry for '{json_name}'")
                file_checksum = sha256(path_json)
                if file_checksum != dict_checksum[json_name]:
                    raise CommandError(
                        f"Checksum error for '{dataset_name}'. expected={dict_checksum[json_name]} actual={file_checksum}"
                    )
                if dataset_name not in datasets:
                    raise CommandError(f"Dataset '{dataset_name}' is missing from connectome_datasets.json")
                dataset_obj = datasets[dataset_name]

                # Get synapse data
                new_synapse_dict = {}
                for syn in json_data:
                    syn_type_raw = syn.get("typ")
                    syn_type = "c" if syn_type_raw == 0 else "e" if syn_type_raw == 2 else None
                    if syn_type is None:
                        raise CommandError(
                            f"Invalid synapse type in dataset '{dataset_name}': typ={syn_type_raw}"
                        )
                    
                    # skip creation if the config skips gap junction/electrical synapse
                    if syn_type == "e" and skip_gap_junction[dataset_name]:
                        continue

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
                                    
                # Rebuild dataset synapses idempotently.
                Synapse.objects.filter(dataset=dataset_obj).delete()

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
                                dataset=dataset_obj,
                                pre=neuron_map[pre],
                                post=neuron_map[post],
                                synapse_type=syn_type,
                                synapse_count=syn_count,
                            )
                        )

                Synapse.objects.bulk_create(new_synapses)
                total_synapses += len(new_synapses)
                dataset_obj.available_neurons.set(sorted(available_neuron_ids))
                dataset_obj.available_classes.set(sorted(available_neuron_class_ids))

                self.stdout.write(self.style.SUCCESS("Imported " + str(len(new_synapses)) + " synapses from " + dataset_name))
            t2 = time.time_ns()
            self.stdout.write(
                self.style.SUCCESS(
                    f"Imported {len(json_files)} connectome datasets with {total_synapses} synapses. "
                    f"Total time: {(t2-t1)/1e9} seconds"
                )
            )

    def handle(self, *args, **options):
        self.import_dataset()
        self.import_neuron()
        self.import_connectome()
