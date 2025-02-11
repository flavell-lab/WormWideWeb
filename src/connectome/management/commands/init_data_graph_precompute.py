from django.core.management.base import BaseCommand
from connectome.graph_init import initialize_graphs
import pickle
class Command(BaseCommand):
    help = 'Pre-compute and pickle graph data'

    def handle(self, *args, **options):
        dataset_graphs = initialize_graphs()
        with open("connectome_graphs.pkl", "wb") as f:
            pickle.dump(dataset_graphs, f)
        self.stdout.write(self.style.SUCCESS("graph pre-compute success"))
