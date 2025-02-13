#!/usr/bin/env bash
# for building, not baked into the image/runtime.

# Where to write your environment variables:
OUTFILE="config/default.env"

# Fetch secrets from GCP Secret Manager
SECRET_KEY="$(gcloud secrets versions access latest --secret=DJ_SECRET_KEY)"
SECRET_KEY_BACKUP="$(gcloud secrets versions access latest --secret=DJ_SECRET_KEY_BACKUP)"

# Write everything to the env file
cat <<EOF > "$OUTFILE"
DJ_DEBUG=0
DJ_DB_BUILD=1
DJ_SECRET_KEY="$SECRET_KEY"
DJ_SECRET_KEY_BACKUP="$SECRET_KEY_BACKUP"
DJ_ALLOWED_HOSTS="localhost .run.app wormwideweb.org"
EOF

echo "Variables have been written to $OUTFILE."
