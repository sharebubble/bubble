# bubble

Sharing and booking platform for communities

[![Built with Cookiecutter Django](https://img.shields.io/badge/built%20with-Cookiecutter%20Django-ff69b4.svg?logo=cookiecutter)](https://github.com/cookiecutter/cookiecutter-django/)
[![Ruff](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/astral-sh/ruff/main/assets/badge/v2.json)](https://github.com/astral-sh/ruff)

# Quick start

Run

- `docker compose up -d` (wait a while)
- `docker compose exec backend python manage.py createsuperuser`
- open http://localhost:8080 and log in

# Notifications

Bubble delivers user notifications through the [Apprise](https://github.com/caronc/apprise) library, giving a single, unified delivery path for multiple channels. Each user opts in, per channel, from the **Notifications** section of their profile.

## Supported channels

| Channel    | User field used to address them | Apprise URL config (Constance / env) |
| ---------- | ------------------------------- | ------------------------------------ |
| RocketChat | username                        | `APPRISE_ROCKETCHAT_URL`             |
| Signal     | phone number                    | `APPRISE_SIGNAL_URL`                 |
| Matrix     | Matrix ID (`@user:server`)      | `APPRISE_MATRIX_URL`                 |
| Email      | email address                   | `APPRISE_MAILTOS_URL`                |

Each value is an [Apprise URL](https://github.com/caronc/apprise/wiki) **template** containing a `{target}` placeholder that is substituted with the recipient's address. Examples:

```env
APPRISE_ROCKETCHAT_URL=rocket://user:password@rocketchat.example.com/{target}
APPRISE_SIGNAL_URL=signal://signal-api.example.com/+15551230000/{target}
APPRISE_MATRIX_URL=matrixs://user:password@matrix.example.com/{target}
APPRISE_MAILTOS_URL=mailtos://user:password@smtp.example.com?to={target}
```

For RocketChat, `{target}` already resolves to an `@`-prefixed username (e.g. `@alice`) so Apprise addresses the user directly by DM — don't add another `@` in the template. A plain login password can only post to rooms/channels, not DM a user, so `APPRISE_ROCKETCHAT_URL` needs one of:

- **Token mode** (recommended): a Personal Access Token + User ID pair from **Rocket.Chat → Account → Personal Access Tokens**, with `?mode=token`:
  `rocket://<UserID>:<PersonalAccessToken>@rocketchat.example.com/{target}?mode=token`
- **Webhook mode**: an Incoming Webhook's two-part token (`<token1>/<token2>` from the webhook's URL), with no login credentials:
  `rocket://<token1>/<token2>@rocketchat.example.com/{target}`

These can be set via environment variables or edited at runtime in the Django admin under **Constance → Config**.

## How it works

A channel only appears in a user's profile once it is **both**:

1. configured on the backend (the Apprise URL above is set), and
2. addressable for that user (RocketChat and email use the bubble username/account email automatically; Signal needs a phone number on the profile; Matrix needs a Matrix ID, editable right in the Notifications section).

Users then choose, per channel, which events they want:

- **New messages and bookings** — a new chat message or a new booking on one of their items.
- **New items** — whenever a new item is published.

The phone number can be filled in manually on the profile, or is pre-populated from the `phone_number` claim of your OIDC provider when available (the `phone` scope is requested automatically).

RocketChat and email always address a user by their bubble username/account email, so they need no separate field — once `APPRISE_ROCKETCHAT_URL`/`APPRISE_MAILTOS_URL` is configured, those channels and their notification options appear automatically (email notifications, like every other channel, start out **disabled** until the user opts in). Matrix works similarly but needs a per-user Matrix ID: once `APPRISE_MATRIX_URL` is configured, the Matrix panel appears in the **Notifications** section of the profile with an editable Matrix ID field, prefilled with `@<bubble username>:<homeserver>` so the channel becomes available immediately (they can still edit it to their real `@user:server` address).

The `<homeserver>` part of that prefill defaults to `DJANGO_ALLOWED_HOSTS[0]` (Matrix IDs conventionally use the bare site domain even when the client-server API itself lives on a subdomain, e.g. `matrix.example.com`, via `.well-known` delegation). Set `APPRISE_MATRIX_HOSTNAME` to override it when that doesn't hold, e.g.:

```env
APPRISE_MATRIX_HOSTNAME=example.com
```

# Payments

Bubble records what members settle between themselves. Nothing is charged, no money moves through the platform, and no balance is redeemable — the ledger is bookkeeping, so a bubble can see what its sharing has actually been worth without becoming a payment service.

Everything is denominated in `DEFAULT_CURRENCY` (euros by default). There is no separate platform currency.

## Recording a payment

Once a booking reaches **completed**, the person who received the item is asked what they paid. Two cases share the same prompt:

- **A priced booking** — the amount agreed up front is offered for confirmation.
- **A free booking** — items offered for sale or rent at a price of `0`, as well as donations and free loans, change hands without a price. Here the payment is entirely **voluntary**: the prompt asks what the item was worth to the borrower, with a slider bounded by `VOLUNTARY_PAYMENT_MAX`, and larger amounts can still be typed. The suggestion starts from whatever that member paid for the same item last time, so a repeat borrow needs no re-thinking.

Deliberately after the fact, not up front: nothing was charged, so the question is what it turned out to be worth rather than what it should cost. Declining is a first-class outcome — "Not now" records nothing.

## The record

Every recorded payment is visible to everyone who can see the item, on the item page, as its **payment record**: who paid, when, how much, and whether it was voluntary — plus the running total and average. It survives the item being sold, which is exactly when the record matters most. An item's history is as public as the item itself, and never carries contact details.

Each member also sees their own **balance** on the account page: what they have paid out, what they have received, and the net of the two.

## How it is stored

Payments are held in a double-entry ledger (`bubble.ledger`):

- A `Transaction` carries two or more `Posting`s whose signed amounts sum to zero, so money is always moved from somewhere to somewhere.
- History is append-only. Recording a payment again does not edit the old figure — it posts a reversing entry and then the new one, so the correction is visible and the standing amount is unambiguous.
- Balances are **derived** by summing postings, never stored in a mutable column, so a balance cannot drift out of step with the history behind it.
- Writes carry an idempotency key, so a retried request records once.

## Configuration

| Setting                 | Default | Meaning                                                        |
| ----------------------- | ------- | -------------------------------------------------------------- |
| `VOLUNTARY_PAYMENT_MAX` | `100`   | Upper end of the slider offered after a free booking completes |

```env
VOLUNTARY_PAYMENT_MAX=100
```

As with the notification settings, this is read from the environment at first start and can be edited at runtime in the Django admin under **Constance → Config**.

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

## UI library direction

The frontend is being migrated from shadcn-style primitives to Mantine.

- Use Mantine for new UI components and interactions.
- Existing shadcn-based components in `frontend/src/components/ui/` are kept temporarily and can coexist during migration.
- Prefer incremental migration: if you modify an existing shadcn surface, migrate that touched area to Mantine where practical.

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
