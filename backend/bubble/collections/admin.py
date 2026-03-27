from django.contrib import admin
from guardian.admin import GuardedModelAdmin

from bubble.collections.models import Collection, CollectionItem


class CollectionItemInline(admin.TabularInline):
    model = CollectionItem
    extra = 1
    autocomplete_fields = ["item"]
    fields = ["item", "note", "ordering", "added_by", "added_at"]
    readonly_fields = ["added_at"]


@admin.register(Collection)
class CollectionAdmin(GuardedModelAdmin):
    list_display = ["name", "owner", "item_count", "created_at", "updated_at"]
    list_filter = ["created_at", "updated_at"]
    search_fields = ["name", "description", "owner__username"]
    autocomplete_fields = ["owner"]
    inlines = [CollectionItemInline]
    readonly_fields = ["created_at", "updated_at"]
    fieldsets = [
        (None, {"fields": ["name", "description", "owner"]}),
        ("Timestamps", {"fields": ["created_at", "updated_at"]}),
    ]

    @admin.display(description="Items")
    def item_count(self, obj):
        return obj.items.count()


@admin.register(CollectionItem)
class CollectionItemAdmin(admin.ModelAdmin):
    list_display = ["item", "collection", "added_by", "added_at", "ordering"]
    list_filter = ["added_at", "collection"]
    search_fields = ["item__name", "collection__name", "note"]
    autocomplete_fields = ["collection", "item", "added_by"]
    readonly_fields = ["added_at"]
