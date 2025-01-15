from django.db import models

class NeuronClass(models.Model):
    def __str__(self) -> str:
        return "Class: " + self.name
    name = models.CharField(max_length=10, unique=True)
    split_lr = models.BooleanField(
        null=True,
        default=None,
        verbose_name="Split Left/Right",
        help_text="Indicates if the neuron class is split into left/right."
    )
    split_dv = models.BooleanField(
        null=True,
        default=None,
        verbose_name="Split Dorsal/Ventral",
        help_text="Indicates if the neuron class is split into dorsal/ventral."
    )
    split_d_lr = models.BooleanField(
        null=True,
        default=None,
            verbose_name="Split Dorsal Left/Right",
        help_text="Indicates if the neuron class is split into dorsal left/right."
    )
    split_v_lr = models.BooleanField(
        null=True,
        default=None,
        verbose_name="Split Ventral Left/Right",
        help_text="Indicates if the neuron class is split into ventral left/right."
    )

class Neuron(models.Model):
    def __str__(self):
        return self.name
    
    name = models.CharField(max_length=10, unique=True)
    neuron_class = models.ForeignKey(NeuronClass, on_delete=models.CASCADE,
                                     related_name="neurons")
    LR_CHOICES = (
        ('l', 'left'),
        ('r', 'right')
    )
    DV_CHOICES = (
        ('d', 'dorsal'),
        ('v', 'ventral')
    )
    lr = models.CharField(max_length=1, choices=LR_CHOICES, blank=True)
    dv = models.CharField(max_length=1, choices=DV_CHOICES, blank=True)

    in_head = models.BooleanField()
    in_tail = models.BooleanField()
    is_embryonic = models.BooleanField()
    neurotransmitter_type = models.CharField(max_length=5)
    cell_type = models.CharField(max_length=5)

class Dataset(models.Model):
    def __str__(self) -> str:
        return self.dataset_id
    
    dataset_id = models.CharField(max_length=25, unique=True)
    name = models.CharField(max_length=50)
    dataset_type = models.CharField(max_length=10)
    animal_time = models.DecimalField(max_digits=3,decimal_places=1)
    animal_visual_time = models.DecimalField(max_digits=3,decimal_places=1)
    description = models.CharField(max_length=100)
    available_neurons = models.ManyToManyField(Neuron, related_name="datasets")
    available_classes = models.ManyToManyField(NeuronClass, related_name="datasets")

class Synapse(models.Model):
    def __str__(self) -> str:
        return self.pre.name + "->" + self.post.name + " n=" + str(self.synapse_count) +\
            " type: " + self.synapse_type
    
    SYNAPSE_CHOICES = (
        ('e', 'electrical'),
        ('c', 'chemical')
    )

    synapse_count = models.PositiveSmallIntegerField()
    synapse_type = models.CharField(max_length=1, choices=SYNAPSE_CHOICES, db_index=True)
    post = models.ForeignKey(Neuron, on_delete=models.CASCADE, related_name="post", db_index=True)
    pre = models.ForeignKey(Neuron, on_delete=models.CASCADE, related_name="pre", db_index=True)
    dataset = models.ForeignKey(Dataset, on_delete=models.CASCADE, related_name="synapses", db_index=True)