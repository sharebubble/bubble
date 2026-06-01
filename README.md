# bubble

Treibhaus donaufeld sharing platform

[![Built with Cookiecutter Django](https://img.shields.io/badge/built%20with-Cookiecutter%20Django-ff69b4.svg?logo=cookiecutter)](https://github.com/cookiecutter/cookiecutter-django/)
[![Ruff](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/astral-sh/ruff/main/assets/badge/v2.json)](https://github.com/astral-sh/ruff)

# Quick start

Run

- `docker compose up -d` (wait a while)
- `docker compose exec backend python manage.py createsuperuser`
- open http://localhost:8080 and log in

# Federation (ActivityPub)

Bubble supports ActivityPub federation, allowing items, bookings, and messages to flow between Bubble instances and interact with the broader fediverse (Mastodon, etc.).

## Enabling federation

Set these environment variables (e.g. in `backend/.env`):

```env
FEDERATION_ENABLED=true
FEDERATION_DOMAIN=bubble.example.com
# 32-byte URL-safe base64 key — generate with:
# python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
FEDERATION_KEY_ENCRYPTION_KEY=<your-key>
```

Then restart the backend and run migrations:

```bash
docker compose exec backend python manage.py migrate
```

## Allowing peer instances

Federation uses an **allowlist model** — remote instances must be explicitly permitted before any activities are exchanged.

1. Log in to the Django admin at `/admin/`
2. Navigate to **Federation → Remote instances → Add**
3. Enter the peer instance domain and set **Allowlist state** to `Allowed`
4. Optionally use the **Allow instances and backfill catalog** admin action to immediately import the remote instance's public item catalog

## User-facing controls

- **Enable/disable federation** per user: account settings → Federation
- **Per-item visibility**: each item can be set to `Public (federated)` or `Local only`
- **Profile discoverability**: controls whether your profile appears in remote search results

## Mastodon lookup

Bubble user profiles are Mastodon-compatible. You can look up a Bubble user from Mastodon using the handle format:

```
@username@bubble.example.com
```

## Monitoring

Check the federation health endpoint (no auth required):

```
GET https://bubble.example.com/federation/health
```

For full operational guidance see [`docs/federation/operating.md`](docs/federation/operating.md).
For privacy and GDPR considerations see [`docs/federation/privacy.md`](docs/federation/privacy.md).

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
