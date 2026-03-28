from pathlib import Path
from threading import Lock

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured


GRAPH_OBJECTS = None
_GRAPH_LOAD_LOCK = Lock()


def get_graph_objects():
    """
    Lazily load precomputed graph objects on first use.

    This keeps startup fast on cold boots and only pays deserialization
    cost when the path-finding API is actually used.
    """
    global GRAPH_OBJECTS
    if GRAPH_OBJECTS is not None:
        return GRAPH_OBJECTS

    with _GRAPH_LOAD_LOCK:
        if GRAPH_OBJECTS is not None:
            return GRAPH_OBJECTS

        from connectome.graph_init import load_precomputed_graphs

        graph_file = Path(settings.BASE_DIR) / "connectome_graphs.pkl"
        if not graph_file.exists():
            raise ImproperlyConfigured(
                f"Missing precomputed graph file: {graph_file}. "
                "Run `python manage.py init_data_graph_precompute` during build."
            )

        GRAPH_OBJECTS = load_precomputed_graphs(graph_file)
        return GRAPH_OBJECTS
