"""Factories for items app tests."""

import factory
from django.contrib.auth.models import Group

from bubble.core.permissions_config import DefaultGroup
from bubble.users.tests.factories import UserFactory


class ItemOwnerUserFactory(UserFactory):
    """User factory that automatically adds users to the Default group."""

    @factory.post_generation  # type: ignore[attr-defined]
    def add_to_item_owners_group(self, create, extracted, **kwargs):
        """Add user to Default group after creation."""
        if not create:
            return

        try:
            item_owners_group = Group.objects.get(name=DefaultGroup.DEFAULT)
            self.groups.add(item_owners_group)  # type: ignore[attr-defined]
        except Group.DoesNotExist:
            # Create the group if it doesn't exist
            item_owners_group = Group.objects.create(name=DefaultGroup.DEFAULT)
            self.groups.add(item_owners_group)  # type: ignore[attr-defined]
