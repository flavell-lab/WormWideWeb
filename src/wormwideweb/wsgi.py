"""
WSGI config for wormwideweb project.

It exposes the WSGI callable as a module-level variable named ``application``.

For more information on this file, see
https://docs.djangoproject.com/en/5.1/howto/deployment/wsgi/
"""

import os

from django.core.wsgi import get_wsgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'wormwideweb.settings')

# init graph computation
from connectome.graph_init import initialize_graphs
import connectome.graph_data
connectome.graph_data.GRAPH_OBJECTS = initialize_graphs()

application = get_wsgi_application()