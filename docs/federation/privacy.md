# Federation Privacy Notice

This document describes how Bubble handles personal data in the context of ActivityPub federation. It is intended for instance operators to use as a basis for their own privacy policies and for informing users.

---

## What data is federated

When a user enables federation and marks an item as **Public (federated)**, the following data is shared with allowlisted peer instances:

| Data | Where it goes |
|---|---|
| Item name, description, category, condition, price, sales type | Broadcast to all allowed peer instances |
| Item images (preview thumbnails) | Included as `Image` attachments in the AP object; served from your S3/local storage |
| User's display name and username | Included in the `attributedTo` field of every federated item |
| User's public profile (bio, location, join date, avatar) | Shared on demand when a remote instance resolves your actor URL |
| Public RSA key | Published in the actor document; required for HTTP Signature verification |
| Booking details (dates, status, parties) | Sent point-to-point between the item owner's instance and the booker's instance only |
| Messages attached to bookings | Sent point-to-point between the two instances involved in the booking |

### What is never federated

- Private items (`local_only` visibility)
- Items belonging to users with `federation_enabled = False`
- Passwords, email addresses, payment information
- Private messages outside of booking threads
- Collection contents, favourites, access grants

---

## Consent and control

### Per-user opt-out

Any user can disable federation entirely from their account settings:

- **Account settings → Federation → Disable federation**
- Effect: all their currently-federated items are flipped to `local_only` and a `Delete` activity is sent to all peer instances requesting removal.
- New items created after opt-out default to `local_only`.

### Per-item control

Each item has a **Federation visibility** field with two values:

- `public_federated` — item is broadcast to allowed peer instances
- `local_only` — item stays on this instance only (default for new items when the user has opted out)

### Discoverability

Users can additionally control whether their profile appears in remote instance search results via **Profile → Federation → Make profile discoverable** (`federation_discoverable` flag). Setting this to `false` sets `"discoverable": false` in the `Person` actor, which Mastodon and compliant servers honour by excluding the profile from directory listings.

---

## Data received from remote instances

When federation is active, Bubble may receive and store:

| Data | Storage |
|---|---|
| Remote item content (name, description, images URLs, metadata) | `RemoteItem` table; soft-deleted when the sending instance de-lists the item or is removed from the allowlist |
| Remote actor profile (username, display name, public key, avatar URL) | `RemoteActor` table |
| Inbound AP activities (raw JSON-LD) | `InboundActivity` append-only log |
| Outbound delivery attempts | `OutboundDelivery` queue; delivered rows may be purged after 30 days |

### Retention of remote data

- **Remote items** from de-allowlisted instances are soft-deleted (`deleted = true`) but not immediately purged, to preserve booking history. Operators should schedule hard deletion after the applicable retention period (recommended: 90 days).
- **Remote actor profiles** are kept as long as any booking or message references them. They can be anonymised on request by nulling display fields.
- **Inbound activity log** entries older than 90 days can be safely archived or deleted.

---

## Deletion propagation

### When a user deletes their account

1. A `Delete` activity is sent to all allowed peer instances for each federated item.
2. A `Delete Person` activity is sent for the user's actor.
3. Remote instances are expected to honour these and remove the data on a best-effort basis.

**Limitation**: Bubble cannot guarantee that remote instances comply with deletion requests. This is an inherent property of federated systems. Users should be informed of this limitation before enabling federation.

### When an item is deleted or made local-only

A `Delete` activity is sent to all instances that previously received a `Create` or `Update` for that item.

### When an instance is removed from the allowlist

Previously mirrored items from that instance are soft-deleted locally. No outbound deletion signal is sent to the de-allowlisted instance.

---

## Cross-border data transfers

When you allow federation with a remote instance, item content and user actor data are transmitted to servers operated by third parties in potentially different jurisdictions. Instance operators are responsible for:

1. Ensuring their allowlist only includes instances with adequate data protection standards.
2. Informing their users that federated content may be replicated to other jurisdictions.
3. Including this in their GDPR Article 13/14 disclosures if applicable.

---

## HTTP Signatures and key material

- Each user has a unique RSA-4096 keypair. The **public key** is published in the actor document and may be cached by remote instances indefinitely.
- The **private key** is stored encrypted (AES-GCM) in the database using `FEDERATION_KEY_ENCRYPTION_KEY`. It never leaves the instance.
- Key rotation is possible but requires re-delivery of all pending items (see `docs/federation/operating.md`).

---

## Instance operator checklist

Before enabling federation in production:

- [ ] Update your privacy policy to disclose that public items and actor profiles are shared with peer instances.
- [ ] List the specific instances in your allowlist and their data protection policies.
- [ ] Configure a data retention schedule for `InboundActivity`, `OutboundDelivery`, and soft-deleted `RemoteItem` rows.
- [ ] Document the user opt-out process in your user-facing help pages.
- [ ] Ensure your `FEDERATION_KEY_ENCRYPTION_KEY` is stored securely (e.g. in a secrets manager, not in version control).
- [ ] Verify that `/.well-known/` and `/federation/` paths are not behind authentication middleware.
