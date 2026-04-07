FROM python:3.13-slim AS builder
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
RUN mkdir /config
COPY /config/requirements.runtime.pip /config/requirements.runtime.pip
COPY /config/requirements.build.pip /config/requirements.build.pip
RUN pip install --upgrade pip && \
    pip install --no-cache-dir -r /config/requirements.build.pip

RUN mkdir /wormwideweb
COPY /src/ /wormwideweb/

WORKDIR /wormwideweb

RUN --mount=type=bind,source=./initial_data,target=/initial_data \
    --mount=type=secret,id=env_base,dst=/run/secrets/env_base \
    bash -c 'set -a && source /run/secrets/env_base && set +a && \
        sh /wormwideweb/populate_db.sh'

# for deployment
FROM python:3.13-slim
# ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
RUN mkdir /config
COPY /config/requirements.runtime.pip /config/requirements.runtime.pip
RUN pip install --upgrade pip
RUN pip install --no-cache-dir -r /config/requirements.runtime.pip

# copy from the builder stage
COPY --from=builder /wormwideweb /wormwideweb

WORKDIR /wormwideweb

# Precompile all Python files into .pyc bytecode files
RUN python -m compileall .

EXPOSE 8000
