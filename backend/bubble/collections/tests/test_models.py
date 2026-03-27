"""Tests for collections app."""

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from guardian.shortcuts import assign_perm, remove_perm

from bubble.collections.models import Collection, CollectionItem
from bubble.items.models import Item

User = get_user_model()

EXPECTED_USER_COLLECTIONS_COUNT = 2


@pytest.mark.django_db
class TestCollection:
    """Test Collection model."""

    def test_create_collection(self, user):
        """Test creating a collection."""
        collection = Collection.objects.create(
            name="Test Collection", description="Test Description", owner=user
        )

        assert collection.name == "Test Collection"
        assert collection.owner == user
        assert collection.items.count() == 0

    def test_owner_gets_permissions(self, user):
        """Test that owner automatically gets all permissions."""
        collection = Collection.objects.create(name="Test Collection", owner=user)

        # Check owner has all permissions
        assert user.has_perm("collections.view_collection", collection)
        assert user.has_perm("collections.change_collection", collection)
        assert user.has_perm("collections.delete_collection", collection)
        assert user.has_perm("collections.add_items", collection)
        assert user.has_perm("collections.remove_items", collection)

    def test_add_item_to_collection(self, user, item):
        """Test adding an item to a collection."""
        collection = Collection.objects.create(name="Test Collection", owner=user)

        collection_item = CollectionItem.objects.create(
            collection=collection, item=item, added_by=user, note="Great item!"
        )

        assert collection.items.count() == 1
        assert collection_item.item == item
        assert collection_item.added_by == user

    def test_get_for_user(self, user, user2):
        """Test getting collections for a user."""
        # Create collections
        collection1 = Collection.objects.create(name="Collection 1", owner=user)
        collection2 = Collection.objects.create(name="Collection 2", owner=user2)

        # Grant view permission to user2 for collection1
        assign_perm("collections.view_collection", user2, collection1)

        # User1 should see both their own collections
        user1_collections = Collection.objects.get_for_user(user)
        assert user1_collections.count() == 1
        assert collection1 in user1_collections

        # User2 should see collection1 (granted) and collection2 (owned)
        user2_collections = Collection.objects.get_for_user(user2)
        assert user2_collections.count() == EXPECTED_USER_COLLECTIONS_COUNT
        assert collection1 in user2_collections
        assert collection2 in user2_collections


@pytest.mark.django_db
class TestCollectionPermissions:
    """Test Collection permissions."""

    def test_grant_view_permission(self, user, user2):
        """Test granting view permission to another user."""
        collection = Collection.objects.create(name="Test Collection", owner=user)

        # User2 should not have permission initially
        assert not user2.has_perm("collections.view_collection", collection)

        # Grant permission
        assign_perm("collections.view_collection", user2, collection)

        # User2 should now have permission
        assert user2.has_perm("collections.view_collection", collection)

    def test_revoke_permission(self, user, user2):
        """Test revoking permission from a user."""
        collection = Collection.objects.create(name="Test Collection", owner=user)

        # Grant and then revoke permission
        assign_perm("collections.add_items", user2, collection)
        assert user2.has_perm("collections.add_items", collection)

        remove_perm("collections.add_items", user2, collection)
        assert not user2.has_perm("collections.add_items", collection)

    def test_group_permissions(self, user, user2, group):
        """Test granting permissions to a group."""
        collection = Collection.objects.create(name="Test Collection", owner=user)

        # Add user2 to group
        user2.groups.add(group)

        # Grant permission to group
        assign_perm("collections.view_collection", group, collection)

        # User2 should have permission via group
        assert user2.has_perm("collections.view_collection", collection)


@pytest.fixture
def user(db):
    """Create a test user."""
    return User.objects.create_user(
        username="testuser",
        password="testpass123",  # noqa: S106
    )


@pytest.fixture
def user2(db):
    """Create a second test user."""
    return User.objects.create_user(
        username="testuser2",
        password="testpass123",  # noqa: S106
    )


@pytest.fixture
def item(db, user):
    """Create a test item."""
    return Item.objects.create(
        name="Test Item", description="Test Description", user=user
    )


@pytest.fixture
def group(db):
    """Create a test group."""
    return Group.objects.create(name="Test Group")
