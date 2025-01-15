from django.urls import path
from django.contrib import admin
from . import views

urlpatterns = [
    path('', views.index, name="connectome-index"),
    path('explore/', views.explore, name="connectome-explore"),
    path('path/', views.path, name="connectome-path"),
    path('api/available-neurons/', views.available_neurons, name="connectome-available-neurons"),
    path('api/get-edges/', views.get_edges, name="connectome-get-edges"),
    path('api/find-paths/', views.find_paths, name='connectome-find-paths'),
]