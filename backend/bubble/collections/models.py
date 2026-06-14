import uuid

from django.conf import settings
from django.db import models
from django.utils.text import slugify
from django.utils.translation import gettext_lazy as _
from guardian.models import GroupObjectPermissionBase, UserObjectPermissionBase
from guardian.shortcuts import assign_perm, get_objects_for_user

from bubble.items.models import Item

AUTH_USER_MODEL = settings.AUTH_USER_MODEL


class CollectionManager(models.Manager):
    def get_for_user(self, user) -> models.QuerySet:
        """Return a queryset filtered by user permissions."""
        collections_with_view_permission = get_objects_for_user(
            user,
            f"{self.model._meta.app_label}.view_{self.model._meta.model_name}",  # noqa: SLF001
            accept_global_perms=False,
        )
        return self.filter(pk__in=collections_with_view_permission)


class Collection(models.Model):
    """
    A collection of items that can be shared with other users.
    The creator is the owner and can grant permissions to other users or groups.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200)
    slug = models.SlugField(
        max_length=200,
        unique=True,
        blank=True,
        help_text=_(
            "URL-friendly identifier. Generated from the name by default, "
            "but can be customised."
        ),
    )
    description = models.TextField(blank=True)
    owner = models.ForeignKey(
        AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="owned_collections",
    )
    items = models.ManyToManyField(
        Item,
        through="CollectionItem",
        related_name="collections",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    # Custom manager
    objects = CollectionManager()

    class Meta:
        ordering = ["-created_at"]
        permissions = [
            ("add_items", "Can add items to collection"),
            ("remove_items", "Can remove items from collection"),
        ]

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        # Generate a slug from the explicit value (if provided) or fall back to
        # the name. Guarantee uniqueness by appending an incrementing suffix.
        base_slug = slugify(self.slug) if self.slug else slugify(self.name)
        if not base_slug:
            base_slug = slugify(self.name)

        new_slug = base_slug
        queryset = self._meta.model.objects.all()
        if self.pk:
            queryset = queryset.exclude(pk=self.pk)

        counter = 1
        while queryset.filter(slug=new_slug).exists():
            new_slug = f"{base_slug}-{counter}"
            counter += 1
        self.slug = new_slug

        # Check if this is a new object by checking if it exists in the database
        is_new = self._state.adding
        super().save(*args, **kwargs)

        # Assign all permissions to owner on creation
        if is_new and self.owner:
            app_label = self._meta.app_label
            model_name = self._meta.model_name
            assign_perm(f"{app_label}.view_{model_name}", self.owner, obj=self)
            assign_perm(f"{app_label}.change_{model_name}", self.owner, obj=self)
            assign_perm(f"{app_label}.delete_{model_name}", self.owner, obj=self)
            assign_perm(f"{app_label}.add_items", self.owner, obj=self)
            assign_perm(f"{app_label}.remove_items", self.owner, obj=self)


class CollectionItem(models.Model):
    """
    Through model for the many-to-many relationship between Collection and Item.
    Allows additional metadata about the item in the collection.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    collection = models.ForeignKey(
        Collection, on_delete=models.CASCADE, related_name="collection_items"
    )
    item = models.ForeignKey(
        Item, on_delete=models.CASCADE, related_name="collection_items"
    )
    added_at = models.DateTimeField(auto_now_add=True)
    added_by = models.ForeignKey(
        AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="added_collection_items",
    )
    note = models.TextField(blank=True, help_text=_("Optional note about this item"))
    ordering = models.IntegerField(default=0)

    class Meta:
        ordering = ["ordering", "added_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["collection", "item"],
                name="unique_item_per_collection",
                violation_error_message=_("This item is already in the collection."),
            )
        ]

    def __str__(self):
        return f"{self.item.name} in {self.collection.name}"


class CollectionEvent(models.Model):
    """Audit log of item add/remove events on a collection."""

    class Action(models.TextChoices):
        ITEM_ADDED = "item_added", _("Item added")
        ITEM_REMOVED = "item_removed", _("Item removed")

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    collection = models.ForeignKey(
        Collection,
        on_delete=models.CASCADE,
        related_name="events",
    )
    # Nullable so the event survives item deletion; item_name is a snapshot
    item = models.ForeignKey(
        Item,
        on_delete=models.SET_NULL,
        null=True,
        related_name="collection_events",
    )
    item_name = models.CharField(
        max_length=255,
        blank=True,
        help_text=_("Snapshot of item name at event time"),
    )
    actor = models.ForeignKey(
        AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="collection_events",
    )
    action = models.CharField(max_length=20, choices=Action.choices)
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-timestamp"]

    def __str__(self):
        return f"{self.action} — {self.item_name} in {self.collection.name}"


class CollectionUserObjectPermission(UserObjectPermissionBase):
    """User-level permissions for Collection objects."""

    content_object = models.ForeignKey(Collection, on_delete=models.CASCADE)


class CollectionGroupObjectPermission(GroupObjectPermissionBase):
    """Group-level permissions for Collection objects."""

    content_object = models.ForeignKey(Collection, on_delete=models.CASCADE)
