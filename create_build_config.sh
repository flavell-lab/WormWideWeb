#!/usr/bin/env bash
# for building, not baked into the image/runtime.
# This script intentionally avoids production secrets.
set -eu
# Enable pipefail when supported (bash/zsh); ignore on shells without it.
(set -o pipefail) 2>/dev/null && set -o pipefail || true

# Where to write your environment variables:
OUTFILE="config/default.env"

# Build-only Django key.
# You can override with DJ_BUILD_SECRET_KEY if needed.
BUILD_SECRET_KEY="${DJ_BUILD_SECRET_KEY:-}"
if [ -z "$BUILD_SECRET_KEY" ]; then
  BUILD_SECRET_KEY="$(python3 - <<'PY'
import secrets
print(secrets.token_urlsafe(64))
PY
)"
fi

# Write everything to the env file
cat <<EOF > "$OUTFILE"
DJ_DEBUG=0
DJ_DB_BUILD=1
DJ_SECRET_KEY="$BUILD_SECRET_KEY"
DJ_ALLOWED_HOSTS="localhost .run.app wormwideweb.org"
EOF

echo "Build-only variables written to $OUTFILE (no production secrets)."
