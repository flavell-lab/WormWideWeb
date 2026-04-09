# Neural Activity Dataset JSON Format
## Top-Level Structure

Each dataset JSON is an object with these keys:

| Key | Type | Required | Notes |
|---|---|---|---|
| `timing` | object | Yes | Timepoint count/timestep and optional events |
| `behavior` | object | Yes | Behavioral traces and reversal intervals |
| `gcamp` | object | Yes | Neural traces (`trace_array`, `trace_array_original`) |
| `metadata` | object | Yes | Dataset identity, types, checksums, neuron count |
| `encoding` | object | No | Present in datasets with CePNEM outputs |
| `label` | object | No | Present in NeuroPAL-labeled datasets |

## Field Definitions

### `timing`

| Key | Type | Required | Notes |
|---|---|---|---|
| `mean_timestep` | number | Yes | Seconds per timepoint in source JSON. Importer stores minutes (`/60`) in DB. |
| `max_t` | integer | Yes | Number of timepoints expected for traces |
| `timestamp_confocal` | number[] | Yes | Confocal timestamps; usually length `max_t` |
| `event` | object | No | Event-name to timepoint-index list: `{ "eventName": [idx1, idx2, ...] }` |

### `gcamp`

| Key | Type | Required | Notes |
|---|---|---|---|
| `trace_array` | number[][] | Yes | Processed/z-scored neural traces, shape `n_neuron x max_t` |
| `trace_array_original` | number[][] | Yes | Original traces, same shape as `trace_array` |

### `behavior`

| Key | Type | Required | Notes |
|---|---|---|---|
| `velocity` | number[] | Yes | Length should match timepoint count |
| `head_angle` | number[] | Yes | Length should match timepoint count |
| `angular_velocity` | number[] | Yes | Length should match timepoint count |
| `pumping` | number[] or null | Yes (key), value can be null | Importer accepts `null` |
| `reversal_events` | array of `[start_idx, end_idx]` | Yes | Timepoint index intervals for reversal shading |

### `metadata`

| Key | Type | Required | Notes |
|---|---|---|---|
| `uid` | string | Yes | Dataset UID; importer builds DB `dataset_id` as `<paper_id>-<uid>` |
| `paper_id` | string | Yes | Source paper identifier |
| `dataset_type` | string[] | Yes | Must match entries from `dataset_types.json` (paper-specific or `common-*`) |
| `n_neuron` | integer | Yes | Expected neuron count |
| `source_filename` | string | Yes | Original file source identifier |
| `checksum_h5` | string | Yes | Checksum of the source HDF5 file |
| `blake3_neuropal_dict` | string | Yes in current files | Upstream artifact checksum |
| `blake3_analysis_dict` | string | Optional | Present in encoding-enabled datasets |
| `blake3_fit_results` | string | Optional | Present in encoding-enabled datasets |
| `blake3_relative_encoding_strength` | string | Optional | Present in encoding-enabled datasets |

### `label` (optional)

`label` is an object keyed by neuron index string (`"1"`, `"2"`, ...).  
Each value currently contains:

`label`, `neuron_class`, `LR`, `DV`, `region`, `roi_id`, `confidence`

Note that `roi_id` is the segmentation roi id, not the neuron number here.


### `encoding` (optional)
Entries:
| Key | Description |
|---|---|
| `ranges` | Timesegment ranges for the model fit |
| `neuron_categorization` | Categorical grouping of encoding/tuning classes across behaviors/features. |
| `encoding_changing_neurons` | List of neurons identified as changing encoding across `ranges`. |
| `rel_enc_str_v` | Per-neuron relative encoding strength for velocity (`v`). |
| `rel_enc_str_θh` | Per-neuron relative encoding strength for head angle (`θh`). |
| `rel_enc_str_P` | Per-neuron relative encoding strength for pumping/feeding (`P`). |
| `forwardness` | Per-neuron score representing forward-locomotion preference/tuning. |
| `dorsalness` | Per-neuron score representing dorsal-versus-ventral preference/tuning. |
| `feedingness` | Per-neuron score representing feeding-related preference/tuning. |
| `tau_vals` | Per-neuron temporal timescale (`τ`) values from the encoding model. |