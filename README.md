# WormWideWeb

## General notes on the architecture
### Database: sqlite3
- the data rarely changes (i.e. there's no need to dynamically update both the activity and the connectonme data).  
- the app is also entirely read-only.  
- the app is containerized and can scale up over multiple instances.  

These factors in combination led to selecting `sqlite3` for the database, which minimizes the deployment cost. During the build process, the database is populated and then copied to the final image. Since each container instance would have a copy and since there's no write operations, there's no need to run a database service. Since each instance has its own read-only copy, there's no issue with DB concurrency. However, this implies that building a new container image is necessary if we want to add or modify the data.

### Cache: Redis
Since the containers are ephemeral (i.e. they spin down if there's no traffic) and automatically scaled (i.e. automatically launch more instances if there's any traffic overflow), Redis is used as the singular place for caching (key value pairs).

### Backend: Django
Django in python runs the backend, handling various operations such as serving user requests, caching, DB interface, and computing.

### Frontend: Django and JavaScript
JavaScript implements the front end, while some components are rendered with Django HTML templating.

## Django notes
### Django apps
- `activity`: models and views for the GCaMP (neural) and behavioral datasets.  
- `connectome`: contains the models and views for the connectome features.  
- `core`: handles core operations, contains core/shared utility functions, and serves certain pages such as the index.  

### Django management commands
Note: if the database doesn't contain the connectome-related models/data, it is necessary to run `init_data_connectome` before running any other commands.  
- `init_data_connectome`: import and initlaize the connectome data.  
- `init_data_graph_precompute`: precompute the networkx graph objects necessary for the find route feature.  
- `init_data_gcamp`: initialize and import all GCaMPPaper, GCaMPDatasetType, and GCaMPNeuron.  
- `update_encoding_dict_neuron_match`: import the encoding table (from the Atanas & Kim et al., 2023 paper) and match those neurons.  
- `update_encoding_dict`: update the encoding dictionary (aggregate of neurons across datasets) JSON data.  
- `update_neuron_match_dict`: create and store the precomputed match dictionary (which dataset has which labeled neuron).  

## APIs
### connectome
- `api/available-neurons/`: all available neurons across the selected connectome datasets.  
- `api/get-edges/`: get the connectivity data.  
- `api/find-paths/`: find all paths from the start neuron to the end neuron.  

### activity
- `api/data/<str:dataset_id>/<int:idx_neuron>/`: neural trace of neuron number `idx_neuron` from `dataset_id`.  
- `path('api/data/<str:dataset_id>/behavior/`: behavioral data for `dataset_id`.  
- `api/data/<str:dataset_id>/encoding/`: encoding table for `dataset_id`.  
- `api/data/atanas_kim_2023_encoding/`: encoding table from the Atanas & Kim et al. 2023 paper.  
- `api/data/datasets/`: for the dataset table. contains metadata (paper, name, length, number of neurons, etc.) for all neural datasets.  
- `api/data/find_neuron/`: neuron-dataset match info for the find neuron feature.  

## initial_data
All connectome datasets, GCaMP/behavior datasets, and various configurations are placed in the directory named `initial_data` located in the same directory as `src`.  
```
initial_data
- activity
    - data
        - atanas_kim_2023
            - 2021-05-26-07.json
              ...
        - dag_nwabudike_kang_2023
              ...
    - dataset_types.json
    - encoding_table.json
    - papers.json
- config
    - gcamp_neuron_class_name_map_manual.json
    - gcamp_neuron_name_map_manual.json
    - neuron_class_split_manual.json
    - neuron_class_split.json
- connectome
    - connectome
        - white_1986_whole.json
          ...
    - connectome_datasets.json
    - connectome_neurons.json
```
