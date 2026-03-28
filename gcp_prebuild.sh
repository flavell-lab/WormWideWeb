# copy data
gsutil -m -q cp -r gs://www-build-bucket/initial_data .

# create build config with build-only runtime values
bash create_build_config.sh
