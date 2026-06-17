"""Models for calendar (iCalendar / CalDAV) sharing links.

A :class:`CalendarLink` holds a high-entropy, non-guessable secret that grants
access to a calendar resource without requiring login:

* ``ITEM`` — a public, read-only iCalendar feed for a single bookable item.
* ``COLLECTION`` — a public, read-only iCalendar feed for a collection.
* ``USER`` — a private, read-write CalDAV endpoint for one user. The user can
  read availability of bookable items and create events that become booking
  requests.

Secrets can be rotated (regenerated) so a leaked link can be revoked without
deleting the underlying item, collection or user.
"""

import secrets
import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone
from django.utils.translation import gettext_lazy as _

from bubble.collections.models import Collection
from bubble.items.models import Item

AUTH_USER_MODEL = settings.AUTH_USER_MODEL

# Number of random bytes behind a secret. token_urlsafe(48) yields a 64-char
# URL-safe string (~384 bits of entropy) — not feasibly guessable.
SECRET_BYTES = 48


def generate_secret() -> str:
    """Return a fresh, URL-safe, non-guessable secret."""
    return secrets.token_urlsafe(SECRET_BYTES)


class CalendarLinkKind(models.TextChoices):
    ITEM = "item", _("Item feed")
    COLLECTION = "collection", _("Collection feed")
    USER = "user", _("Personal CalDAV")


class CalendarLink(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    kind = models.CharField(max_length=16, choices=CalendarLinkKind)
    secret = models.CharField(
        max_length=128,
        unique=True,
        db_index=True,
        default=generate_secret,
        editable=False,
        help_text=_("Non-guessable secret embedded in the calendar URL."),
    )

    # Exactly one of item/collection is set for ITEM/COLLECTION kinds.
    item = models.ForeignKey(
        Item,
        on_delete=models.CASCADE,
        related_name="calendar_links",
        null=True,
        blank=True,
    )
    collection = models.ForeignKey(
        Collection,
        on_delete=models.CASCADE,
        related_name="calendar_links",
        null=True,
        blank=True,
    )
    # The owner of the link (item owner, collection owner, or the user whose
    # private CalDAV endpoint this is). Always set.
    user = models.ForeignKey(
        AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="calendar_links",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    last_used_at = models.DateTimeField(null=True, blank=True, editable=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["item"],
                condition=Q(kind=CalendarLinkKind.ITEM),
                name="uniq_item_calendar_link",
            ),
            models.UniqueConstraint(
                fields=["collection"],
                condition=Q(kind=CalendarLinkKind.COLLECTION),
                name="uniq_collection_calendar_link",
            ),
            models.UniqueConstraint(
                fields=["user"],
                condition=Q(kind=CalendarLinkKind.USER),
                name="uniq_user_calendar_link",
            ),
            models.CheckConstraint(
                name="calendar_link_target_matches_kind",
                condition=(
                    Q(
                        kind=CalendarLinkKind.ITEM,
                        item__isnull=False,
                        collection__isnull=True,
                    )
                    | Q(
                        kind=CalendarLinkKind.COLLECTION,
                        item__isnull=True,
                        collection__isnull=False,
                    )
                    | Q(
                        kind=CalendarLinkKind.USER,
                        item__isnull=True,
                        collection__isnull=True,
                    )
                ),
            ),
        ]

    def __str__(self):
        return f"CalendarLink<{self.kind}> {self.secret[:8]}…"

    def rotate(self) -> str:
        """Generate a new secret, revoking the previous link. Returns it."""
        self.secret = generate_secret()
        self.save(update_fields=["secret", "updated_at"])
        return self.secret

    def touch(self) -> None:
        """Record that the link was just used (best effort)."""
        self.last_used_at = timezone.now()
        self.save(update_fields=["last_used_at"])

    @classmethod
    def get_or_create_for_item(cls, item: Item) -> "CalendarLink":
        link, _created = cls.objects.get_or_create(
            kind=CalendarLinkKind.ITEM,
            item=item,
            defaults={"user": item.user},
        )
        return link

    @classmethod
    def get_or_create_for_collection(cls, collection: Collection) -> "CalendarLink":
        link, _created = cls.objects.get_or_create(
            kind=CalendarLinkKind.COLLECTION,
            collection=collection,
            defaults={"user": collection.owner},
        )
        return link

    @classmethod
    def get_or_create_for_user(cls, user) -> "CalendarLink":
        link, _created = cls.objects.get_or_create(
            kind=CalendarLinkKind.USER,
            user=user,
        )
        return link


class CalDAVObject(models.Model):
    """Maps a CalDAV calendar object (chosen by the client) to a Booking.

    When a user creates an event through the private CalDAV endpoint, the client
    picks the resource file name and the VEVENT UID. We persist that mapping so
    later GET/PUT/DELETE requests referencing the client's chosen name resolve
    back to the booking we created.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    link = models.ForeignKey(
        CalendarLink,
        on_delete=models.CASCADE,
        related_name="caldav_objects",
    )
    item = models.ForeignKey(
        Item,
        on_delete=models.CASCADE,
        related_name="caldav_objects",
    )
    booking = models.OneToOneField(
        "bookings.Booking",
        on_delete=models.CASCADE,
        related_name="caldav_object",
    )
    resource_name = models.CharField(
        max_length=255,
        help_text=_("Client-chosen .ics file name within the calendar collection."),
    )
    uid = models.CharField(max_length=255, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["link", "item", "resource_name"],
                name="uniq_caldav_object_resource",
            ),
        ]

    def __str__(self):
        return f"CalDAVObject {self.resource_name} -> booking {self.booking_id}"
