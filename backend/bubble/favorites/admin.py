from django.contrib import admin

from .models import Favorite, FavoriteItem


@admin.register(Favorite)
class FavoriteAdmin(admin.ModelAdmin):
    list_display = ["user", "title", "url", "created_at"]
    list_filter = ["created_at"]
    search_fields = ["user__username", "title", "url"]
    ordering = ["-created_at"]


@admin.register(FavoriteItem)
class FavoriteItemAdmin(admin.ModelAdmin):
    list_display = ["user", "item", "created_at"]
    list_filter = ["created_at"]
    search_fields = ["user__username", "item__name"]
    autocomplete_fields = ["user", "item"]
    ordering = ["-created_at"]
