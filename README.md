# WormWideWeb
[![CI](https://github.com/flavell-lab/WormWideWeb/actions/workflows/ci.yml/badge.svg)](https://github.com/flavell-lab/WormWideWeb/actions/workflows/ci.yml)

WormWideWeb is a Django web application for exploring C. elegans connectome and activity datasets.

Production deployment: [wormwideweb.org](https://wormwideweb.org)

## Architecture

### Database: SQLite
- Data is imported at build/init time and served read-only at runtime.
- Each container instance has its own local SQLite file.
- This avoids operating a separate DB service and keeps cost/ops overhead low.

Runtime note: when `DJ_DB_BUILD=0` (default), SQLite is opened in read-only mode. Set `DJ_DB_BUILD=1` only when running migrations/import workflows (for example local bootstrapping or image build).

### Cache: Redis (optional in local dev)
- For production-scale, ephemeral containers, Redis is the shared cache backend.
- For local development, you can set `DJ_USE_REDIS=0` and use in-memory cache.

### Backend / Frontend
- Backend: Django (routing, templates, APIs, caching, data access).
- Frontend: Django templates + JavaScript.

## Django Apps
- `activity`: GCaMP neural/behavior datasets and related APIs/views.
- `connectome`: connectome models, graph APIs, and connectome pages.
- `core`: homepage/about/health and shared utilities.

## Data Dependency (`initial_data`)
This repo expects dataset/config files under `initial_data/` (next to `src/`).

Reference dataset repo: [WormWideWeb-data](https://github.com/flavell-lab/WormWideWeb-data/)

## Environment Variables

### Required
- `DJ_SECRET_KEY`: Django secret key.
- `DJ_ALLOWED_HOSTS`: space-separated hosts, for example `localhost 127.0.0.1`.

### Common Django Settings
- `DJ_DEBUG`: `0` or `1` (default `0`).
- `DJ_DB_BUILD`: `0` or `1` (default `0`).
- `DJ_ADMIN`: `0` or `1` (default `0`).
- `DJ_SECRET_KEY_BACKUP`: optional fallback key for key rotation.
- `DJ_CSRF_TRUSTED_ORIGINS`: optional, space-separated full origins with scheme.
  If unset, it is derived from `DJ_ALLOWED_HOSTS`.

### Cache Settings
- `DJ_USE_REDIS`: `0` or `1` (default `0`).
- `DJ_REDIS_URI`: required when `DJ_USE_REDIS=1`.
- `DJ_CACHE_VERSION`: optional cache key version suffix (default `v1`).

### Activity Dataset Signed Download Settings
- `ACTIVITY_DATA_GCS_BUCKET`: GCS bucket name (default `www-deploy-bucket`).
- `ACTIVITY_DATA_SIGNING_SERVICE_ACCOUNT_PATH`: path to service account JSON (optional).
- `ACTIVITY_DATA_SIGNING_SERVICE_ACCOUNT_JSON`: raw service account JSON (optional).
- `ACTIVITY_DATA_SIGNED_URL_EXPIRATION_SECONDS`: `1-604800` (default `600`).

## Local Development

From the repository root:

```bash
python3.13 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r config/requirements.runtime.pip

cd src
export DJ_DEBUG=1
export DJ_DB_BUILD=1
export DJ_ALLOWED_HOSTS="localhost 127.0.0.1"
export DJ_USE_REDIS=0
export DJ_SECRET_KEY="replace-with-local-dev-secret"
export DJ_ADMIN=1

rm -f db.sqlite3 connectome_graphs.pkl
sh populate_db.sh

python manage.py runserver
```

Notes:
- `populate_db.sh` runs migrations, collects static files, imports connectome/activity data, and precomputes graph data.
- Re-run `populate_db.sh` whenever `initial_data` changes.

Run tests:

```bash
cd src
python manage.py test
```

## Docker / Deployment-style Local Run

1. Generate build-time env file:

```bash
./create_build_config.sh
```

2. Build and start:

```bash
docker compose build
docker compose up -d
```

3. Open: `http://localhost:8000`

Notes:
- The Docker build uses BuildKit mounts (`--mount=type=bind` and `--mount=type=secret`), so BuildKit must be enabled.
- `config/default.env` is for local build/runtime convenience. Do not store production secrets in the image.

## Management Commands
If connectome tables/data are missing, run `init_data_connectome` first.

- `init_data_connectome`: import and initialize connectome datasets, neurons, and synapses.
- `init_data_graph_precompute`: precompute graph data used by path finding.
- `init_data_gcamp`: import paper/type/event style/dataset/neuron activity data.
- `update_encoding_dict_neuron_match`: build encoding neuron-class match cache.
- `update_encoding_dict`: build aggregate encoding cache.
- `update_neuron_match_dict`: build dataset-to-neuron match cache.
- `cache_connectome`: warm connectome caches.
- `cache_activity`: warm activity caches.

## API Summary

### Core
- `GET /is_healthy/`: health check endpoint (`OK` or `ERROR`).

### Connectome (`/connectome/`)
- `GET /connectome/api/available-neurons/?datasets=<id1,id2,...>`
- `POST /connectome/api/get-edges/`
- `GET /connectome/api/find-paths/?dataset=<id>&start=<neuron>&end=<neuron>`

### Activity (`/activity/`)
- `GET /activity/api/data/<str:dataset_id>/<int:idx_neuron>/`
- `GET /activity/api/data/<str:dataset_id>/behavior/`
- `GET /activity/api/data/<str:dataset_id>/encoding/`
- `GET /activity/api/data/atanas_kim_2023_encoding/`
- `GET /activity/api/data/datasets/`
- `GET /activity/api/data/find_neuron/`
- `GET /activity/api/data/replay/?activity_dataset=<id>&connectome_dataset=<id>`
- `GET /activity/api/data/download/<str:dataset_id>/`
- `POST /activity/plot-multiple-data/`
