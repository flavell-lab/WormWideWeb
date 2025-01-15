from django.urls import path
from . import views

urlpatterns = [
    path('', views.index, name="activity-index"),
    path('find-neuron/', views.find_neuron, name="activity-find-neuron"),
    path('dataset/', views.dataset, name="activity-dataset"),
    
    path('encoding/', views.index_encoding, name="encoding-index"),
    path('encoding/table/', views.encoding_table, name="encoding-table"),
    path('encoding/connectome/', views.encoding_connectome, name="encoding-connectome"),

    path('explore/<str:dataset_id>/', views.plot_dataset, name="activity-explore"),
    path('plot-multiple-data/', views.plot_multiple_data, name="activity-plot_multiple-data"),
    path('plot-multiple/', views.plot_multiple, name="activity-plot_multiple"),

    path('api/data/<str:dataset_id>/<int:idx_neuron>/', views.get_neural_trace, name="activity-get_neural_trace"),
    path('api/data/<str:dataset_id>/behavior/', views.get_behavior, name="activity-get_behavior"),
    path('api/data/<str:dataset_id>/encoding/', views.get_encoding, name="activity-get_encoding"),
    path('api/data/atanas_kim_2023_encoding/', views.get_all_dataset_encoding, name="activity-get_all_dataset_encoding"),
    path('api/data/datasets/', views.get_all_dataset, name="activity-datasets"),
]