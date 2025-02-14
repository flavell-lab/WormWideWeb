gsutil cp -r gs://www-build-bucket/initial_data /www-build
sh create_build_config.sh
docker compose build

docker tag gcp_deploy:latest us-central1-docker.pkg.dev/www-deploy/www-docker/gcp_deploy:latest

docker push us-central1-docker.pkg.dev/www-deploy/www-docker/gcp_deploy:latest