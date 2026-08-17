from rest_framework import permissions


class IsAuthorOrReadOnly(permissions.BasePermission):
    """Allow read access to anyone; write access only to the comment's author.

    The item owner may additionally delete comments left on their item to be
    able to moderate the discussion on their own listings.
    """

    def has_object_permission(self, request, view, obj):
        if request.method in permissions.SAFE_METHODS:
            return True
        if obj.user_id == request.user.id:
            return True
        # Item owners may moderate (delete) comments on their own items.
        return request.method == "DELETE" and obj.item.user_id == request.user.id
