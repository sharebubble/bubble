"""JSON-LD serializers for federation.

Converts local Django model instances to ActivityPub / Valueflows JSON-LD
objects suitable for federation.
"""

from __future__ import annotations

import html as _html
from typing import TYPE_CHECKING

from django.conf import settings

from bubble.core.storage import absolute_media_url

if TYPE_CHECKING:
    from bubble.bookings.models import Booking, Message
    from bubble.items.models import Item

AP_CONTEXT = [
    "https://www.w3.org/ns/activitystreams",
    "https://w3id.org/security/v1",
    "https://ns.sharebubble.org/v1",
]

AS_PUBLIC = "https://www.w3.org/ns/activitystreams#Public"


def _base_url() -> str:
    domain = getattr(settings, "FEDERATION_DOMAIN", "")
    if not domain:
        hosts = getattr(settings, "ALLOWED_HOSTS", [])
        domain = next(
            (h for h in hosts if h not in ("localhost", "127.0.0.1", "*")),
            "localhost",
        )
    scheme = "http" if settings.DEBUG else "https"
    return f"{scheme}://{domain}"


_ITEM_CONTENT_MAX_DESC_LEN = 500


def _item_html_content(item: Item) -> str:
    """Build an HTML ``content`` fallback for a bubble:Item.

    Mastodon (and most AP clients) render the ``content`` field as HTML.
    This produces a minimal but readable card so remote users can understand
    the item without a Bubble-aware client.
    """

    parts: list[str] = []

    # Title line
    if item.name:
        parts.append(f"<p><strong>{_html.escape(item.name)}</strong></p>")

    # Key metadata line: sales type · condition · price
    meta: list[str] = []
    if item.sales_type:
        meta.append(_html.escape(str(item.sales_type)))
    if item.condition is not None:
        meta.append(_html.escape(str(item.condition)))
    if item.price and item.price.amount:
        meta.append(_html.escape(str(item.price)))
    if meta:
        parts.append(f"<p>{'&nbsp;·&nbsp;'.join(meta)}</p>")

    # Description (truncated to _ITEM_CONTENT_MAX_DESC_LEN chars)
    if item.description:
        desc = item.description[:_ITEM_CONTENT_MAX_DESC_LEN]
        if len(item.description) > _ITEM_CONTENT_MAX_DESC_LEN:
            desc += "…"
        parts.append(f"<p>{_html.escape(desc)}</p>")

    # Canonical link back to the item
    base = _base_url()
    item_uri = f"{base}/federation/items/{item.id}"
    parts.append(f'<p><a href="{item_uri}">{_html.escape(item_uri)}</a></p>')

    return "\n".join(parts)


def item_to_ap(item: Item) -> dict:
    """Serialize a local Item to a bubble:Item JSON-LD object."""
    base = _base_url()
    actor_uri = f"{base}/federation/users/{item.user.username}"
    item_uri = f"{base}/federation/items/{item.id}"

    # Build multilingual name/content maps
    name_map: dict[str, str] = {}
    content_map: dict[str, str] = {}
    if item.name:
        name_map[settings.LANGUAGE_CODE] = item.name
    # contentMap stores HTML (consistent with the top-level `content` field)
    content_map[settings.LANGUAGE_CODE] = _item_html_content(item)

    # Build image attachments
    attachments = []
    for img in item.images.all():
        url = absolute_media_url(img.preview)
        if url:
            attachments.append(
                {
                    "type": "Image",
                    "mediaType": "image/jpeg",
                    "url": url,
                }
            )

    doc = {
        "@context": AP_CONTEXT,
        "id": item_uri,
        "type": "bubble:Item",
        "attributedTo": actor_uri,
        "published": item.created_at.isoformat(),
        "updated": item.updated_at.isoformat(),
        "to": [AS_PUBLIC],
        "cc": [f"{actor_uri}/followers"],
        # Plain-text name for AP-native clients
        "name": item.name,
        # HTML content fallback for Mastodon and generic AP clients
        "content": _item_html_content(item),
        "mediaType": "text/html",
        # summary = plain-text one-liner (used as preview / subject in Mastodon)
        "summary": item.name or "",
        "bubble:category": item.category,
        "bubble:salesType": item.sales_type,
        "bubble:condition": item.condition,
        "bubble:itemStatus": item.status,
        "bubble:properties": item.properties or {},
    }

    if name_map:
        doc["nameMap"] = name_map
    if content_map:
        doc["contentMap"] = content_map
    if attachments:
        doc["attachment"] = attachments

    if item.price and item.price.amount:
        doc["schema:price"] = str(item.price.amount)
        doc["schema:priceCurrency"] = item.price_currency

    if item.rental_period:
        doc["bubble:rentalPeriod"] = item.rental_period
    if item.rental_self_service is not None:
        doc["bubble:rentalSelfService"] = item.rental_self_service
    if item.rental_open_end is not None:
        doc["bubble:rentalOpenEnd"] = item.rental_open_end

    return doc


def item_to_create_activity(item: Item) -> dict:
    """Wrap an Item in a Create activity."""
    base = _base_url()
    actor_uri = f"{base}/federation/users/{item.user.username}"
    return {
        "@context": AP_CONTEXT,
        "id": f"{base}/federation/activities/create-item-{item.id}",
        "type": "Create",
        "actor": actor_uri,
        "published": item.created_at.isoformat(),
        "to": [AS_PUBLIC],
        "cc": [f"{actor_uri}/followers"],
        "object": item_to_ap(item),
    }


def item_to_update_activity(item: Item) -> dict:
    """Wrap an Item in an Update activity."""
    base = _base_url()
    actor_uri = f"{base}/federation/users/{item.user.username}"
    return {
        "@context": AP_CONTEXT,
        "id": (
            f"{base}/federation/activities/"
            f"update-item-{item.id}-{item.updated_at.timestamp():.0f}"
        ),
        "type": "Update",
        "actor": actor_uri,
        "published": item.updated_at.isoformat(),
        "to": [AS_PUBLIC],
        "cc": [f"{actor_uri}/followers"],
        "object": item_to_ap(item),
    }


def item_to_delete_activity(item: Item) -> dict:
    """Build a Delete activity for an Item."""
    base = _base_url()
    actor_uri = f"{base}/federation/users/{item.user.username}"
    item_uri = f"{base}/federation/items/{item.id}"
    return {
        "@context": AP_CONTEXT,
        "id": f"{base}/federation/activities/delete-item-{item.id}",
        "type": "Delete",
        "actor": actor_uri,
        "to": [AS_PUBLIC],
        "object": item_uri,
    }


def item_to_note_stub(item: Item) -> dict:
    """Minimal Note for use in the featured collection (Mastodon-readable)."""
    base = _base_url()
    item_uri = f"{base}/federation/items/{item.id}"
    actor_uri = f"{base}/federation/users/{item.user.username}"

    price_str = f" · {item.price}" if item.price and item.price.amount else ""
    content = (
        f"<p><strong>{item.name}</strong>{price_str}</p>"
        f"<p>{item.description[:300] if item.description else ''}</p>"
        f'<p><a href="{item_uri}">{item_uri}</a></p>'
    )

    return {
        "type": "Note",
        "id": f"{item_uri}#note",
        "attributedTo": actor_uri,
        "content": content,
        "mediaType": "text/html",
        "url": item_uri,
        "to": ["https://www.w3.org/ns/activitystreams#Public"],
    }


# ---------------------------------------------------------------------------
# Booking serializers
#
# Bookings are represented as Valueflows ``Proposal`` objects.
# The booker sends an ``Offer`` activity; the item owner replies with
# ``Accept``, ``Reject``, or a counter ``TentativeAccept`` (counter-offer).
# ---------------------------------------------------------------------------

_VF_CONTEXT = "https://www.w3.org/ns/activitystreams"


def _booking_actor_uri(booking: Booking) -> str:
    """Return the AP actor URI for the booking's initiator."""
    base = _base_url()
    if booking.user:
        return f"{base}/federation/users/{booking.user.username}"
    if booking.remote_booker_actor:
        return booking.remote_booker_actor.ap_id
    return f"{base}/federation/instance-actor"


def _item_owner_actor_uri(booking: Booking) -> str:
    base = _base_url()
    return f"{base}/federation/users/{booking.item.user.username}"


def booking_to_ap(booking: Booking) -> dict:
    """Serialize a Booking as a ``bubble:BookingProposal`` object."""
    base = _base_url()
    booking_uri = f"{base}/federation/bookings/{booking.id}"
    item_uri = f"{base}/federation/items/{booking.item.id}"

    doc: dict = {
        "@context": AP_CONTEXT,
        "id": booking_uri,
        "type": "bubble:BookingProposal",
        "attributedTo": _booking_actor_uri(booking),
        "object": item_uri,
        "bubble:bookingStatus": booking.status,
        "published": booking.created_at.isoformat(),
        "updated": booking.updated_at.isoformat(),
    }
    if booking.time_from:
        doc["startTime"] = booking.time_from.isoformat()
    if booking.time_to:
        doc["endTime"] = booking.time_to.isoformat()
    if booking.offer and booking.offer.amount:
        doc["schema:price"] = str(booking.offer.amount)
        doc["schema:priceCurrency"] = str(booking.offer_currency)
    if booking.counter_offer and booking.counter_offer.amount:
        doc["bubble:counterOffer"] = str(booking.counter_offer.amount)
        doc["bubble:counterOfferCurrency"] = str(booking.counter_offer_currency)
    return doc


def booking_to_offer_activity(booking: Booking) -> dict:
    """Wrap a new Booking in an ``Offer`` activity (booker -> item owner)."""
    base = _base_url()
    return {
        "@context": AP_CONTEXT,
        "id": f"{base}/federation/activities/offer-booking-{booking.id}",
        "type": "Offer",
        "actor": _booking_actor_uri(booking),
        "to": [_item_owner_actor_uri(booking)],
        "published": booking.created_at.isoformat(),
        "object": booking_to_ap(booking),
    }


def booking_to_accept_activity(booking: Booking) -> dict:
    """``Accept`` activity sent by the item owner when confirming a booking."""
    base = _base_url()
    booking_uri = f"{base}/federation/bookings/{booking.id}"
    return {
        "@context": AP_CONTEXT,
        "id": (
            f"{base}/federation/activities/"
            f"accept-booking-{booking.id}-{booking.updated_at.timestamp():.0f}"
        ),
        "type": "Accept",
        "actor": _item_owner_actor_uri(booking),
        "to": [_booking_actor_uri(booking)],
        "published": booking.updated_at.isoformat(),
        "object": booking_uri,
    }


def booking_to_reject_activity(booking: Booking) -> dict:
    """``Reject`` activity sent by the item owner when declining a booking."""
    base = _base_url()
    booking_uri = f"{base}/federation/bookings/{booking.id}"
    return {
        "@context": AP_CONTEXT,
        "id": (
            f"{base}/federation/activities/"
            f"reject-booking-{booking.id}-{booking.updated_at.timestamp():.0f}"
        ),
        "type": "Reject",
        "actor": _item_owner_actor_uri(booking),
        "to": [_booking_actor_uri(booking)],
        "published": booking.updated_at.isoformat(),
        "object": booking_uri,
    }


def booking_to_tentative_accept_activity(booking: Booking) -> dict:
    """``TentativeAccept`` carries a counter-offer from the item owner."""
    base = _base_url()
    return {
        "@context": AP_CONTEXT,
        "id": (
            f"{base}/federation/activities/"
            f"tentative-accept-booking-{booking.id}"
            f"-{booking.updated_at.timestamp():.0f}"
        ),
        "type": "TentativeAccept",
        "actor": _item_owner_actor_uri(booking),
        "to": [_booking_actor_uri(booking)],
        "published": booking.updated_at.isoformat(),
        "object": booking_to_ap(booking),
    }


def booking_to_cancel_activity(booking: Booking, cancelled_by_uri: str) -> dict:
    """``Undo`` wrapping the original ``Offer`` — used to cancel a booking."""
    base = _base_url()
    booking_uri = f"{base}/federation/bookings/{booking.id}"
    return {
        "@context": AP_CONTEXT,
        "id": (
            f"{base}/federation/activities/"
            f"cancel-booking-{booking.id}-{booking.updated_at.timestamp():.0f}"
        ),
        "type": "Undo",
        "actor": cancelled_by_uri,
        "to": [
            _booking_actor_uri(booking),
            _item_owner_actor_uri(booking),
        ],
        "published": booking.updated_at.isoformat(),
        "object": booking_uri,
    }


# ---------------------------------------------------------------------------
# Message serializers
#
# Messages within a booking thread are ``Note`` objects addressed to the
# booking participants (item owner + booker).
# ---------------------------------------------------------------------------


def _message_sender_uri(message: Message) -> str:
    base = _base_url()
    if message.sender:
        return f"{base}/federation/users/{message.sender.username}"
    if message.remote_sender_actor:
        return message.remote_sender_actor.ap_id
    return f"{base}/federation/instance-actor"


def message_to_ap(message: Message) -> dict:
    """Serialize a booking ``Message`` as an AP ``Note``."""
    base = _base_url()
    msg_uri = f"{base}/federation/messages/{message.id}"
    booking_uri = f"{base}/federation/bookings/{message.booking_id}"
    sender_uri = _message_sender_uri(message)
    booking = message.booking

    # Address to both parties in the booking thread
    to = list(
        {
            _booking_actor_uri(booking),
            _item_owner_actor_uri(booking),
        }
    )

    return {
        "@context": AP_CONTEXT,
        "id": msg_uri,
        "type": "Note",
        "attributedTo": sender_uri,
        "inReplyTo": booking_uri,
        "to": to,
        "content": message.message,
        "mediaType": "text/plain",
        "published": message.created_at.isoformat(),
        "bubble:bookingId": str(message.booking_id),
    }


def message_to_create_activity(message: Message) -> dict:
    """Wrap a Message in a ``Create`` activity."""
    base = _base_url()
    sender_uri = _message_sender_uri(message)
    booking = message.booking
    to = list(
        {
            _booking_actor_uri(booking),
            _item_owner_actor_uri(booking),
        }
    )
    return {
        "@context": AP_CONTEXT,
        "id": (f"{base}/federation/activities/create-message-{message.id}"),
        "type": "Create",
        "actor": sender_uri,
        "to": to,
        "published": message.created_at.isoformat(),
        "object": message_to_ap(message),
    }
