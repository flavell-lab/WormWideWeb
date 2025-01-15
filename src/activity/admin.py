from django.contrib import admin
from .models import GCaMPDataset, GCaMPNeuron, GCaMPPaper
# Register your models here.
class GCaMPDatasetAdmin(admin.ModelAdmin):
    search_fields = ["dataset_id"]
    list_display = ["dataset_id", "max_t", "n_neuron", "n_labeled"]

class GCaMPNeuronAdmin(admin.ModelAdmin):
    search_fields = ["dataset__dataset_id", "neuron_name"]

admin.site.register(GCaMPDataset, GCaMPDatasetAdmin)
admin.site.register(GCaMPNeuron, GCaMPNeuronAdmin)
admin.site.register(GCaMPPaper)
