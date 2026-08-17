from django.contrib import admin

from .models import NotificationPreference, PushSubscription


@admin.register(NotificationPreference)
class NotificationPreferenceAdmin(admin.ModelAdmin):
    list_display = ["user", "provider_type", "event_type", "enabled", "created_at"]
    list_filter = ["provider_type", "event_type", "enabled"]
    search_fields = ["user__username", "user__email"]
    readonly_fields = ["id", "created_at"]


@admin.register(PushSubscription)
class PushSubscriptionAdmin(admin.ModelAdmin):
    list_display = ["user", "user_agent", "created_at", "last_used_at"]
    list_filter = ["created_at", "last_used_at"]
    search_fields = ["user__username", "user__email", "endpoint"]
    # Everything here is registered by the browser, never typed by an operator;
    # deleting a row is the only useful action (it silences that device).
    readonly_fields = [
        "id",
        "user",
        "endpoint",
        "p256dh",
        "auth",
        "user_agent",
        "created_at",
        "last_used_at",
    ]

    def has_add_permission(self, request):
        return False
