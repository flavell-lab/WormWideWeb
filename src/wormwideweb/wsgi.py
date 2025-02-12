"""
WSGI config for wormwideweb project.

It exposes the WSGI callable as a module-level variable named ``application``.

For more information on this file, see
https://docs.djangoproject.com/en/5.1/howto/deployment/wsgi/
"""

import os
from django.core.wsgi import get_wsgi_application
from django.db.backends.signals import connection_created

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'wormwideweb.settings')

def activate_pragmas(sender, connection, **kwargs):
    if connection.vendor == 'sqlite':
        cursor = connection.cursor()
        cursor.execute("PRAGMA cache_size = 102400;") # 100MB
        cursor.execute("PRAGMA temp_store = MEMORY;")
        # optional; make sure it's read only
        cursor.execute("PRAGMA synchronous = OFF;")

# Connect the signal as early as possible.
connection_created.connect(activate_pragmas)

# Now create the WSGI application.
application = get_wsgi_application()

# Initialize graph computation.
from connectome.graph_init import load_precomputed_graphs
import connectome.graph_data
connectome.graph_data.GRAPH_OBJECTS = load_precomputed_graphs()
