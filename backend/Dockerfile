# define an alias for the specific python version used in this file.
FROM docker.io/python:3.14-slim AS python

# Python 'run' stage
FROM python AS base

ARG BUILD_ENVIRONMENT=production
ARG APP_HOME=/app

# Build info baked at image build time; surfaced via GET /api/version/
# (see docs/e2e-testing/plan.md §7.2). Pass with:
#   docker build --build-arg GIT_SHA=<sha> --build-arg APP_VERSION=<version>
ARG GIT_SHA=""
ARG APP_VERSION=""

ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV BUILD_ENV=${BUILD_ENVIRONMENT}
ENV GIT_SHA=${GIT_SHA}
ENV APP_VERSION=${APP_VERSION}
ENV UV_PROJECT_ENVIRONMENT=/home/django/.venv

WORKDIR ${APP_HOME}

RUN addgroup --system django \
  && useradd --uid 1000 --gid django --shell /bin/bash --create-home django

# Install required system dependencies
RUN apt-get update && apt-get install --no-install-recommends -y \
  # psycopg dependencies
  libpq-dev \
  # Translations dependencies
  gettext \
  # entrypoint
  wait-for-it \
  # cleaning up unused files
  && apt-get purge -y --auto-remove -o APT::AutoRemove::RecommendsImportant=false \
  && rm -rf /var/lib/apt/lists/*

COPY --chown=django:django ./docker/entrypoint /entrypoint
RUN sed -i 's/\r$//g' /entrypoint
RUN chmod +x /entrypoint

COPY --chown=django:django ./docker/start /start
RUN sed -i 's/\r$//g' /start
RUN chmod +x /start

COPY --chown=django:django ./docker/start_huey /start-huey
RUN sed -i 's/\r$//g' /start-huey
RUN chmod +x /start-huey

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# make django owner of the WORKDIR directory as well.
RUN chown django:django ${APP_HOME}

USER django

# Requirements are installed here to ensure they will be cached.
COPY uv.lock pyproject.toml ./

RUN --mount=type=cache,target=/home/django/.cache/uv,uid=1000 \
  uv sync --frozen --no-dev

# Place executables in the environment at the front of the path
ENV PATH="$UV_PROJECT_ENVIRONMENT/bin:$PATH"

COPY --chown=django:django . ${APP_HOME}

RUN DATABASE_URL="" \
  DJANGO_SETTINGS_MODULE="config.settings.test" \
  python manage.py compilemessages -v 0 -i .venv

EXPOSE 8000

# production image
FROM base AS prod

ENTRYPOINT ["/entrypoint"]

# dev image build part
FROM base AS dev

# Sync dev dependencies into the uv-managed venv (this will install dev deps)
COPY --chown=django:django uv.lock pyproject.toml /app/
RUN --mount=type=cache,target=/home/django/.cache/uv,uid=1000 \
  uv sync

ENTRYPOINT ["/entrypoint"]
CMD ["/start"]
