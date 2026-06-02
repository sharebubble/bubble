# Bubble ↔ ActivityPub / Valueflows Field Mapping

This document defines the canonical mapping between Bubble's Django model
fields and the ActivityPub / Valueflows / Bubble JSON-LD vocabulary used
for federation.

The Bubble JSON-LD context is served at `https://<instance>/ns/bubble/v1`
and also available at `docs/federation/bubble-context.jsonld`.

---

## Namespaces

| Prefix | URI | Used for |
|---|---|---|
| `as` | `https://www.w3.org/ns/activitystreams#` | Core AP types and properties |
| `vf` | `https://w3id.org/valueflows#` | Economic activity (offers, intents, commitments) |
| `schema` | `https://schema.org/` | Price, currency, description |
| `bubble` | `https://ns.sharebubble.org/v1#` | Bubble-specific extensions |

---

## Actor: `users.User` + `users.Profile`

AP type: `as:Person`

| Django field | AP property | Notes |
|---|---|---|
| `user.username` | `as:preferredUsername` | Local part of the handle (`@user@domain`) |
| `profile.get_full_name()` / `user.name` | `as:name` | Display name |
| `profile.bio` | `as:summary` | HTML or plain text; use `summaryMap` for multilingual |
| `profile.profile_image` | `as:icon` → `as:Image` | Avatar; absolute URL via `absolute_media_url()` |
| `user.federation_enabled` | — | If False, no `Person` actor is published |
| `profile.federation_discoverable` | — | If False, omit from WebFinger |
| derived | `as:id` | `https://<domain>/federation/users/<username>` |
| derived | `as:inbox` | `https://<domain>/federation/users/<username>/inbox` |
| derived | `as:outbox` | `https://<domain>/federation/users/<username>/outbox` |
| derived | `as:followers` | `https://<domain>/federation/users/<username>/followers` |
| derived | `as:following` | `https://<domain>/federation/users/<username>/following` |
| derived | `as:featured` | `https://<domain>/federation/users/<username>/featured` |
| `LocalActorKey.public_key_pem` | `as:publicKey` → W3ID Security vocab | RSA-2048 PEM |
| derived | `as:url` | `https://<domain>/u/<username>` (HTML profile) |
| `profile.language` | `as:contentMap` language hint | Tag on outbound activities |

Mastodon-required extra fields:

```json
{
  "type": "Person",
  "manuallyApprovesFollowers": false,
  "discoverable": true,
  "indexable": false
}
```

---

## Instance Actor

AP type: `as:Application`

| Field | Value |
|---|---|
| `as:id` | `https://<domain>/federation/instance-actor` |
| `as:preferredUsername` | `<domain>` (Mastodon convention) |
| `as:name` | Instance name from `FEDERATION_INSTANCE_NAME` setting |
| `as:inbox` | `https://<domain>/federation/inbox` (shared inbox) |
| `as:publicKey` | From `InstanceActorKey` |

---

## Item: `items.Item`

AP type: `bubble:Item` (extends `vf:ResourceSpecification`)

Wrapped in an `as:Create` activity on publish, `as:Update` on save, `as:Delete` on removal/opt-out.

| Django field | AP property | Notes |
|---|---|---|
| `item.id` (UUID) | `as:id` | `https://<domain>/federation/items/<uuid>` |
| `item.name` | `as:name` / `as:nameMap` | `nameMap` when translations present |
| `item.description` | `as:content` / `as:contentMap` | HTML allowed; multilingual via `contentMap` |
| `item.category` | `bubble:category` | Enum string (`books`, `tools`, etc.) |
| `item.sales_type` | `bubble:salesType` | `sell`, `donate`, `rent`, `borrow`, `want_buy`, `want_rent` |
| `item.price.amount` | `schema:price` | Decimal |
| `item.price_currency` | `schema:priceCurrency` | ISO 4217 |
| `item.condition` | `bubble:condition` | `new`, `used`, `broken` |
| `item.status` | `bubble:itemStatus` | `draft`, `available`, `reserved`, `rented`, `sold` |
| `item.rental_period` | `bubble:rentalPeriod` | `h`, `d`, `w` |
| `item.rental_self_service` | `bubble:rentalSelfService` | Boolean |
| `item.rental_open_end` | `bubble:rentalOpenEnd` | Boolean |
| `item.properties` | `bubble:properties` | JSON blob (book metadata, etc.) |
| `item.user` | `as:attributedTo` | Actor URI of owner |
| `item.created_at` | `as:published` | ISO 8601 |
| `item.updated_at` | `as:updated` | ISO 8601 |
| `item.images` | `as:attachment` → `[as:Image, …]` | Each image: `url`, `mediaType`, `name` (alt) |
| `item.federation_visibility` | `as:to` | `PUBLIC_FEDERATED` → `[as:Public]`; `LOCAL_ONLY` → not federated |
| `item.ap_id` | stored locally | Cached `as:id` URI |

Example image attachment:
```json
{
  "type": "Image",
  "mediaType": "image/jpeg",
  "url": "https://bubble.example/media/items/2024/01/01/abc/preview.jpg",
  "name": "A red bicycle"
}
```

---

## Booking: `bookings.Booking`

AP type: `bubble:BookingRequest` (extends `vf:Intent`)

Lifecycle activities:

| Booking event | Activity type | Object |
|---|---|---|
| New booking request | `as:Offer` | `bubble:BookingRequest` |
| Owner accepts | `as:Accept` | original `as:Offer` |
| Owner rejects | `as:Reject` | original `as:Offer` |
| Booker cancels | `as:Undo` | original `as:Offer` |
| Owner counter-offers | `as:Offer` with `as:inReplyTo` | new `bubble:BookingRequest` |

| Django field | AP property | Notes |
|---|---|---|
| `booking.id` (UUID) | `as:id` | `https://<domain>/federation/bookings/<uuid>` |
| `booking.item` | `as:object` → Item `as:id` | Link to the item being booked |
| `booking.user` / `remote_booker_actor` | `as:actor` | Booker's actor URI |
| `booking.time_from` | `bubble:timeFrom` | ISO 8601; nullable |
| `booking.time_to` | `bubble:timeTo` | ISO 8601; nullable (open-ended) |
| `booking.offer.amount` | `bubble:offerPrice.amount` | Proposed price |
| `booking.offer_currency` | `bubble:offerPrice.currency` | ISO 4217 |
| `booking.counter_offer` | `bubble:counterOfferPrice` | Counter-proposed price |
| `booking.status` | `bubble:bookingStatus` | `pending`, `confirmed`, `rejected`, `cancelled`, `completed` |
| `booking.created_at` | `as:published` | ISO 8601 |

---

## Message: `bookings.Message`

AP type: `as:Note`

Wrapped in `as:Create` activity. Addressed to all booking participants.

| Django field | AP property | Notes |
|---|---|---|
| `message.id` (UUID) | `as:id` | `https://<domain>/federation/messages/<uuid>` |
| `message.message` | `as:content` | Plain text; `as:mediaType`: `text/plain` |
| `message.sender` / `remote_sender_actor` | `as:attributedTo` | Sender's actor URI |
| `message.booking` | `as:context` | Booking `as:id` URI |
| `message.created_at` | `as:published` | ISO 8601 |
| derived | `as:to` | All participant actor URIs |
| derived | `as:inReplyTo` | Previous message URI (if any) |

HTML `content` fallback for Mastodon readability:
```json
{
  "type": "Note",
  "content": "<p>[Booking message for item: …]</p><p>Message text here.</p>",
  "mediaType": "text/html"
}
```

---

## Audience targeting (`as:to` / `as:cc`)

| Bubble visibility | `as:to` | `as:cc` |
|---|---|---|
| `PUBLIC_FEDERATED` | `["https://www.w3.org/ns/activitystreams#Public"]` | `[actor followers URI]` |
| Local-only / internal | Not federated | — |
| Booking / message | `[participant actor URIs]` | — |

---

## Activity envelope

All activities use this base structure:

```json
{
  "@context": [
    "https://www.w3.org/ns/activitystreams",
    "https://w3id.org/security/v1",
    "https://ns.sharebubble.org/v1"
  ],
  "id": "https://<domain>/federation/activities/<uuid>",
  "type": "<Activity type>",
  "actor": "https://<domain>/federation/users/<username>",
  "published": "<ISO 8601>",
  "to": ["https://www.w3.org/ns/activitystreams#Public"],
  "cc": ["https://<domain>/federation/users/<username>/followers"],
  "object": { … }
}
```

---

## Inbound processing rules

1. Verify HTTP Signature → reject if invalid
2. Check `actor` domain is in allowlist → reject if not
3. Deduplicate by `activity.id` (check `InboundActivity` table)
4. Dispatch by `type`:
   - `Create` + `bubble:Item` → upsert `RemoteItem`
   - `Update` + `bubble:Item` → update `RemoteItem`
   - `Delete` + `bubble:Item` → soft-delete `RemoteItem`
   - `Offer` + `bubble:BookingRequest` → create `Booking` with `remote_booker_actor`
   - `Accept` / `Reject` / `Undo` → update booking status
   - `Create` + `Note` (in booking context) → create `Message`
   - `Follow` → create `Follow` (pending), send `Accept Follow`
   - `Undo Follow` → delete `Follow`
   - `Like` → create `RemoteFavorite`
   - `Undo Like` → delete `RemoteFavorite`
   - `Delete` + `Person` → soft-delete `RemoteActor` + cascade to `RemoteItem`
