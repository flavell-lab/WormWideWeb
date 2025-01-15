from django.contrib import admin
from .models import Neuron, NeuronClass, Dataset, Synapse

admin.site.register(NeuronClass)
admin.site.register(Neuron)
admin.site.register(Dataset)
admin.site.register(Synapse)