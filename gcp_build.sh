# copy data
gsutil -m -q cp -r gs://www-build-bucket/initial_data .

# create build config with the secret keys
sh create_build_config.sh

# build
docker compose build

# remove the config file
rm -f config/default.env

# tag and push to artifact repo
docker tag gcp_deploy:latest us-central1-docker.pkg.dev/www-deploy/www-docker/gcp_deploy:latest
docker push us-central1-docker.pkg.dev/www-deploy/www-docker/gcp_deploy:latest
