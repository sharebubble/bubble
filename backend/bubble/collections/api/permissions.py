"""Permissions for collections API."""

from rest_framework import permissions


class CollectionObjectPermission(permissions.BasePermission):
    """
    Object-level permission to only allow owners and users with specific
    permissions to interact with a collection.
    """

    def has_permission(self, request, view):
        """Check if user is authenticated for write operations."""
        if request.method in permissions.SAFE_METHODS:
            return True
        return request.user and request.user.is_authenticated

    def has_object_permission(self, request, view, obj):
        """Check specific object permissions using django-guardian."""
        # Read permissions
        if request.method in permissions.SAFE_METHODS:
            return request.user.has_perm("collections.view_collection", obj)

        # Write permissions
        if view.action in ["update", "partial_update"]:
            return request.user.has_perm("collections.change_collection", obj)

        if view.action == "destroy":
            return request.user.has_perm("collections.delete_collection", obj)

        if view.action in ["add_item", "bulk_add_items"]:
            return request.user.has_perm("collections.add_items", obj)

        if view.action in ["remove_item", "bulk_remove_items"]:
            return request.user.has_perm("collections.remove_items", obj)

        # Default to change permission
        return request.user.has_perm("collections.change_collection", obj)


class CanManagePermissions(permissions.BasePermission):
    """Permission to manage collection permissions (owner only)."""

    def has_object_permission(self, request, view, obj):
        """Only the owner can manage permissions."""
        return obj.owner == request.user


class CollectionItemObjectPermission(permissions.BasePermission):
    """Object-level permission for CollectionItem operations."""

    def has_object_permission(self, request, view, obj):
        """Check permissions on the parent collection."""
        collection = obj.collection
        if view.action == "destroy":
            return request.user.has_perm("collections.remove_items", collection)
        if view.action in ["update", "partial_update"]:
            return request.user.has_perm("collections.add_items", collection)
        return True
