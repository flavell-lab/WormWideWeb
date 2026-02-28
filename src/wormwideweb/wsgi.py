"""
WSGI config for wormwideweb project.

It exposes the WSGI callable as a module-level variable named ``application``.

For more information on this file, see
https://docs.djangoproject.com/en/5.1/howto/deployment/wsgi/
"""

import os
from pathlib import Path
from django.core.wsgi import get_wsgi_application
from django.urls import get_resolver
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'wormwideweb.settings')

# Now create the WSGI application.
application = get_wsgi_application()

# preload
get_resolver(settings.ROOT_URLCONF).url_patterns

# Initialize graph computation.
from connectome.graph_init import load_precomputed_graphs
import connectome.graph_data
graph_file = Path(settings.BASE_DIR) / "connectome_graphs.pkl"
if not graph_file.exists():
    raise ImproperlyConfigured(
        f"Missing precomputed graph file: {graph_file}. "
        "Run `python manage.py init_data_graph_precompute` during build."
    )

try:
    connectome.graph_data.GRAPH_OBJECTS = load_precomputed_graphs(graph_file)
except Exception as exc:
    raise ImproperlyConfigured(
        f"Failed to load precomputed graph file ({graph_file}): {exc}"
    ) from exc
