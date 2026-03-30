"""Serializers for items API."""

from django.utils.translation import gettext_lazy as _
from djmoney.contrib.django_rest_framework import MoneyField
from guardian.shortcuts import get_groups_with_perms, get_users_with_perms
from rest_framework import serializers, status

from bubble.items.models import Image, Item, ItemStatus, SalesType, money_defaults


class ItemOwnerException(serializers.ValidationError):
    status_code = status.HTTP_403_FORBIDDEN
    default_detail = _("You can only create images for items you own.")
    default_code = "permission_denied"


class ImageSerializer(serializers.ModelSerializer):
    """Serializer for Image model."""

    item = serializers.PrimaryKeyRelatedField(queryset=Item.objects.all())
    thumbnail = serializers.ImageField(read_only=True)
    preview = serializers.ImageField(read_only=True)
    ordering = serializers.IntegerField(required=False, allow_null=True)

    class Meta:
        model = Image
        fields = [
            "id",
            "original",
            "ordering",
            "thumbnail",
            "preview",
            "item",
        ]
        read_only_fields = ["id", "thumbnail", "preview"]

    def get_fields(self):
        """Override to make fields read-only on update."""
        fields = super().get_fields()

        # For existing instances (updates), only allow ordering to be modified
        if self.instance is not None:
            fields["original"].read_only = True
            fields["item"].read_only = True

        return fields

    def validate_item(self, value):
        """Ensure only item owners can create images for their items."""
        request = self.context.get("request")
        if request and request.user:
            if value.user != request.user:
                raise ItemOwnerException
        return value


class ItemSerializer(serializers.ModelSerializer):
    """Serializer for Item model."""

    images = ImageSerializer(many=True, read_only=True)
    user = serializers.PrimaryKeyRelatedField(read_only=True)
    first_image = serializers.SerializerMethodField()
    price = MoneyField(**money_defaults, required=False, allow_null=True)
    co_owners = serializers.SerializerMethodField()

    class Meta:
        model = Item
        fields = "__all__"
        read_only_fields = [
            "id",
            "user",
            "created_at",
            "date_updated",
            "images",
            "co_owners",
        ]

    def get_first_image(self, obj):
        """Get the first image of the item."""
        first_image = obj.get_first_image()
        if first_image:
            request = self.context.get("request")
            if first_image.thumbnail and request:
                return request.build_absolute_uri(first_image.thumbnail.url)
            if first_image.thumbnail:
                return first_image.thumbnail.url
        return None

    def get_co_owners(self, obj):
        """Return list of co-owner user IDs and group IDs (those with change_item)."""
        users = get_users_with_perms(obj, attach_perms=True, with_group_users=False)
        groups = get_groups_with_perms(obj, attach_perms=True)

        co_owner_users = [
            {"id": u.pk, "username": u.username}
            for u, perms in users.items()
            if "change_item" in perms and u != obj.user
        ]
        co_owner_groups = [
            {"id": g.pk, "name": g.name}
            for g, perms in groups.items()
            if "change_item" in perms
        ]
        return {"users": co_owner_users, "groups": co_owner_groups}

    def validate(self, attrs):
        """
        Enforce price rules based on sales_type.

        - sell / rent:      price is optional, but if set must be > 0
        - donate / borrow:  price must be null (auto-cleared on sales_type change)
        - want_buy / want_rent: price is unconstrained (any value or null)

        Enforces status restrictions per sales_type:
        - sell / donate / want_buy:   Draft, Available, Reserved, Sold
        - rent / borrow / want_rent:  Draft, Available, Rented

        Processing (1) is not a valid status for any listing type.

        Respects partial updates: missing fields fall back to instance values.
        When sales_type changes to donate/borrow, price is automatically cleared.
        """
        instance = self.instance
        sales_type = attrs.get(
            "sales_type",
            getattr(instance, "sales_type", None) if instance else None,
        )
        price = attrs.get(
            "price",
            getattr(instance, "price", None) if instance else None,
        )
        item_status = attrs.get(
            "status",
            getattr(instance, "status", None) if instance else None,
        )

        # Check if sales_type is being changed in this request
        sales_type_changing = "sales_type" in attrs

        if sales_type in (SalesType.SELL, SalesType.RENT):
            # Price is optional, but if provided must be > 0
            if price is not None and price.amount <= 0:
                raise serializers.ValidationError(
                    {"price": _("Price must be greater than 0 if provided.")}
                )

        elif sales_type in (SalesType.DONATE, SalesType.BORROW):
            if price is not None:
                # Auto-clear price when sales_type changes to donate/borrow
                if sales_type_changing:
                    attrs["price"] = None
                # Only raise error if explicitly setting price on donate/borrow
                elif "price" in attrs:
                    raise serializers.ValidationError(
                        {
                            "price": _("Price must be empty for '%(type)s' items.")
                            % {"type": sales_type}
                        }
                    )

        # want_buy / want_rent: no price constraint

        # Validate status is allowed for the given sales_type
        if item_status is not None and sales_type is not None:
            allowed = ItemStatus.for_sales_type(sales_type)
            if item_status not in allowed:
                raise serializers.ValidationError(
                    {
                        "status": _(
                            "Status '%(status)s' is not valid for listing type "
                            "'%(sales_type)s'."
                        )
                        % {"status": item_status, "sales_type": sales_type}
                    }
                )

        return super().validate(attrs)


class ItemListSerializer(ItemSerializer):
    """Lightweight serializer for item lists."""

    images = None
    co_owners = None


class ItemMinimalSerializer(ItemListSerializer):
    class Meta:
        model = Item
        fields = ["id", "name", "first_image", "sales_type", "price", "price_currency"]
