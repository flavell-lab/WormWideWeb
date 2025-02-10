from django.db import models
from connectome.models import Neuron, NeuronClass

def empty_json():
    return {}

class GCaMPPaper(models.Model):
    def __str__(self) -> str:
        return self.paper_id
    
    paper_id = models.CharField(max_length=100, unique=True)
    title_full = models.CharField(max_length=300)
    title_short = models.CharField(max_length=100)

    class Meta:
        verbose_name = 'GCaMP Paper'
        verbose_name_plural = 'GCaMP Papers'

class GCaMPDatasetType(models.Model):
    def __str__(self) -> str:
        return self.name

    type_id = models.CharField(max_length=150, unique=True)
    name = models.CharField(max_length=20)
    description = models.CharField(max_length=300)
    color_background = models.CharField(max_length=25, default="#000000")
    color_text = models.CharField(max_length=25, default="#000000")
    paper = models.ForeignKey(GCaMPPaper, on_delete=models.CASCADE, related_name="dataset_types", blank=True, null=True)

    class Meta:
        verbose_name = 'GCaMP Dataset Type'
        verbose_name_plural = 'GCaMP Dataset Types'


class GCaMPDataset(models.Model):
    def __str__(self) -> str:
        return f"{self.dataset_id} (n_t: {str(self.max_t)} n_neuron: {str(self.n_neuron)} n_label: {str(self.n_labeled)})"
    # paper
    paper = models.ForeignKey(GCaMPPaper, on_delete=models.CASCADE, related_name="datasets", blank=True, null=True)

    # dataset
    dataset_id = models.CharField(max_length=200, unique=True)
    dataset_name = models.CharField(max_length=100)
    dataset_type = models.ManyToManyField(GCaMPDatasetType, related_name="datasets")

    # time
    avg_timestep = models.FloatField(default=0.)
    max_t = models.PositiveSmallIntegerField(default=0)
    timestamp_confocal = models.JSONField(default=empty_json)
    # ranges = models.JSONField(default=empty_json)

    # counts
    n_neuron = models.PositiveSmallIntegerField(default=0)
    n_labeled = models.PositiveSmallIntegerField(default=0)

    # behavior
    behavior = models.JSONField(default=empty_json)

    # behavior truncated
    truncated_behavior = models.JSONField(default=empty_json)

    # encoding
    encoding = models.JSONField(default=empty_json)
    
    # event
    events = models.JSONField(default=empty_json)

    # processed trace
    neuron_cor = models.JSONField(default=empty_json) # z-normalized
    neuron_cor_original = models.JSONField(default=empty_json) # original

    class Meta:
        verbose_name = 'GCaMP Dataset'
        verbose_name_plural = 'GCaMP Datasets'

class GCaMPNeuron(models.Model):
    def __str__(self):
        return f"{self.dataset.dataset_id} - {self.idx_neuron} {self.neuron_name}"
    
    dataset = models.ForeignKey(GCaMPDataset, on_delete=models.CASCADE, related_name="neurons")
    neuron_name = models.CharField(max_length=10, blank=True)
    neuron_class = models.ForeignKey(NeuronClass, on_delete=models.CASCADE, related_name="gcamp_neurons", null=True)
    idx_neuron = models.PositiveIntegerField(default=0)
    
    LR_CHOICES = (
        ('l', 'left'),
        ('r', 'right'),
        ('?', 'unknown'),
        ('x', 'undefined'),
        ('n', 'not labeled')
    )
    DV_CHOICES = (
        ('d', 'dorsal'),
        ('v', 'ventral'),
        ('?', 'unknown'),
        ('x', 'undefined'),
        ('n', 'not labeled')
    )
    lr = models.CharField(max_length=1, choices=LR_CHOICES)
    dv = models.CharField(max_length=1, choices=DV_CHOICES)

    trace = models.JSONField(default=empty_json) # z normalized 
    trace_original = models.JSONField(default=empty_json) # original

    class Meta:
        verbose_name = 'GCaMP Neuron'
        verbose_name_plural = 'GCaMP Neurons'
        constraints = [
            models.UniqueConstraint(fields=['dataset', 'idx_neuron'], name='unique idx_neuron for each dataset')
        ]
