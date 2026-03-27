from django import forms
from django.contrib import admin
from django.utils.translation import gettext_lazy as _
from guardian.admin import GuardedInlineAdminMixin, GuardedModelAdminMixin
from simple_history.admin import SimpleHistoryAdmin

from .models import Image, Item


class ImageInline(GuardedInlineAdminMixin, admin.TabularInline):
    model = Image
    extra = 1
    fields = ("original", "ordering")


@admin.register(Item)
class ItemAdmin(GuardedModelAdminMixin, SimpleHistoryAdmin):
    list_display = (
        "name",
        "slug",
        "user",
        "category",
        "condition",
        "status",
        "sales_type",
        "price",
        "created_at",
    )
    list_filter = ("condition", "category", "created_at")
    search_fields = ("name", "description", "user__username", "category__name")
    ordering = ("-created_at",)
    autocomplete_fields = ("user",)
    readonly_fields = ("created_at", "updated_at")
    inlines = [ImageInline]

    fieldsets = (
        (
            None,
            {
                "fields": (
                    "name",
                    "slug",
                    "description",
                    "user",
                    "category",
                    "active",
                    "status",
                    "visibility",
                ),
            },
        ),
        (
            _("Item Details"),
            {
                "fields": (
                    "condition",
                    "sales_type",
                    "price",
                    "display_contact",
                ),
            },
        ),
        (
            _("Rental Options"),
            {
                "fields": (
                    "rental_period",
                    "rental_self_service",
                    "rental_open_end",
                ),
            },
        ),
        (
            _("Additional Data"),
            {
                "fields": ("properties",),
            },
        ),
        (
            _("Internal Options"),
            {
                "fields": ("internal", "payment_enabled"),
                "classes": ("collapse",),
            },
        ),
        (
            _("Timestamps"),
            {
                "fields": ("created_at", "updated_at"),
                "classes": ("collapse",),
            },
        ),
    )

    def formfield_for_dbfield(self, db_field, request, **kwargs):

        if db_field.name == "properties":
            kwargs["widget"] = forms.Textarea(
                attrs={"rows": 20, "cols": 80, "class": "vLargeTextField"}
            )
        return super().formfield_for_dbfield(db_field, request, **kwargs)


@admin.register(Image)
class ImageAdmin(admin.ModelAdmin):
    list_display = ("item", "filename", "ordering")
    list_filter = ("item__category",)
    search_fields = ("item__name",)
    ordering = ("item", "ordering")
