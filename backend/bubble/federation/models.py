"""Federation models.

Implements the data layer for ActivityPub federation:
  - RemoteInstance    - peer Bubble instances on the allowlist
  - RemoteActor       - cached remote Person/Application actors
  - LocalActorKey     - per-user RSA keypair for HTTP Signatures
  - InstanceActorKey  - singleton keypair for the instance actor
  - RemoteItem        - mirrored items from remote instances
  - RemoteItemImage   - images attached to remote items
  - RemoteFavorite    - Likes from remote actors on local items
  - Follow            - actor-to-actor follow relationships
  - InboundActivity   - append-only log of received AP activities
  - OutboundDelivery  - delivery queue for outbound AP activities
"""

import uuid

from django.conf import settings
from django.db import models
from django.utils.translation import gettext_lazy as _


class AllowlistState(models.TextChoices):
    PENDING = "pending", _("Pending review")
    ALLOWED = "allowed", _("Allowed")
    BLOCKED = "blocked", _("Blocked")


class RemoteInstance(models.Model):
    """A remote Bubble (or ActivityPub-compatible) instance."""

    domain = models.CharField(
        max_length=255,
        primary_key=True,
        verbose_name=_("Domain"),
        help_text=_("Bare domain name, e.g. 'other.bubble.example'"),
    )
    software = models.CharField(max_length=100, blank=True, verbose_name=_("Software"))
    software_version = models.CharField(
        max_length=50, blank=True, verbose_name=_("Software version")
    )
    nodeinfo_url = models.URLField(blank=True, verbose_name=_("NodeInfo URL"))
    allowlist_state = models.CharField(
        max_length=20,
        choices=AllowlistState,
        default=AllowlistState.PENDING,
        verbose_name=_("Allowlist state"),
    )
    # Convenience shortcut used by queries; derived from allowlist_state.
    inbox_url = models.URLField(
        blank=True,
        verbose_name=_("Shared inbox URL"),
        help_text=_("Populated when the instance actor is fetched."),
    )
    # Backfill: URL of the remote catalog / outbox to paginate on allowlist.
    # For Bubble peers this is auto-derived as https://<domain>/federation/users/
    # <instance-actor>/outbox; admins may override for non-Bubble peers.
    catalog_url = models.URLField(
        blank=True,
        verbose_name=_("Catalog / outbox URL"),
        help_text=_(
            "Paginated ActivityPub outbox or collection URL used for backfill. "
            "Auto-populated from the instance actor when left empty."
        ),
    )
    first_seen = models.DateTimeField(auto_now_add=True, verbose_name=_("First seen"))
    last_seen = models.DateTimeField(auto_now=True, verbose_name=_("Last seen"))

    class Meta:
        verbose_name = _("Remote instance")
        verbose_name_plural = _("Remote instances")
        ordering = ["domain"]

    def __str__(self):
        return self.domain

    @property
    def is_allowed(self):
        return self.allowlist_state == AllowlistState.ALLOWED


class RemoteActor(models.Model):
    """Cached ActivityPub actor from a remote instance."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # Canonical AP actor URL — globally unique across the federation.
    ap_id = models.URLField(
        unique=True,
        max_length=2048,
        verbose_name=_("AP actor ID"),
    )
    instance = models.ForeignKey(
        RemoteInstance,
        on_delete=models.CASCADE,
        related_name="actors",
        verbose_name=_("Instance"),
    )
    actor_type = models.CharField(
        max_length=50,
        default="Person",
        verbose_name=_("Actor type"),
        help_text=_("AP type: Person, Application, Service, etc."),
    )
    preferred_username = models.CharField(
        max_length=255, verbose_name=_("Preferred username")
    )
    name = models.CharField(max_length=500, blank=True, verbose_name=_("Display name"))
    summary = models.TextField(blank=True, verbose_name=_("Summary / bio"))
    inbox_url = models.URLField(max_length=2048, verbose_name=_("Inbox URL"))
    shared_inbox_url = models.URLField(
        max_length=2048, blank=True, verbose_name=_("Shared inbox URL")
    )
    outbox_url = models.URLField(
        max_length=2048, blank=True, verbose_name=_("Outbox URL")
    )
    public_key_pem = models.TextField(verbose_name=_("Public key (PEM)"))
    icon_url = models.URLField(
        max_length=2048, blank=True, verbose_name=_("Avatar URL")
    )
    url = models.URLField(
        max_length=2048, blank=True, verbose_name=_("Profile HTML URL")
    )
    fetched_at = models.DateTimeField(auto_now=True, verbose_name=_("Last fetched at"))
    deleted = models.BooleanField(default=False, verbose_name=_("Deleted"))

    class Meta:
        verbose_name = _("Remote actor")
        verbose_name_plural = _("Remote actors")
        ordering = ["instance__domain", "preferred_username"]

    def __str__(self):
        return f"@{self.preferred_username}@{self.instance_id}"

    @property
    def handle(self):
        return f"@{self.preferred_username}@{self.instance_id}"

    @property
    def effective_inbox(self):
        """Return shared inbox if available, otherwise per-actor inbox."""
        return self.shared_inbox_url or self.inbox_url


class LocalActorKey(models.Model):
    """RSA keypair for a local user's ActivityPub actor.

    The private key is stored AES-encrypted using Fernet with the key
    derived from ``settings.FEDERATION_KEY_ENCRYPTION_KEY``.
    """

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="actor_key",
        verbose_name=_("User"),
    )
    public_key_pem = models.TextField(verbose_name=_("Public key (PEM)"))
    # Private key bytes encrypted with Fernet and stored as base64.
    private_key_encrypted = models.TextField(
        verbose_name=_("Private key (encrypted)"),
        help_text=_("Fernet-encrypted RSA private key, base64-encoded."),
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = _("Local actor key")
        verbose_name_plural = _("Local actor keys")

    def __str__(self):
        return f"Key for {self.user}"


class InstanceActorKey(models.Model):
    """Singleton RSA keypair for the instance-level AP actor.

    Use ``InstanceActorKey.load()`` to get (or create) the instance key.
    """

    public_key_pem = models.TextField(verbose_name=_("Public key (PEM)"))
    private_key_encrypted = models.TextField(
        verbose_name=_("Private key (encrypted)"),
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = _("Instance actor key")
        verbose_name_plural = _("Instance actor keys")

    def __str__(self):
        return "Instance actor key"

    def save(self, *args, **kwargs):
        # Enforce singleton
        if not self.pk:
            existing = InstanceActorKey.objects.first()
            if existing:
                self.pk = existing.pk
        super().save(*args, **kwargs)

    @classmethod
    def load(cls):
        """Return the singleton instance key, creating it if necessary."""
        from bubble.federation.crypto import generate_and_store_keypair  # noqa: PLC0415

        obj = cls.objects.first()
        if obj is None:
            obj = generate_and_store_keypair(cls)
        return obj


class RemoteItem(models.Model):
    """Mirror of an item published by a remote instance."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    ap_id = models.URLField(
        unique=True,
        max_length=2048,
        verbose_name=_("AP item ID"),
    )
    remote_actor = models.ForeignKey(
        RemoteActor,
        on_delete=models.CASCADE,
        related_name="items",
        verbose_name=_("Remote actor"),
    )
    instance = models.ForeignKey(
        RemoteInstance,
        on_delete=models.CASCADE,
        related_name="items",
        verbose_name=_("Instance"),
    )
    name = models.CharField(max_length=500, verbose_name=_("Name"))
    description = models.TextField(blank=True, verbose_name=_("Description"))
    category = models.CharField(max_length=50, blank=True, verbose_name=_("Category"))
    sales_type = models.CharField(
        max_length=50, blank=True, verbose_name=_("Sales type")
    )
    price = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        null=True,
        blank=True,
        verbose_name=_("Price"),
    )
    price_currency = models.CharField(
        max_length=10, blank=True, verbose_name=_("Currency")
    )
    condition = models.CharField(max_length=50, blank=True, verbose_name=_("Condition"))
    status = models.CharField(max_length=50, blank=True, verbose_name=_("Status"))
    properties = models.JSONField(
        default=dict, blank=True, verbose_name=_("Properties")
    )
    raw_jsonld = models.JSONField(null=True, blank=True, verbose_name=_("Raw JSON-LD"))
    last_updated_at = models.DateTimeField(auto_now=True)
    # Soft-delete: keep for historical references (bookings, messages)
    deleted = models.BooleanField(default=False, verbose_name=_("Deleted"))
    deleted_at = models.DateTimeField(
        null=True, blank=True, verbose_name=_("Deleted at")
    )

    class Meta:
        verbose_name = _("Remote item")
        verbose_name_plural = _("Remote items")
        ordering = ["-last_updated_at"]

    def __str__(self):
        return f"{self.name} @ {self.instance_id}"


class RemoteItemImage(models.Model):
    """Image attachment belonging to a remote item."""

    remote_item = models.ForeignKey(
        RemoteItem,
        on_delete=models.CASCADE,
        related_name="images",
        verbose_name=_("Remote item"),
    )
    ordering = models.PositiveSmallIntegerField(default=0, verbose_name=_("Ordering"))
    url = models.URLField(max_length=2048, verbose_name=_("Image URL"))
    alt = models.CharField(max_length=500, blank=True, verbose_name=_("Alt text"))

    class Meta:
        ordering = ["ordering"]
        verbose_name = _("Remote item image")
        verbose_name_plural = _("Remote item images")

    def __str__(self):
        return f"Image {self.ordering} for {self.remote_item}"


class RemoteFavorite(models.Model):
    """A Like activity from a remote actor on a local item."""

    remote_actor = models.ForeignKey(
        RemoteActor,
        on_delete=models.CASCADE,
        related_name="favorites",
        verbose_name=_("Remote actor"),
    )
    item = models.ForeignKey(
        "items.Item",
        on_delete=models.CASCADE,
        related_name="remote_favorites",
        verbose_name=_("Item"),
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("remote_actor", "item")]
        verbose_name = _("Remote favorite")
        verbose_name_plural = _("Remote favorites")

    def __str__(self):
        return f"{self.remote_actor} ♥ {self.item}"


class Follow(models.Model):
    """Actor follow relationship (local or cross-instance)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # Actors are identified by their AP URI strings to support both local
    # and remote actors without a polymorphic FK.
    follower_ap_id = models.URLField(
        max_length=2048, verbose_name=_("Follower actor ID")
    )
    followee_ap_id = models.URLField(
        max_length=2048, verbose_name=_("Followee actor ID")
    )
    accepted = models.BooleanField(default=False, verbose_name=_("Accepted"))
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("follower_ap_id", "followee_ap_id")]
        verbose_name = _("Follow")
        verbose_name_plural = _("Follows")

    def __str__(self):
        state = "→" if self.accepted else "⟶?"
        return f"{self.follower_ap_id} {state} {self.followee_ap_id}"


class ActivityStatus(models.TextChoices):
    RECEIVED = "received", _("Received")
    PROCESSING = "processing", _("Processing")
    PROCESSED = "processed", _("Processed")
    FAILED = "failed", _("Failed")
    IGNORED = "ignored", _("Ignored")


class InboundActivity(models.Model):
    """Append-only log of received ActivityPub activities.

    The primary key is the AP activity ``id`` URI for natural idempotency.
    """

    # AP activity id (URI) — natural idempotency key
    ap_id = models.CharField(
        max_length=2048,
        primary_key=True,
        verbose_name=_("AP activity ID"),
    )
    activity_type = models.CharField(max_length=50, verbose_name=_("Activity type"))
    actor_uri = models.URLField(max_length=2048, verbose_name=_("Actor URI"))
    received_at = models.DateTimeField(auto_now_add=True)
    processed_at = models.DateTimeField(
        null=True, blank=True, verbose_name=_("Processed at")
    )
    status = models.CharField(
        max_length=20,
        choices=ActivityStatus,
        default=ActivityStatus.RECEIVED,
    )
    raw_jsonld = models.JSONField(verbose_name=_("Raw JSON-LD"))
    error = models.TextField(blank=True, verbose_name=_("Error"))

    class Meta:
        verbose_name = _("Inbound activity")
        verbose_name_plural = _("Inbound activities")
        ordering = ["-received_at"]
        indexes = [
            models.Index(fields=["actor_uri"]),
            models.Index(fields=["status"]),
        ]

    def __str__(self):
        return f"{self.activity_type} from {self.actor_uri}"


class DeliveryStatus(models.TextChoices):
    PENDING = "pending", _("Pending")
    DELIVERED = "delivered", _("Delivered")
    FAILED = "failed", _("Failed")
    DEAD = "dead", _("Dead (max retries exceeded)")


class OutboundDelivery(models.Model):
    """Delivery queue entry for an outbound ActivityPub activity."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # The full serialised activity JSON (not a FK — activities are ephemeral)
    activity_id = models.CharField(max_length=2048, verbose_name=_("Activity ID (URI)"))
    activity_type = models.CharField(max_length=50, verbose_name=_("Activity type"))
    # Serialised activity body stored for retry
    payload = models.JSONField(verbose_name=_("Payload"))
    recipient_inbox = models.URLField(
        max_length=2048, verbose_name=_("Recipient inbox URL")
    )
    # Actor whose key signs this delivery
    signing_actor_uri = models.URLField(
        max_length=2048, verbose_name=_("Signing actor URI")
    )
    attempt = models.PositiveSmallIntegerField(
        default=0, verbose_name=_("Attempt count")
    )
    next_attempt_at = models.DateTimeField(
        null=True, blank=True, verbose_name=_("Next attempt at")
    )
    status = models.CharField(
        max_length=20,
        choices=DeliveryStatus,
        default=DeliveryStatus.PENDING,
    )
    last_error = models.TextField(blank=True, verbose_name=_("Last error"))
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = _("Outbound delivery")
        verbose_name_plural = _("Outbound deliveries")
        ordering = ["next_attempt_at"]
        indexes = [
            models.Index(fields=["status", "next_attempt_at"]),
            models.Index(fields=["activity_id"]),
        ]

    def __str__(self):
        return f"{self.activity_type} → {self.recipient_inbox} [{self.status}]"
