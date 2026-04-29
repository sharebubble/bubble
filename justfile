export COMPOSE_FILE := if path_exists("compose.override.yaml") == "true" { "compose.yaml:compose.override.yaml" } else { "compose.yaml" }

## Just does not yet manage signals for subprocesses reliably, which can lead to unexpected behavior.
## Exercise caution before expanding its usage in production environments.
## For more information, see https://github.com/casey/just/issues/2473 .


# Default command to list all available commands.
default:
    @just --list

# build: Build python image.
build:
    @echo "Building python image..."
    @docker compose build

# up: Start up containers.
up:
    @echo "Starting up containers..."
    @docker compose up -d --remove-orphans

# down: Stop containers.
down:
    @echo "Stopping containers..."
    @docker compose down

# prune: Remove containers and their volumes.
prune *args:
    @echo "Killing containers and removing volumes..."
    @docker compose down -v {{args}}

# logs: View container logs
logs *args:
    @docker compose logs -f {{args}}

# manage: Executes `manage.py` command.
manage +args:
    @docker compose run --rm backend python ./manage.py {{args}}

# manage: Executes `manage.py` command.
run +args:
    @docker compose run --rm backend {{args}}

# tests: run pytests
tests:
    @docker compose run --rm backend pytest

# openapi: Regenerate openapi schema in frontend container
openapi:
    @docker compose run --rm frontend npm run types:openapi
