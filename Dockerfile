FROM python:3.13-slim AS builder
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
RUN mkdir /config
COPY /config/ /config/
RUN pip install --upgrade pip
RUN pip install --no-cache-dir -r /config/requirement.pip

RUN mkdir /wormwideweb
COPY /src/ /wormwideweb/
COPY /initial_data/ /initial_data/

WORKDIR /wormwideweb

RUN --mount=type=secret,id=env_base,dst=/run/secrets/env_base \
    --mount=type=secret,id=env_build_override,dst=/run/secrets/env_build_override \
    bash -c 'set -a && source /run/secrets/env_base && source /run/secrets/env_build_override && set +a && \
        sh /wormwideweb/populate_db.sh'

# for deployment
FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
RUN mkdir /config
COPY /config/ /config/
RUN pip install --upgrade pip
RUN pip install --no-cache-dir -r /config/requirement.pip

# copy from the builder stage
COPY --from=builder /wormwideweb /wormwideweb

WORKDIR /wormwideweb