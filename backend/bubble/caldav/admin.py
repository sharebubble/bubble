from django.contrib import admin

from .models import CalDAVObject, CalendarLink


@admin.register(CalendarLink)
class CalendarLinkAdmin(admin.ModelAdmin):
    list_display = ("kind", "user", "item", "collection", "created_at", "last_used_at")
    list_filter = ("kind",)
    search_fields = ("secret", "user__username", "item__name", "collection__name")
    readonly_fields = ("secret", "created_at", "updated_at", "last_used_at")
    raw_id_fields = ("user", "item", "collection")


@admin.register(CalDAVObject)
class CalDAVObjectAdmin(admin.ModelAdmin):
    list_display = ("resource_name", "item", "booking", "created_at")
    search_fields = ("resource_name", "uid")
    raw_id_fields = ("link", "item", "booking")
