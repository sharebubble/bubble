from django.contrib import admin
from django.utils.translation import gettext_lazy as _
from simple_history.admin import SimpleHistoryAdmin

from .models import Booking


@admin.register(Booking)
class BookingAdmin(SimpleHistoryAdmin):
    list_display = (
        "item",
        "user",
        "status",
        "time_from",
        "time_to",
        "confirmed_price",
        "created_at",
    )
    list_filter = (
        "status",
        ("item", admin.RelatedOnlyFieldListFilter),
        ("user", admin.RelatedOnlyFieldListFilter),
    )
    search_fields = ("item__name", "user__username", "user__name")
    ordering = ("-created_at",)
    list_select_related = ("item", "user")
    autocomplete_fields = ("item", "user")
    readonly_fields = ("created_at", "updated_at", "ap_id")

    @admin.display(description=_("Confirmed price"))
    def confirmed_price(self, obj):
        """The effective price agreed for this booking.

        Prefers an agreed counter-offer, then the booker's offer, then the
        computed rental total, falling back to the item's listed price.
        """
        price = obj.counter_offer or obj.offer or obj.rental_price or obj.item.price
        if price is None:
            return None
        return f"{price.amount} {price.currency}"
