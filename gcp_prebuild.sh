# copy data
gsutil -m -q cp -r gs://www-build-bucket/initial_data .

# create build config with the secret keys
sh create_build_config.sh