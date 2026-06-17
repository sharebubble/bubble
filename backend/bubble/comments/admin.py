from django.contrib import admin

from .models import Comment


@admin.register(Comment)
class CommentAdmin(admin.ModelAdmin):
    list_display = ("item", "user", "rating", "created_at")
    list_filter = ("rating", "created_at")
    search_fields = ("item__name", "user__username", "body")
    ordering = ("-created_at",)
    autocomplete_fields = ("item", "user")
    readonly_fields = ("created_at", "updated_at")
