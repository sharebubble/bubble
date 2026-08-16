"""Configuration for default groups and permissions.

This file defines the default groups and their permissions that should be
created automatically after migrations. Modify this file to change the
default permission structure.
"""

from enum import StrEnum


class DefaultGroup(StrEnum):
    """Enum for default group names."""

    DEFAULT = "Default"
    ADMINISTRATORS = "Administrators"


DEFAULT_GROUPS_CONFIG = {
    DefaultGroup.DEFAULT: {
        "description": "Default regular user, can create and view items",
        "permissions": {
            "items": {
                "item": ["add", "view", "change", "delete"],
                # need extra image permissions to update/delete images
                "image": ["add", "view", "change", "delete"],
            },
            "users": {
                "user": ["view"],
                "profile": ["view"],
            },
            "bookings": {
                "booking": ["add", "view", "change"],
                "message": ["add", "view"],
            },
            "comments": {
                "comment": ["add", "view", "change", "delete"],
            },
            "books": {
                "book": ["add", "view", "change", "delete"],
                "genre": ["add", "view", "change", "delete"],
                "author": ["add", "view", "change", "delete"],
                "publisher": ["add", "view", "change", "delete"],
                "shelf": ["add", "view", "change", "delete"],
            },
        },
    },
    DefaultGroup.ADMINISTRATORS: {
        "description": "Full access to all content and user management",
        "permissions": {
            "items": {
                "item": ["add", "change", "delete", "view"],
                "image": ["add", "change", "delete", "view"],
            },
            "users": {
                "user": ["add", "change", "delete", "view"],
                "profile": ["add", "change", "delete", "view"],
            },
        },
    },
}
