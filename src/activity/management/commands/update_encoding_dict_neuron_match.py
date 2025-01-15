from django.core.management.base import BaseCommand
from connectome.models import Neuron, NeuronClass
from activity.views import get_dataset_encoding, get_dataset_neuron_data
from core.models import JSONCache
import json
import os

PATH_ENCODING_TABLE = ["activity", "encoding_table.json"]

'''

Paths, import

'''
def get_dataset_path(list_part):
    current_dir = os.getcwd()
    parent_dir = os.path.dirname(current_dir)
    
    return os.path.join(parent_dir, "initial_data", *list_part)

def load_json(self, path_json):
    if not os.path.exists(path_json):
        self.stdout.write(self.style.ERROR(f"{path_json} does not exists"))
    with open(path_json, 'r') as file:
        return json.load(file)

class Command(BaseCommand):
    help = 'Update the encoding dictionary (aggregate of neurons across datasets) JSON data'

    def handle(self, *args, **options):
        path_json = get_dataset_path(PATH_ENCODING_TABLE)
        encoding_table = load_json(self, path_json)
        
        list_class = encoding_table["class"]
        list_class_processed = list_class.copy()

        dict_match = {}

        for neuron_ in list_class:
            if Neuron.objects.filter(name=neuron_).exists():
                dict_match[neuron_] = neuron_
                list_class_processed.remove(neuron_)
            elif NeuronClass.objects.filter(name=neuron_).exists():
                neuron_class = NeuronClass.objects.get(name=neuron_)
                if len(neuron_class.neurons.all()) > 2:
                    # special cases such as RMD, RME
                    # other variants are added with manual splits
                    if neuron_ not in ["RMD", "RME"]:
                        self.stdout.write(self.style.ERROR(f"{neuron_} is a special case but not RMD, RME"))
                    dict_match[neuron_ + "L"] = neuron_
                    dict_match[neuron_ + "R"] = neuron_
                    list_class_processed.remove(neuron_)
                else:
                    for neuron in neuron_class.neurons.all():
                        dict_match[neuron.name] = neuron_
                    list_class_processed.remove(neuron_)
            else:
                exist_l = Neuron.objects.filter(name=neuron_ + "L").exists()
                exist_r = Neuron.objects.filter(name=neuron_ + "R").exists()

                if exist_l and exist_r:
                    dict_match[neuron_ + "L"] = neuron_
                    dict_match[neuron_ + "R"] = neuron_

                    list_class_processed.remove(neuron_)

                if not (exist_l and exist_r):
                    self.stdout.write(self.style.ERROR(f"{neuron_} should have both L and R but L: {exist_l} R: {exist_r}"))

        if len(list_class_processed) > 0:
            self.stdout.write(self.style.ERROR(f"Not all neurons in the encoding table were processed. missing: {list_class_processed}"))

        # reverse and check
        for neuron_class in NeuronClass.objects.all():
            name_ = neuron_class.name
            if neuron_class.split_lr:
                check_q = [name_+c in list_class for c in ["L", "R"]]
                if not all(check_q):
                    self.stdout.write(self.style.ERROR(f"{name_}: LR split is true but missing L or R. Check: {check_q}"))
            if neuron_class.split_dv:
                # NOTE: SAA is split partially
                check_q = [name_+c in list_class for c in ["D", "V"]]
                if not all(check_q):
                    self.stdout.write(self.style.ERROR(f"{name_}: DV split is true but missing D or V. Check: {check_q}"))
            if neuron_class.split_d_lr:
                check_q = [name_+c in list_class for c in ["DL", "DR"]]
                if not all(check_q):
                    self.stdout.write(self.style.ERROR(f"{name_}: D split is true but missing DL or DR. Check: {check_q}"))
            if neuron_class.split_v_lr:
                check_q = [name_+c in list_class for c in ["VL", "VR"]]
                if not all(check_q):
                    self.stdout.write(self.style.ERROR(f"{name_}: V split is true but missing VL or VR. Check: {check_q}"))

        json_str = json.dumps(dict_match)

        obj, created = JSONCache.objects.get_or_create(name="atanas_kim_2023_all_encoding_dict_match")
        obj.json = json_str
        obj.save()