python manage.py migrate --noinput
python manage.py collectstatic --no-input
python manage.py init_data_connectome
python manage.py init_data_graph_precompute
python manage.py init_data_gcamp
python manage.py update_encoding_dict_neuron_match
python manage.py update_encoding_dict
python manage.py update_neuron_match_dict