"""Test the default permissions setup."""

from django.contrib.auth.models import Group
from django.test import TestCase

from bubble.core.signals import create_default_groups_and_permissions


class TestDefaultPermissions(TestCase):
    """Test cases for default permissions setup."""

    def test_create_default_groups_and_permissions(self):
        """Test that default groups and permissions are created correctly."""
        # Run the function
        create_default_groups_and_permissions()

        # Check that groups were created
        expected_groups = ["Default", "Administrators"]

        for group_name in expected_groups:
            group = Group.objects.get(name=group_name)
            assert group is not None
            assert group.permissions.count() > 0

        # Check specific permissions for Default
        item_owners = Group.objects.get(name="Default")
        permission_codenames = list(
            item_owners.permissions.values_list("codename", flat=True)
        )

        expected_permissions = ["add_item", "view_item", "add_image", "view_image"]
        for perm in expected_permissions:
            assert perm in permission_codenames

    def test_groups_recreated_with_clean_permissions(self):
        """Test that running the function multiple times gives clean results."""
        # Run once
        create_default_groups_and_permissions()
        item_owners = Group.objects.get(name="Default")
        initial_count = item_owners.permissions.count()

        # Run again
        create_default_groups_and_permissions()
        item_owners.refresh_from_db()
        final_count = item_owners.permissions.count()

        # Should have same permissions count (not duplicated)
        assert initial_count == final_count
