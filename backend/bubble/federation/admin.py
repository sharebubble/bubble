"""Django admin for the federation app."""

from django.contrib import admin
from django.utils.translation import gettext_lazy as _

from bubble.federation.models import (
    AllowlistState,
    Follow,
    InboundActivity,
    InstanceActorKey,
    LocalActorKey,
    OutboundDelivery,
    RemoteActor,
    RemoteFavorite,
    RemoteInstance,
    RemoteItem,
)


@admin.register(RemoteInstance)
class RemoteInstanceAdmin(admin.ModelAdmin):
    list_display = [
        "domain",
        "allowlist_state",
        "software",
        "software_version",
        "first_seen",
        "last_seen",
    ]
    list_filter = ["allowlist_state", "software"]
    search_fields = ["domain", "software"]
    ordering = ["domain"]
    actions = ["allow_instances", "allow_instances_with_backfill", "block_instances"]
    readonly_fields = ["first_seen", "last_seen"]

    @admin.action(description=_("Allow selected instances"))
    def allow_instances(self, request, queryset):
        updated = queryset.update(allowlist_state=AllowlistState.ALLOWED)
        self.message_user(request, _("%d instance(s) allowed.") % updated)

    @admin.action(description=_("Allow selected instances and backfill their catalog"))
    def allow_instances_with_backfill(self, request, queryset):
        """Allow instances and enqueue a backfill task for each."""
        from bubble.federation.tasks import backfill_remote_catalog  # noqa: PLC0415

        newly_allowed = []
        for instance in queryset:
            prev_state = instance.allowlist_state
            instance.allowlist_state = AllowlistState.ALLOWED
            instance.save(update_fields=["allowlist_state"])
            if prev_state != AllowlistState.ALLOWED:
                newly_allowed.append(instance.domain)

        for domain in newly_allowed:
            backfill_remote_catalog(domain)
            self.message_user(
                request,
                _("Backfill queued for %(domain)s.") % {"domain": domain},
            )

        self.message_user(
            request,
            _("%d instance(s) allowed, %d backfill(s) queued.")
            % (queryset.count(), len(newly_allowed)),
        )

    @admin.action(description=_("Block selected instances"))
    def block_instances(self, request, queryset):
        updated = queryset.update(allowlist_state=AllowlistState.BLOCKED)
        self.message_user(request, _("%d instance(s) blocked.") % updated)


@admin.register(RemoteActor)
class RemoteActorAdmin(admin.ModelAdmin):
    list_display = [
        "preferred_username",
        "instance",
        "actor_type",
        "name",
        "deleted",
        "fetched_at",
    ]
    list_filter = ["instance", "actor_type", "deleted"]
    search_fields = ["preferred_username", "name", "ap_id"]
    readonly_fields = ["ap_id", "fetched_at"]


@admin.register(LocalActorKey)
class LocalActorKeyAdmin(admin.ModelAdmin):
    list_display = ["user", "created_at"]
    readonly_fields = ["user", "public_key_pem", "created_at"]
    # Never expose the encrypted private key in admin
    exclude = ["private_key_encrypted"]


@admin.register(InstanceActorKey)
class InstanceActorKeyAdmin(admin.ModelAdmin):
    list_display = ["id", "created_at"]
    readonly_fields = ["public_key_pem", "created_at"]
    exclude = ["private_key_encrypted"]

    def has_add_permission(self, request):
        return not InstanceActorKey.objects.exists()


@admin.register(RemoteItem)
class RemoteItemAdmin(admin.ModelAdmin):
    list_display = [
        "name",
        "instance",
        "remote_actor",
        "sales_type",
        "deleted",
        "last_updated_at",
    ]
    list_filter = ["instance", "deleted", "sales_type", "category"]
    search_fields = ["name", "description", "ap_id"]
    readonly_fields = ["ap_id", "last_updated_at", "raw_jsonld"]


@admin.register(RemoteFavorite)
class RemoteFavoriteAdmin(admin.ModelAdmin):
    list_display = ["remote_actor", "item", "created_at"]
    readonly_fields = ["created_at"]


@admin.register(Follow)
class FollowAdmin(admin.ModelAdmin):
    list_display = ["follower_ap_id", "followee_ap_id", "accepted", "created_at"]
    list_filter = ["accepted"]
    readonly_fields = ["created_at"]


@admin.register(InboundActivity)
class InboundActivityAdmin(admin.ModelAdmin):
    list_display = [
        "activity_type",
        "actor_uri",
        "status",
        "received_at",
        "processed_at",
    ]
    list_filter = ["status", "activity_type"]
    search_fields = ["ap_id", "actor_uri"]
    readonly_fields = ["ap_id", "received_at", "processed_at", "raw_jsonld", "error"]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(OutboundDelivery)
class OutboundDeliveryAdmin(admin.ModelAdmin):
    list_display = [
        "activity_type",
        "recipient_inbox",
        "status",
        "attempt",
        "next_attempt_at",
        "created_at",
    ]
    list_filter = ["status", "activity_type"]
    search_fields = ["activity_id", "recipient_inbox"]
    readonly_fields = ["id", "created_at", "updated_at", "payload"]
