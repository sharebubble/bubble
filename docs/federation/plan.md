# Bubble Federation — Final Plan

## All locked decisions

### Original (1–22)

| # | Decision |
|---|---|
| 1 | Allowlist-first, future opening to broader fediverse |
| 2 | Federate Items → Bookings → Messages (priority order) |
| 3 | Opt-in by default for public items; user can globally opt-out, opt-out per item, or restrict per-item to specific users/groups |
| 4 | Allowlist-only at start |
| 5 | No `Move`/account migration in v1 |
| 6 | Booking authority = item owner's instance; any local user with `change_item` perm can confirm |
| 7 | No federated payments in v1 |
| 8 | Latency-tolerant booking flow OK |
| 9 | Adopt Valueflows vocabulary |
| 10 | Federate all languages via `contentMap`/`nameMap`/`summaryMap` |
| 11 | S3-compatible storage with local FS still supported (configurable) |
| 12 | Stay on Huey |
| 13 | Per-instance domain, TLS via Caddy/Let's Encrypt or k8s ingress |
| 14 | Federation tables in same Postgres DB |
| 15 | Per-user keypairs |
| 16 | Remote actors are NOT Django users; cannot log in |
| 17 | Federation API separate from OpenAPI/SDK, separate URL tree |
| 18 | Unified federated search (mirror & local-index) with origin attribution; local-only toggle |
| 19 | No moderation tooling in v1 |
| 20 | GDPR-conformant, best-effort deletion propagation |
| 21 | No fixed timeline |
| 22 | Mastodon-readable public profile is a goal |

### Follow-up (F1–F8)

| # | Decision |
|---|---|
| F1 | Same domain for SPA and federation |
| F2 | Handle format `@user@bubble.example` (same domain) |
| F3 | Prompt admin to confirm backfill when allowlisting a peer |
| F4 | Keep `RemoteItem`s on de-allowlist but mark as deleted (preserve history) |
| F5 | System actor uses Mastodon-style naming (domain-as-username) |
| F6 | OIDC and password users treated identically for federation |
| F7 | AGENTS.md cleanup is a separate PR (not part of federation work) |
| F8 | MinIO as optional Helm subchart dependency |

---

## Protocol & vocabulary

- **ActivityPub** (W3C) — core S2S protocol
- **WebFinger** (RFC 7033) — actor discovery
- **HTTP Signatures** (`http-message-signatures` lib) — request auth
- **NodeInfo 2.1** — instance metadata
- **Valueflows** vocabulary — for `Offer`/`Intent`/`Commitment`/`Agreement` semantics on items and bookings
- **Bubble JSON-LD context** at `https://<instance>/ns/bubble/v1` — Bubble-specific extensions (rental periods, condition, etc.)
- **Mastodon-compat fields** on `Person` actor + `featured` collection + HTML `content` fallback in `Note`s

### Entity → AP/Valueflows mapping

| Bubble | AP / Valueflows |
|---|---|
| User + Profile | `Person` actor with `publicKey`, multilingual `summary` via `summaryMap` |
| Instance | `Application` actor (Mastodon-style domain naming) |
| Item | `bubble:Item` extending Valueflows `Offer`/`ResourceSpecification`, published via `Create` |
| Item update/delete | `Update` / `Delete` |
| Booking request | `Offer` activity wrapping Valueflows `Intent` (with `time_from`, `time_to`, `offer`) |
| Booking accept/reject/cancel | `Accept` / `Reject` / `Undo` |
| Counter-offer | `Offer` with `inReplyTo` |
| Message | `Create` → `Note` with `inReplyTo`, addressed to participants, HTML `content` + structured fields |
| Item images | AP `Image` in `attachment[]`, absolute URLs |
| Favorites | `Like` (stored as `RemoteFavorite` if from remote actor) |
| Collections | AP `OrderedCollection` |

---

## Required library additions

| Library | Purpose |
|---|---|
| `bovine` + `bovine_store` | ActivityPub primitives |
| `pyld` | JSON-LD processing |
| `http-message-signatures` | HTTP Signatures sign/verify |
| `cryptography` | Already present transitively; explicit for keypair gen |
| `django-cryptography-django5` (or equivalent) | Encrypt private keys at rest |
| `django-storages[boto3]` | S3-compatible storage backend |
| `django-ratelimit` | Inbox rate limiting |

---

## New `federation` Django app — model layout

```
RemoteInstance       (domain PK, software, version, nodeinfo_url,
                      allowlisted bool, first_seen, last_seen, allowlist_state)
RemoteActor          (uuid PK, ap_id URL unique, instance FK,
                      preferred_username, name, summary,
                      inbox_url, shared_inbox_url, outbox_url,
                      public_key_pem, icon_url, fetched_at, deleted bool)
LocalActorKey        (user OneToOne, public_key_pem,
                      private_key_encrypted, created_at)
InstanceActorKey     (singleton, public_key_pem, private_key_encrypted)
RemoteItem           (uuid PK, ap_id URL unique, remote_actor FK, instance FK,
                      name, slug, description, category, sales_type, price,
                      condition, status, properties JSONB,
                      raw_jsonld JSONB, last_updated_at,
                      deleted bool, deleted_at)         # decision F4
RemoteItemImage      (remote_item FK, ordering, url, cached_file optional, alt)
RemoteFavorite       (remote_actor FK, item FK, created_at)
Follow               (follower_actor, followee_actor, accepted bool, created_at)
InboundActivity      (id PK = AP activity id, type, actor_uri,
                      received_at, processed_at, status,
                      raw_jsonld JSONB, error TEXT)
OutboundDelivery     (uuid PK, activity_id, recipient_inbox URL,
                      attempt int, next_attempt_at, status, last_error TEXT)
```

### Existing model additions

```
items.Item:
  + federation_visibility   (PUBLIC_FEDERATED | LOCAL_ONLY; default derived from visibility)
  + ap_id                   (URL, nullable)

users.User:
  + federation_enabled      (bool, default True)

users.Profile:
  + federation_discoverable (bool, default True)

bookings.Booking:
  + remote_booker_actor     (FK RemoteActor, nullable; XOR with user)
  + ap_id                   (URL, nullable)
  → CHECK constraint: (user IS NULL) != (remote_booker_actor IS NULL)
  → Existing exclusion constraints unchanged (overlap detection independent of booker identity)

bookings.Message:
  + remote_sender_actor     (FK RemoteActor, nullable; XOR with sender)
  + ap_id                   (URL, nullable)
  → CHECK constraint analogous
```

---

## URL surface (separate from `/api/`, same domain per F1)

```
/.well-known/webfinger
/.well-known/nodeinfo
/.well-known/host-meta
/nodeinfo/2.1
/federation/instance-actor                   # Mastodon-style domain-named actor
/federation/users/<username>                 # Person actor
/federation/users/<username>/inbox
/federation/users/<username>/outbox
/federation/users/<username>/followers
/federation/users/<username>/following
/federation/users/<username>/featured
/federation/inbox                            # shared inbox
/federation/items/<uuid>
/federation/bookings/<uuid>
/federation/messages/<uuid>
```

Content negotiation: `application/activity+json` and `application/ld+json` → AP JSON-LD; `text/html` → existing SPA.

---

## Implementation phases (no timeline)

### Phase 0 — Spike & vocabulary
- Branch with `bovine` + `pyld` minimal `Person` actor + WebFinger
- Two compose-instance discovery test
- Author `https://<instance>/ns/bubble/v1` JSON-LD context document
- Author Bubble↔Valueflows field-mapping doc

### Phase 1 — Storage abstraction (prerequisite)
- `django-storages` integration, env-driven `STORAGE_BACKEND`
- Migration runbook for moving existing `media/` to S3
- Absolute-URL guarantee for media URLs in federation serializers
- Compose: optional MinIO service
- Helm: MinIO subchart as optional dependency (decision F8)

### Phase 2 — Federation app skeleton & identity
- `federation` app, models, migrations
- Per-user keypair generation (lazy on first federation use)
- `FEDERATION_KEY_ENCRYPTION_KEY` for private-key encryption at rest
- `InstanceActorKey` singleton; instance actor named after domain (F5)
- HTTP Signatures sign/verify utilities
- WebFinger + NodeInfo + host-meta endpoints
- `Person` actor view (Mastodon-compatible field set)
- Django admin for `RemoteInstance` allowlist with backfill confirmation prompt (F3)
- Constance settings: `FEDERATION_ENABLED`, `FEDERATION_DEFAULT_ITEM_VISIBILITY`

### Phase 3 — Item federation (outbound + inbound mirror)
- `bubble:Item` JSON-LD serializer (Valueflows-extended)
- `nameMap`/`summaryMap` for all available languages (decision 10)
- Outbound `Create`/`Update`/`Delete` Item activities, signal-driven, dispatched via Huey
- `federation_visibility` defaulting based on `Item.visibility`
- User-level global opt-out cascades to `Delete` for previously federated items
- Inbound handler creates/updates `RemoteItem`
- Image federation: `attachment[].url` absolute; optional inbound caching
- Frontend: badge on remote items showing originating instance

### Phase 4 — Follows & catalog distribution
- `Follow`/`Accept Follow`/`Undo Follow`
- Per-user follows + per-instance "subscribe to peer catalog" via system actor
- Inbox `Create Item` from followed peer → `RemoteItem`
- Backfill task triggered by admin confirmation (F3): paginated, throttled outbox fetch

### Phase 5 — Federated search UX
- Search spans `Item` + `RemoteItem`
- `scope=local|federated` query param (decision 18)
- Result-card variant for remote items showing origin instance
- Pagination strategy: union sort by relevance/recency

### Phase 6 — Bookings (highest-risk phase)
- AP mapping for `Booking` lifecycle
- Outbound flows for all three combinations (local/local, local/remote, remote/local)
- Acceptance authority: any local user with `change_item` perm (decision 6)
- `Accept`/`Reject`/`Undo`/counter-`Offer` round-trips
- Existing exclusion constraints handle overlap regardless of booker identity
- WebSocket notifications for remote-originated booking events (reuse `core/websocket_signals.py`)
- Edge cases: race losers receive `Reject`; counter-offer chains; offline-peer retry

### Phase 7 — Messages
- AP `Note` mapping, addressed to all booking participants
- Inbound `Note` → `Message` with `remote_sender_actor` if remote
- Existing notification dispatch (Huey/RocketChat/email/WS) works unchanged

### Phase 8 — Hardening
- Outbound retry/backoff/dead-letter via `OutboundDelivery`
- Inbox idempotency via `InboundActivity.id` dedupe
- `django-ratelimit` on inbox keyed on signing actor + IP
- Metrics (delivery success rate, queue depth, signature failures, mirror lag)
- Federation health endpoint
- GDPR: `Delete Person` fan-out on account deletion (best-effort, decision 20)
- Documentation: ops runbook, allowlist admin guide, user privacy doc

### Phase 9 — Mastodon-compat polish (decision 22)
- Verify `Person` actor renders in Mastodon profile lookup
- `featured` collection (e.g. user's showcase items as `Note`s)
- HTML `content` fallback in all outbound `Note`s
- WebFinger end-to-end test against a real Mastodon container

### Phase 10 — Deferred (backlog, decisions 5/7/19)
- Account migration (`Move`)
- Moderation tooling (reports, mutes, defederation UI)
- Federated payments
- C2S ActivityPub
- Open-federation toggle (allowlist → blocklist model)

---

## Cross-cutting concerns

### Permissions model
- Remote actors do not hold guardian object perms (decision 16)
- Federation layer derives implicit perms from signed-actor identity
- Local user perms (incl. `change_item` for booking acceptance) unchanged

### Settings to add

```
FEDERATION_ENABLED=true
FEDERATION_DOMAIN=bubble.example
FEDERATION_KEY_ENCRYPTION_KEY=<base64 fernet key>
FEDERATION_DELIVERY_TIMEOUT=10
FEDERATION_DELIVERY_MAX_RETRIES=8
FEDERATION_INBOX_RATE_LIMIT=60/m

STORAGE_BACKEND=local|s3
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
S3_BUCKET=...
S3_ENDPOINT_URL=...
S3_PUBLIC_URL_BASE=...
```

### Operational additions
- Helm chart: federation env vars + optional MinIO subchart (F8)
- Caddy/ingress: ensure `/.well-known/*` and `/federation/*` reachable, no auth gating
- Backup/retention: archive `InboundActivity` rows >90 days

### Testing strategy
- Unit: serializers, signature sign/verify, dispatch
- Integration: docker-compose two-instance setup in CI, end-to-end "book a remote item" scenario
- Spec compliance: `feditest` runs in CI
- Mastodon interop: dedicated CI job against Mastodon container

### Documentation deliverables
- `docs/federation/protocol.md`
- `docs/federation/operating.md`
- `docs/federation/privacy.md`
- README.md quickstart update
- (AGENTS.md cleanup explicitly excluded per F7)

---

## Risks (tracked, not blockers)

1. Booking eventual consistency — booker UI shows PENDING during round-trip
2. Storage migration is gating for production federation
3. Visibility model gap — `AUTHENTICATED` and `internal` items are LOCAL_ONLY by default
4. Username collisions at federation boundary — display always uses `@user@domain`
5. Huey queue load increase — phase-8 load test required
6. Outbound delivery to dead peers can backlog — dead-letter cap required

---

## What's next

Start with **Phase 1 (storage abstraction)** — a clean, mergeable prerequisite before any federation code lands.
Then **Phase 0 (spike)** to validate the vocabulary and two-instance discovery before committing to the full `federation` app skeleton in Phase 2.
