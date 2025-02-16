# WormWideWeb

## General notes on the architecture

## Management commands
`init_data_connectome`: import and initlaize the connectome data.
`init_data_graph_precompute`: precompute the networkx graph objects necessary for the find route feature.
`init_data_gcamp`: initialize and import all GCaMPPaper, GCaMPDatasetType, and GCaMPNeuron.
`update_encoding_dict_neuron_match`: import the encoding table (from the Atanas & Kim et al., 2023 paper) and match those neurons.
`update_encoding_dict`: update the encoding dictionary (aggregate of neurons across datasets) JSON data.
`update_neuron_match_dict`: create and store the precomputed match dictionary (which dataset has which labeled neuron).

## APIs
