# Federation Operations Runbook

This document covers day-to-day operation, monitoring, and troubleshooting of the ActivityPub federation layer in Bubble.

---

## Table of Contents

1. [Overview](#overview)
2. [Configuration Reference](#configuration-reference)
3. [Enabling / Disabling Federation](#enabling--disabling-federation)
4. [Instance Allowlist Management](#instance-allowlist-management)
5. [Health Endpoint](#health-endpoint)
6. [Delivery Queue & Retries](#delivery-queue--retries)
7. [Inbound Activity Log](#inbound-activity-log)
8. [Backfilling a Remote Catalog](#backfilling-a-remote-catalog)
9. [Key Management](#key-management)
10. [GDPR & Deletion Propagation](#gdpr--deletion-propagation)
11. [Common Failure Scenarios](#common-failure-scenarios)
12. [Database Queries for Ops](#database-queries-for-ops)

---

## Overview

Federation uses ActivityPub + WebFinger + NodeInfo 2.1 over HTTPS. All signing uses draft-cavage-http-signatures-12 (RSA-SHA256), compatible with Mastodon and other major implementations.

Key URL prefixes:

| Purpose | URL |
|---|---|
| WebFinger | `/.well-known/webfinger` |
| NodeInfo discovery | `/.well-known/nodeinfo` |
| NodeInfo document | `/federation/nodeinfo/2.1` |
| Instance actor | `/federation/actor` |
| User actor | `/federation/users/<username>` |
| User inbox | `/federation/users/<username>/inbox` |
| AP object (item) | `/federation/items/<uuid>` |
| AP object (booking) | `/federation/bookings/<uuid>` |
| AP object (message) | `/federation/messages/<uuid>` |
| Health | `/federation/health` |

---

## Configuration Reference

All settings live in `config/settings/base.py` under the `FEDERATION_*` namespace.

| Setting | Default | Description |
|---|---|---|
| `FEDERATION_ENABLED` | `True` | Master on/off switch. Set `False` to return 404 on all federation endpoints. |
| `FEDERATION_DOMAIN` | (derived from `ALLOWED_HOSTS`) | Public domain used in AP IDs and URLs. Must be the canonical HTTPS domain. |
| `FEDERATION_KEY_ENCRYPTION_KEY` | — | **Required in production.** 32-byte URL-safe base64 string. Used to AES-GCM-encrypt stored RSA private keys. Generate with `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`. |
| `FEDERATION_SYSTEM_ACTOR_USERNAME` | `"relay"` | Username for the domain-level system actor (Mastodon-style). |
| `FEDERATION_INBOX_RATE_LIMIT` | `"60/m"` | django-ratelimit rate string applied per remote actor URI (fallback to IP). |
| `FEDERATION_HTTP_TIMEOUT` | `10` | Seconds for outbound HTTP requests (actor fetch, delivery). |
| `FEDERATION_USER_AGENT` | `"Bubble/1.0"` | `User-Agent` header sent on outbound requests. |

---

## Enabling / Disabling Federation

**Disable globally** (emergency stop — no data loss):

```python
# config/settings/production.py  (or via environment override)
FEDERATION_ENABLED = False
```

This makes all `/.well-known/` and `/federation/` endpoints return 404. Existing `RemoteItem`, `RemoteActor`, and `RemoteInstance` rows are preserved.

**Re-enable**: revert the setting and restart the application server.

---

## Instance Allowlist Management

Bubble uses a closed-federation model. Remote instances must be explicitly allowed before any activities are accepted or delivered.

### Via Django Admin

1. Navigate to **Federation → Remote instances**.
2. Click **Add remote instance** or edit an existing record.
3. Set **Allowlist state** to `allowed`.
4. Optionally set **Catalog URL** (defaults to the remote outbox if left blank).
5. Save.

### Backfill on Allow

When allowing an instance you can immediately backfill its public item catalog:

1. In the **Remote instances** list, tick one or more instances.
2. Select the action **Allow instances and backfill catalog** from the dropdown.
3. Click **Go**.

This enqueues a `backfill_remote_catalog` Huey task per instance. The task paginates the remote outbox (max 100 pages, 2 s throttle between pages) and upserts `RemoteItem` records.

### Blocking an Instance

Set the state to `blocked`. Subsequent inbox requests from that instance return 403. Previously mirrored items are soft-deleted (`deleted=True`).

---

## Health Endpoint

```
GET /federation/health
```

Returns a JSON document summarising federation state. Requires `FEDERATION_ENABLED=True`. No authentication required (read-only, no sensitive data).

Example response:

```json
{
  "federation_enabled": true,
  "outbound": {
    "pending": 3,
    "delivered": 1420,
    "failed": 2
  },
  "inbound": {
    "received": 0,
    "processed": 874,
    "failed": 1
  },
  "instances": {
    "allowed": 4,
    "pending": 1,
    "blocked": 0
  }
}
```

Use this endpoint in your uptime/alerting system. Alert when `outbound.failed` or `inbound.failed` is non-zero and growing.

---

## Delivery Queue & Retries

Outbound deliveries are stored in `federation_outbounddelivery` and processed by Huey workers.

### Retry schedule (exponential backoff)

Attempts are retried at: 60 s → 5 min → 30 min → 2 h → 6 h → 12 h → 24 h → 48 h.

After all retries are exhausted the row is marked `failed` and no further attempts are made.

### Manually re-queuing a failed delivery

```python
# Django shell: just manage shell
from bubble.federation.models import OutboundDelivery, DeliveryStatus
from bubble.federation.tasks import deliver_activity

for d in OutboundDelivery.objects.filter(status=DeliveryStatus.FAILED):
    d.attempts = 0
    d.status = DeliveryStatus.PENDING
    d.save(update_fields=["attempts", "status"])
    deliver_activity(str(d.id))
```

### Purging old delivered records

Delivered records accumulate indefinitely. Run periodically (e.g. weekly via cron or a management command):

```sql
DELETE FROM federation_outbounddelivery
WHERE status = 'delivered'
  AND created_at < NOW() - INTERVAL '30 days';
```

---

## Inbound Activity Log

Every received activity is appended to `federation_inboundactivity` (keyed on the AP activity `id` URI for natural idempotency).

### Statuses

| Status | Meaning |
|---|---|
| `received` | Stored but not yet processed (should be transient). |
| `processed` | Handler ran successfully. |
| `failed` | Handler raised an exception. Check the `error` field. |

### Inspecting failures

```python
from bubble.federation.models import InboundActivity, ActivityStatus

failed = InboundActivity.objects.filter(status=ActivityStatus.FAILED)
for a in failed:
    print(a.ap_id, a.error)
```

### Replaying a failed activity

```python
from bubble.federation.tasks import _dispatch_activity

record = InboundActivity.objects.get(ap_id="https://remote.example/activities/xyz")
_dispatch_activity(record.raw_jsonld)
```

---

## Backfilling a Remote Catalog

The `backfill_remote_catalog` Huey task fetches a remote instance's public outbox and upserts items.

```python
from bubble.federation.tasks import backfill_remote_catalog

backfill_remote_catalog("https://remote.example/federation/actor")
```

Or pass a direct `catalog_url` override:

```python
backfill_remote_catalog(
    "https://remote.example/federation/actor",
    catalog_url="https://remote.example/federation/outbox"
)
```

Hard limits: 100 pages max, 2 s sleep between pages. Adjust `_BACKFILL_MAX_PAGES` and `_BACKFILL_THROTTLE_SECONDS` in `tasks.py` if needed (restart workers after).

---

## Key Management

### User keypairs

Each `User` record has an associated `ActorKeypair` (RSA-4096). Keypairs are created automatically on first federation activity via `signals.py`. The private key is stored AES-GCM encrypted in the database using `FEDERATION_KEY_ENCRYPTION_KEY`.

**Rotating `FEDERATION_KEY_ENCRYPTION_KEY`:**

1. Generate a new key.
2. Write a management command that re-encrypts all `ActorKeypair.private_key_encrypted` records using the new key.
3. Deploy with both old and new key available (e.g. `FEDERATION_KEY_ENCRYPTION_KEY_OLD`).
4. Run the re-encryption command.
5. Remove the old key from config.

Skipping step 3 will break all outbound signed requests until re-encryption is complete.

### System actor keypair

The system/instance actor (`/federation/actor`) also has an `ActorKeypair`. It is created automatically. Its `ap_id` is the instance actor URL (e.g. `https://bubble.example/federation/actor`).

---

## GDPR & Deletion Propagation

When a `User` account is deleted:

1. A `pre_delete` signal captures all AP actor URIs for the user's items and actor.
2. A `post_delete` signal fans out `Delete` activities to all allowed remote instances.
3. Remote items authored by that actor are soft-deleted on remote instances that honour the `Delete Person` activity.

**Best-effort only**: remote instances may not honour deletion. This is an inherent limitation of the federated model. Inform users of this in your privacy policy.

**Soft-deleted `RemoteItem` records** (from de-allowlisted instances) are never hard-deleted by default. They can be purged after a retention period:

```sql
DELETE FROM federation_remoteitem
WHERE deleted = true
  AND deleted_at < NOW() - INTERVAL '90 days';
```

---

## Common Failure Scenarios

### Outbound HTTP 401/403 from remote

The remote rejected our HTTP Signature. Possible causes:
- Clock skew > 5 minutes between servers. Ensure NTP is running.
- Wrong `FEDERATION_DOMAIN` — the `keyId` in the signature header must resolve to the correct actor.
- Remote instance blocked us.

### Outbound HTTP 429

Remote rate-limited us. The backoff schedule will handle retries automatically. If persistent, contact the remote admin or reduce delivery frequency.

### Inbox 403 "Instance not in allowlist"

A remote instance sent an activity but is not allowlisted. Add it via the admin if desired.

### `raw_jsonld` is null on `RemoteItem`

Items created internally for testing or via direct DB operations may have `raw_jsonld=NULL`. This is valid — the field is nullable as of migration `0003`. No action required.

### WebFinger returns 404 for a valid user

Check:
1. `FEDERATION_DOMAIN` matches the requested `host` in the `resource` parameter.
2. The user exists and has `federation_discoverable=True` on their `Profile`.
3. The URL routing includes `/.well-known/` paths (not behind a login-required middleware).

---

## Database Queries for Ops

**Delivery queue depth by status:**
```sql
SELECT status, COUNT(*) FROM federation_outbounddelivery GROUP BY status;
```

**Recently failed deliveries:**
```sql
SELECT recipient_inbox, error, last_attempt_at
FROM federation_outbounddelivery
WHERE status = 'failed'
ORDER BY last_attempt_at DESC
LIMIT 20;
```

**Inbound activity volume by type (last 24h):**
```sql
SELECT activity_type, status, COUNT(*)
FROM federation_inboundactivity
WHERE received_at > NOW() - INTERVAL '24 hours'
GROUP BY activity_type, status
ORDER BY count DESC;
```

**Remote items by instance:**
```sql
SELECT instance, COUNT(*), COUNT(*) FILTER (WHERE deleted) AS deleted
FROM federation_remoteitem
GROUP BY instance
ORDER BY count DESC;
```
