from django.contrib import admin

from .models import NotificationPreference


@admin.register(NotificationPreference)
class NotificationPreferenceAdmin(admin.ModelAdmin):
    list_display = ["user", "provider_type", "event_type", "enabled", "created_at"]
    list_filter = ["provider_type", "event_type", "enabled"]
    search_fields = ["user__username", "user__email"]
    readonly_fields = ["id", "created_at"]
