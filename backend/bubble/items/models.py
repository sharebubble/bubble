import uuid
from pathlib import Path

from django.conf import settings
from django.db import models, transaction
from django.utils.text import slugify
from django.utils.translation import gettext_lazy as _
from djmoney.models.fields import MoneyField
from guardian.models import GroupObjectPermissionBase, UserObjectPermissionBase
from guardian.shortcuts import assign_perm, get_objects_for_user
from imagekit.models import ImageSpecField
from imagekit.processors import ResizeToFill, ResizeToFit
from PIL import ImageOps as PILImageOps
from simple_history.models import HistoricalRecords

from config.settings.base import AUTH_USER_MODEL

money_defaults = {
    "max_digits": 10,
    "decimal_places": 2,
}


class ConditionType(models.IntegerChoices):
    NEW = 0, _("New")
    USED = 1, _("Used")
    BROKEN = 2, _("Broken")


class ItemStatus(models.IntegerChoices):
    DRAFT = 0, _("Draft")
    AVAILABLE = 2, _("Available")
    RESERVED = 3, _("Reserved")
    RENTED = 4, _("Rented")
    SOLD = 5, _("Sold")
    ARCHIVED = 6, _("Archived")

    @classmethod
    def published(cls):
        """Statuses that make an item browsable in the public listings.

        Sold and archived items are deliberately excluded: once an item is
        gone it should no longer show up as something others can get. Their
        owner still sees them under the archive section of their own list.
        """
        return (cls.AVAILABLE, cls.RESERVED, cls.RENTED)

    @classmethod
    def archived(cls):
        """Statuses that retire an item from circulation.

        A sold item is archived implicitly — the sale is what took it out of
        circulation — while ``ARCHIVED`` lets an owner retire an item that was
        never sold (lost, worn out, or simply no longer shared).
        """
        return (cls.SOLD, cls.ARCHIVED)

    @classmethod
    def for_sales_type(cls, sales_type: str) -> tuple:
        """Return the valid statuses for a given sales_type."""
        sell_donate_types = ("sell", "donate", "want_buy")
        rent_borrow_types = ("rent", "borrow", "want_rent")
        if sales_type in sell_donate_types:
            return (cls.DRAFT, cls.AVAILABLE, cls.RESERVED, cls.SOLD, cls.ARCHIVED)
        if sales_type in rent_borrow_types:
            return (
                cls.DRAFT,
                cls.AVAILABLE,
                cls.RESERVED,
                cls.RENTED,
                cls.ARCHIVED,
            )
        return tuple(cls.values)


class RentalPeriodType(models.TextChoices):
    HOURLY = "h", _("Hourly")
    DAILY = "d", _("Daily")
    WEEKLY = "w", _("Weekly")


class VisibilityType(models.IntegerChoices):
    PUBLIC = 0, _("Public")
    AUTHENTICATED = 1, _("Authenticated")
    SPECIFIC = 2, _("Specific")
    PRIVATE = 3, _("Private")


class SalesType(models.TextChoices):
    SELL = "sell", _("Sell")
    DONATE = "donate", _("Donate")
    RENT = "rent", _("Rent")
    BORROW = "borrow", _("Borrow")
    WANT_BUY = "want_buy", _("Want to Buy")
    WANT_RENT = "want_rent", _("Want to Rent")


class CategoryType(models.TextChoices):
    BOOKS = "books", _("Books")
    CLOTHING = "clothing", _("Clothing")
    ELECTRONICS = "electronics", _("Electronics")
    FURNITURE = "furniture", _("Furniture")
    GARDEN = "garden", _("Garden")
    KITCHEN = "kitchen", _("Kitchen")
    OTHER = "other", _("Other")
    ROOMS = "rooms", _("Rooms")
    SPORTS = "sports", _("Sports")
    TOOLS = "tools", _("Tools")
    TOYS = "toys", _("Toys")
    VEHICLES = "vehicles", _("Vehicles")


class Location(models.Model):
    """A physical place where an item can be kept.

    This is distinct from the per-user *geographic* location (address / map
    coordinates used for pickup): a ``Location`` is a named, curator-managed
    placement such as a library shelf or a shared workspace area.

    ``item_category`` scopes a location to a single item category, so that —
    for example — book shelves are only offered for books and workshop areas
    only for tools.  A location with a blank ``item_category`` applies to
    items of any category.

    An item with no location (``Item.location`` is ``NULL``) is understood to
    be at the owner's own place (their home).  This is the default.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(
        max_length=255,
        help_text=_("Name of the place, e.g. 'Sci-Fi shelf' or 'Shared workshop'."),
    )
    section = models.CharField(
        max_length=100,
        blank=True,
        db_index=True,
        help_text=_(
            "Optional grouping used to organise locations in the picker, "
            "e.g. a library section or a building area."
        ),
    )
    item_category = models.CharField(
        max_length=100,
        blank=True,
        db_index=True,
        choices=CategoryType,
        help_text=_(
            "Restrict this location to a single item category. "
            "Leave blank to make it available for items of any category."
        ),
    )
    description = models.TextField(blank=True)
    sort_order = models.PositiveIntegerField(
        default=0,
        help_text=_("Lower numbers are shown first within a section."),
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["item_category", "section", "sort_order", "name"]
        constraints = [
            models.UniqueConstraint(
                fields=["item_category", "name"],
                name="unique_location_name_per_category",
                violation_error_message=_(
                    "A location with this name already exists for this category."
                ),
            )
        ]

    def __str__(self):
        label = self.name
        if self.section:
            label = f"{self.section} · {label}"
        if self.item_category:
            label = f"{label} ({self.get_item_category_display()})"
        return label


class ItemManager(models.Manager):
    def published(self) -> models.QuerySet:
        """Return a queryset of published items."""
        return self.filter(status__in=ItemStatus.published())

    def visible_to(self, user) -> models.QuerySet:
        """Return published items the given user is allowed to view.

        Mirrors the visibility rules of the public items endpoint:
        - PUBLIC: visible to everyone (incl. anonymous).
        - AUTHENTICATED: visible to any logged-in user.
        - SPECIFIC / PRIVATE: only when the user holds explicit view_item.
        """
        from constance import config  # noqa: PLC0415

        base_qs = self.published()

        if not user or not user.is_authenticated:
            if config.REQUIRE_LOGIN:
                return base_qs.none()
            return base_qs.filter(visibility=VisibilityType.PUBLIC)

        explicitly_visible = get_objects_for_user(
            user,
            "items.view_item",
            accept_global_perms=False,
        ).values_list("pk", flat=True)

        return base_qs.filter(
            models.Q(
                visibility__in=[VisibilityType.PUBLIC, VisibilityType.AUTHENTICATED]
            )
            | models.Q(visibility=VisibilityType.SPECIFIC, pk__in=explicitly_visible)
            | models.Q(visibility=VisibilityType.PRIVATE, pk__in=explicitly_visible)
        )

    def get_for_user(self, user) -> models.QuerySet:
        """Return a queryset filtered by user permissions."""
        items_with_change_permission = get_objects_for_user(
            user,
            f"{self.model._meta.app_label}.change_{self.model._meta.model_name}",  # noqa: SLF001
            accept_global_perms=False,
        )
        return self.filter(pk__in=items_with_change_permission)


class Item(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="items",
    )
    category = models.CharField(
        max_length=100,
        blank=True,
        db_index=True,
        choices=CategoryType,
        help_text=_("Category of the item"),
    )
    name = models.CharField(max_length=200, blank=True)
    slug = models.SlugField(max_length=200, unique=True, blank=True)
    description = models.TextField(blank=True)
    internal = models.BooleanField(
        default=False,
        help_text=_("Internal item, not for public display"),
    )
    display_contact = models.BooleanField(
        default=False,
        help_text=_("Display your contact information public"),
    )
    sales_type = models.CharField(
        max_length=20,
        choices=SalesType,
        help_text=_(
            "How the item is offered: Sell, Donate, Rent, Borrow, "
            "Want to Buy, or Want to Rent."
        ),
    )
    price = MoneyField(
        **money_defaults,
        blank=True,
        null=True,
        default_currency=settings.DEFAULT_CURRENCY,
        help_text=_(
            "Price for sell/rent items (must be > 0). "
            "Leave blank for donate/borrow items. "
            "Rental price per rental_period (when sales type is rent)."
        ),
    )

    rental_period = models.CharField(
        max_length=1,
        blank=True,
        choices=RentalPeriodType,
        default=RentalPeriodType.HOURLY,
        help_text=_(
            "Defines the period the rental price applies to (hourly, daily, "
            "weekly). Used for price calculation and display formatting."
        ),
    )
    rental_self_service = models.BooleanField(
        default=False,
        help_text=_("Allow self-service rental without owner approval"),
    )
    rental_open_end = models.BooleanField(
        default=False,
        help_text=_("Allow open-ended rentals without a return date"),
    )

    payment_enabled = models.BooleanField(
        default=False,
        help_text=_("Enable payment via internal payment system"),
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    condition = models.IntegerField(
        choices=ConditionType,
        default=ConditionType.USED,
        help_text=_("Condition of the item"),
    )
    active = models.BooleanField(default=True)

    status = models.IntegerField(
        choices=ItemStatus,
        default=ItemStatus.DRAFT,
    )

    publish_notification_sent = models.BooleanField(
        default=False,
        editable=False,
        help_text=_("Set to True after the first publish notification has been sent."),
    )

    visibility = models.IntegerField(
        choices=VisibilityType,
        default=VisibilityType.AUTHENTICATED,
        help_text=_(
            "Who can see this item: Public (everyone), "
            "Authenticated (logged-in users), "
            "Specific (selected users/groups), "
            "or Private (owner and co-owners only)."
        ),
    )

    location = models.ForeignKey(
        Location,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="items",
        help_text=_(
            "Where the item is currently kept. "
            "Leave blank when the item is at the owner's own place (the default)."
        ),
    )

    properties = models.JSONField(
        blank=True,
        null=True,
        help_text=_(
            "Category-specific properties stored as JSONB. "
            "For books: isbn, language, year, topic, metadata, authors, genres, "
            "publisher, shelf."
        ),
    )

    # Federation
    federation_visibility = models.CharField(
        max_length=20,
        choices=[
            ("public_federated", _("Public (federated)")),
            ("local_only", _("Local only")),
        ],
        default="local_only",
        help_text=_(
            "Controls whether this item is shared via ActivityPub federation. "
            "'Public (federated)' shares it with allowed peer instances. "
            "'Local only' keeps it on this instance only."
        ),
    )
    # Cached ActivityPub object URI — populated when the item is first federated.
    ap_id = models.URLField(
        max_length=2048,
        blank=True,
        default="",
        editable=False,
        help_text=_("ActivityPub object URI for this item."),
    )

    # enable history tracking
    history = HistoricalRecords()

    # Custom manager
    objects = ItemManager()

    # Add class constants for easy access
    CONDITION_CHOICES = ConditionType.choices

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            # The item list endpoints filter by published ``status`` and order by
            # ``-created_at``; this composite index serves both in one scan.
            models.Index(
                fields=["status", "-created_at"],
                name="items_status_created_idx",
            ),
        ]
        constraints = [
            # donate and borrow require price to be null
            models.CheckConstraint(
                condition=(
                    ~models.Q(sales_type__in=["donate", "borrow"])
                    | models.Q(price__isnull=True)
                ),
                name="items_donate_borrow_require_null_price",
            ),
        ]

    def __str__(self):
        return f"{self.pk} - {self.name}" or f"Item {self.pk}"

    def save(self, *args, **kwargs):
        if not self.slug or self.slug.startswith("-"):
            new_slug = slugify(self.name)
            queryset = self._meta.model.objects.all()
            if self.pk:
                queryset = queryset.exclude(pk=self.pk)

            counter = 1
            while queryset.filter(slug=new_slug).exists():
                new_slug = f"{slugify(self.name)}-{counter}"
                counter += 1
            self.slug = new_slug

        is_new = self._state.adding
        super().save(*args, **kwargs)

        if is_new and self.user:
            # give owner full object permissions on instance
            app_label = self._meta.model._meta.app_label  # noqa: SLF001
            model_name = self._meta.model._meta.model_name  # noqa: SLF001
            assign_perm(f"{app_label}.view_{model_name}", self.user, obj=self)
            assign_perm(f"{app_label}.change_{model_name}", self.user, obj=self)
            assign_perm(f"{app_label}.delete_{model_name}", self.user, obj=self)

    def is_ready_for_display(self):
        """Check if item has minimum required fields to be displayed."""
        return bool(self.name and self.category)

    def get_first_image(self):
        """Return the first image of the item based on ordering.

        When the item's images have been prefetched (e.g. in the list
        endpoints), read from the prefetch cache instead of issuing a fresh
        query. ``Image.Meta.ordering`` already orders by ``("item", "ordering")``
        so the first cached image is the one with the lowest ordering — calling
        ``.order_by("ordering")`` here would clone the queryset, discard the
        prefetched result cache and trigger one extra query per item (a classic
        N+1 across a page of results).
        """
        if "images" in getattr(self, "_prefetched_objects_cache", {}):
            images = self.images.all()
            return images[0] if images else None
        return self.images.order_by("ordering").first()

    def transfer_ownership(self, new_owner):
        """Transfer the item to ``new_owner`` after a completed sale.

        Clears every existing object-level permission (old owner, co-owners and
        specific viewers), assigns the new owner full permissions, resets the
        item to a fresh ``DRAFT`` listing and removes it from federation. The new
        owner can then re-list it as their own.
        """
        with transaction.atomic():
            ItemUserObjectPermission.objects.filter(content_object=self).delete()
            ItemGroupObjectPermission.objects.filter(content_object=self).delete()

            self.user = new_owner
            self.status = ItemStatus.DRAFT
            self.publish_notification_sent = False
            self.federation_visibility = "local_only"
            self.save()

            app_label = self._meta.app_label
            model_name = self._meta.model_name
            assign_perm(f"{app_label}.view_{model_name}", new_owner, obj=self)
            assign_perm(f"{app_label}.change_{model_name}", new_owner, obj=self)
            assign_perm(f"{app_label}.delete_{model_name}", new_owner, obj=self)


class ItemUserObjectPermission(UserObjectPermissionBase):
    content_object = models.ForeignKey(Item, on_delete=models.CASCADE)

    class Meta:
        indexes = [
            models.Index(fields=["user", "content_object"]),
        ]


class ItemGroupObjectPermission(GroupObjectPermissionBase):
    content_object = models.ForeignKey(Item, on_delete=models.CASCADE)

    class Meta:
        indexes = [
            models.Index(fields=["group", "content_object"]),
        ]


class ExifTranspose:
    """Rotate/flip an image according to its EXIF orientation tag."""

    def process(self, image):
        return PILImageOps.exif_transpose(image)


def upload_to_item_images(instance: "Image", filename: str):
    extension: str = Path(filename).suffix or ".jpg"
    item_creation_datestr = instance.item.created_at.strftime("%Y/%m/%d")
    item_prefix: str = f"items/{item_creation_datestr}/{instance.item.id}"
    return f"{item_prefix}/{str(uuid.uuid4())[0:8]}/original{extension}"


class Image(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    original = models.ImageField(upload_to=upload_to_item_images, max_length=255)
    item = models.ForeignKey(Item, on_delete=models.CASCADE, related_name="images")
    ordering = models.IntegerField(default=0)

    # Small grid/card thumbnail. Cropped to a fixed box.
    thumbnail = ImageSpecField(
        source="original",
        processors=[ExifTranspose(), ResizeToFill(300, 200)],
        format="JPEG",
        options={"quality": 80, "optimize": True, "progressive": True},
    )
    # Scaled-down image served on the item detail page. ``ResizeToFit`` bounds
    # the longest edge to 1200px (without upscaling smaller originals), which
    # produces a much lighter file than the full-resolution original while
    # staying sharp on typical viewports. ``optimize``/``progressive`` shave
    # off additional bytes and let the image render top-to-bottom as it loads.
    preview = ImageSpecField(
        source="original",
        processors=[ExifTranspose(), ResizeToFit(1200, 1200, upscale=False)],
        format="JPEG",
        options={"quality": 80, "optimize": True, "progressive": True},
    )

    class Meta:
        ordering = ["item", "ordering"]

    def __str__(self):
        return f"Image for {self.item.name} ({self.filename})"

    @property
    def filename(self):
        """Return the filename of the original image."""
        return self.original.name.split("/")[-1]

    def _get_temp_path(self, suffix: str) -> str | None:
        """Return the path where the image should be stored."""
        folder = f"temp/{suffix}/{str(self.item.id)[0:4]}/{self.pk}"
        return f"{folder}/{suffix}.jpg"

    def get_preview_path(self) -> str | None:
        """Return the path where the preview image should be stored."""
        if not self.original:
            return None
        return self._get_temp_path("preview")

    def get_thumbnail_path(self) -> str | None:
        """Return the path where the thumbnail image should be stored."""
        if not self.original:
            return None
        return self._get_temp_path("thumbnail")
