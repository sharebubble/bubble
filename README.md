# bubble

Treibhaus donaufeld sharing platform

[![Built with Cookiecutter Django](https://img.shields.io/badge/built%20with-Cookiecutter%20Django-ff69b4.svg?logo=cookiecutter)](https://github.com/cookiecutter/cookiecutter-django/)
[![Ruff](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/astral-sh/ruff/main/assets/badge/v2.json)](https://github.com/astral-sh/ruff)

# Quick start

Run

- `docker compose up -d` (wait a while)
- `docker compose exec backend python manage.py createsuperuser`
- open http://localhost:8080 and log in

# Frontend

For autocompletion and type checks inside your IDE, install the npm packages locally in the _frontend/_ folder:

```
npm ci
```

## Update packages

- check with `npm outdated`
- upgrade with `npm update`

## Update API types

The backend exposes its types as OpenAPI types.

Whenever the backend types change, the corresponding type information for the frontend should be updated.

Also, this should usually be done when the _@hey-api/openapi-ts_ package in the frontend is upgraded.

run `npm run types:openapi` to update the types

# Backend stuff

Everything in `backend` folder please.

## Update Translations

Start by configuring the `LANGUAGES` settings in `base.py`, by uncommenting languages you are willing to support. Then, translation strings will be placed in this folder when running:

```bash
docker compose run --rm backend python manage.py makemessages --all --no-location
```

## Type checks

Running type checks with mypy:

    $ mypy bubble

## Test coverage

To run the tests, check your test coverage, and generate an HTML coverage report:

    $ coverage run -m pytest
    $ coverage html
    $ open htmlcov/index.html

### Running tests with pytest

    $ pytest

## Email Server

In development, it is often nice to be able to see emails that are being sent from your application. For that reason local SMTP server [Mailpit](https://github.com/axllent/mailpit) with a web interface is available as docker container.

Container mailpit will start automatically when you will run all docker containers.
Please check [cookiecutter-django Docker documentation](https://cookiecutter-django.readthedocs.io/en/latest/2-local-development/developing-locally-docker.html) for more details how to start all containers.

With Mailpit running, to view messages that are sent by your application, open your browser and go to `http://127.0.0.1:8025`

## Sentry

Sentry is an error logging aggregator service. You can sign up for a free account at <https://sentry.io/signup/?code=cookiecutter> or download and host it yourself.
The system is set up with reasonable defaults, including 404 logging and integration with the WSGI application.

You must set the DSN url in production.
