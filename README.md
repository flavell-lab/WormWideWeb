# WormWideWeb

## General notes on the architecture
### Database: sqlite3
- the data rarely changes (i.e. there's no need to dynamically update both the activity and the connectonme data).  
- the app is also entirely read-only.  
- the app is containerized and can scale up over multiple instances.  

These factors in combination led to selecting `sqlite3` for the database, which minimizes the deployment cost. During the build process, the database is populated and then copied to the final image. Since each container instance would have a copy and since there's no write operations, there's no need to run a database service. Since each instance has its own read-only copy, there's no issue with DB concurrency. However, this implies that building a new container image is necessary if we want to add or modify the data.

Note that this approach won't work if the number of datasets significantly increases since that'd make the container image too large. If so, setting up an instance of Cloud SQL PotgreSQL might be necessary.

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

## Environmental variables and secret keys
Env variables: 
- `DJ_DEBUG`: `0` or `1`. Must be set to `0` for deployment.  
- `DJ_ALLOWED_HOSTS`: `localhost` should be included for local development. space separated. e.g. `127.0.0.1 .run.app wormwideweb.org`
- `DJ_USE_REDIS`: `0` or `1`. Set it to `0` for local development (fallback to local memory caching).  
- `DJ_REDIS_URI`: Redis instance URI e.g. `redis://x.x.x.x:6379`

Secret keys (KEEP THESE SECRET):  
Be careful not to print these or write into a file in the deployment image. On GCP, the secrets are managed by GCP Secret Manager, so there's no need to bake them into the image.  
- `DJ_SECRET_KEY`:  your secret key.  
- `DJ_SECRET_KEY_BACKUP`: secret key backup for rotating (no need to set for development).   

## Local development
For local testing and development, first set the following environmental variables:  
- `DJ_DEBUG`: `1`  
- `DJ_ALLOWED_HOSTS`: `localhost`  
- `DJ_USE_REDIS`: `1`.  
- `DJ_SECRET_KEY`: use a random secret key that's not your deployment key.

Then run `src/populate_db.sh`. You only need to run this once for your local copy as long as you have the database file. On Apple M2, this takes about a minute.  
If the scripts finishes without any error, you can run `python manage.py runserver`. This is recommened for development as you can immediately preview the code you write.

Example:  
```bash
export DJ_DEBUG=1
export DJ_DB_BUILD=1
export DJ_ALLOWED_HOSTS="localhost"
export DJ_USE_REDIS=0
export DJ_SECRET_KEY="random secret key string"
export DJ_ADMIN=1

rm db.sqlite3
sh populate_db.sh

python manage.py collectstatic --noinput
python manage.py runserver
```


For deployment testing, building a docker image with the supplied `docker-compose.yml` is recommended. Run `docker compose build` and then `docker compose run -d`.  

## initial_data
All connectome datasets, GCaMP/behavior datasets, and various configurations are placed in the directory named `initial_data` located in the same directory as `src`.  

Directory structure: 
```
initial_data
- activity
    - data
        - atanas_kim_2023
            - 2021-05-26-07.json
              ...
        - dag_nwabudike_kang_2023
            - 2022-01-16-01.json
              ...
    - dataset_types.json
    - encoding_table.json
    - papers.json
- config
    - gcamp_neuron_class_name_map_manual.json
    - gcamp_neuron_name_map_manual.json
    - neuron_class_split_manual.json
    - neuron_class_split.json
    - data_checksum.json
- connectome
    - connectome
        - white_1986_whole.json
          ...
    - connectome_datasets.json
    - connectome_neurons.json
```

### Adding a new neural/behavioral dataset
Follow the insructions and your datasets will be populated into the database during the image build time.  

#### 1. add the paper metadata to `papers.json`
```json
[
    {
        "paper_id": "atanas_kim_2023",
        "title_full": "Brain-wide representations of behavior spanning multiple timescales and states in C. elegans",
        "title_short": "Atanas & Kim et al., 2023"
    },
    {
        "paper_id": "dag_nwabudike_kang_2023",
        "title_full": "Dissecting the functional organization of the C. elegans serotonergic system at whole-brain scale",
        "title_short": "Dag, Nwabudike & Kang et al., 2023"
    }
]
```
#### 2. add the dataset type(s) to `dataset_types.json`
Note that `id` should match the id in `dataset_type` within your neural data json file.  
Certain types such as NeuroPAL, which are common across multiple papers, should be added to the `common` section. Please do not add types such as `Baseline`, `Control`, and `GFP` to the common section, as they usually mean different things across the papers.  

```json
{
    "common": [
        {"id": "neuropal", "name": "NeuroPAL", "color_background": "#0d6efd", "description": "Datasets with NeuroPAL (i.e. identities of the recorded neurons are available)"}
    ],

    "atanas_kim_2023": [
        {"id": "baseline", "name": "Baseline", "color_background": "rgb(125,125,125)", "description": "Baseline dataset"},
        {"id": "heat", "name": "Heat", "color_background": "#dc3545", "description": "Heat stimulation experiment data"},
        {"id": "gfp", "name": "GFP", "color_background": "#198754", "description": "Control data with the GFP expression strain"}
    ],

    "dag_nwabudike_kang_2023": [
        {"id": "patchEncounter", "name": "Patch", "color_background": "#dc3545", "description": "Starved worm started off in a foodless zone and encountered a food patch"},
        {"id": "reFed", "name": "Re-fed", "color_background": "rgb(200,200,0)", "description": "Starved worm on a dense food patch"}
    ]
}
```
#### 3. add the dataset files
Add the individual dataset files from the paper `paper_id` to the following location:  
`initial_data/activity/data/${paper_id}/$file`  
Make sure that `paper_id` matches the `paper_id` in `dataset_types.json` and `papers.json`.  

#### 4. add the checksum data
Compute the file's SHA256 checksum and add it to `config/data_checksum.json`.  

