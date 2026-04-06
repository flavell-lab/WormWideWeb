from django.urls import path
from . import views

urlpatterns = [
    path("", views.index, name="connectome-index"),
    path("explore/", views.explore, name="connectome-explore"),
    path("development/", views.development, name="connectome-development"),
    path("path/", views.path, name="connectome-path"),
    path("compare/", views.compare, name="connectome-compare"),
    path(
        "api/available-neurons/",
        views.available_neurons,
        name="connectome-available-neurons",
    ),
    path("api/get-edges/", views.get_edges, name="connectome-get-edges"),
    path("api/find-paths/", views.find_paths, name="connectome-find-paths"),
]
