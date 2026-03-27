"""API tests for the collections add-item permission behaviour.

Covers the bug where a user with the ``edit`` role on a shared collection
could not add items because ``validate_item_id`` only checked object-level
guardian grants and therefore rejected PUBLIC/AUTHENTICATED items that are
visible to all authenticated users by visibility policy rather than by an
explicit per-object grant.
"""

import pytest
from django.db import IntegrityError
from django.urls import reverse
from guardian.shortcuts import assign_perm
from rest_framework import status
from rest_framework.test import APIClient

from bubble.collections.models import Collection, CollectionItem
from bubble.items.models import Item, ItemStatus, VisibilityType
from bubble.users.tests.factories import UserFactory

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def owner(db):
    return UserFactory()


@pytest.fixture
def editor(db):
    return UserFactory()


@pytest.fixture
def viewer(db):
    return UserFactory()


@pytest.fixture
def stranger(db):
    return UserFactory()


@pytest.fixture
def collection(owner):
    """A collection owned by *owner*."""
    return Collection.objects.create(name="Shared Collection", owner=owner)


@pytest.fixture
def authenticated_item(owner):
    """An AVAILABLE item with AUTHENTICATED visibility owned by *owner*."""
    return Item.objects.create(
        name="Auth Item",
        description="visible to all logged-in users",
        user=owner,
        status=ItemStatus.AVAILABLE,
        visibility=VisibilityType.AUTHENTICATED,
    )


@pytest.fixture
def public_item(owner):
    """An AVAILABLE item with PUBLIC visibility owned by *owner*."""
    return Item.objects.create(
        name="Public Item",
        description="visible to everyone",
        user=owner,
        status=ItemStatus.AVAILABLE,
        visibility=VisibilityType.PUBLIC,
    )


@pytest.fixture
def private_item(owner):
    """An AVAILABLE item with PRIVATE visibility owned by *owner*.

    Only the owner holds an explicit guardian ``view_item`` grant (granted
    automatically via ``Item.save``).
    """
    return Item.objects.create(
        name="Private Item",
        description="visible only to owner",
        user=owner,
        status=ItemStatus.AVAILABLE,
        visibility=VisibilityType.PRIVATE,
    )


@pytest.fixture
def specific_item(owner, editor):
    """
    An AVAILABLE item with SPECIFIC visibility; *editor* has been granted view_item.
    """
    item = Item.objects.create(
        name="Specific Item",
        description="visible to specific users",
        user=owner,
        status=ItemStatus.AVAILABLE,
        visibility=VisibilityType.SPECIFIC,
    )
    assign_perm("items.view_item", editor, item)
    return item


def _grant_edit_role(user, collection):
    """Grant the 'edit' role (view_collection + add_items + remove_items)."""
    assign_perm("collections.view_collection", user, collection)
    assign_perm("collections.add_items", user, collection)
    assign_perm("collections.remove_items", user, collection)


def _grant_view_role(user, collection):
    """Grant the 'view' role (view_collection only)."""
    assign_perm("collections.view_collection", user, collection)


def _add_item_url(collection):
    return reverse("api:collection-add-item", kwargs={"pk": collection.pk})


# ---------------------------------------------------------------------------
# Tests: editor can add items based on item visibility
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestAddItemAsEditor:
    """An editor (edit role on a shared collection) should be able to add items
    that are visible to them — either by open visibility or by explicit grant."""

    def test_editor_can_add_authenticated_visibility_item(
        self, collection, editor, authenticated_item
    ):
        """
        Regression: edit-role user adding a PUBLIC/AUTHENTICATED item must succeed.
        """
        _grant_edit_role(editor, collection)
        client = APIClient()
        client.force_authenticate(editor)

        response = client.post(
            _add_item_url(collection),
            {"item_id": str(authenticated_item.pk)},
            format="json",
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert CollectionItem.objects.filter(
            collection=collection, item=authenticated_item
        ).exists()

    def test_editor_can_add_public_visibility_item(
        self, collection, editor, public_item
    ):
        """Edit-role user can add an item with PUBLIC visibility."""
        _grant_edit_role(editor, collection)
        client = APIClient()
        client.force_authenticate(editor)

        response = client.post(
            _add_item_url(collection),
            {"item_id": str(public_item.pk)},
            format="json",
        )

        assert response.status_code == status.HTTP_201_CREATED
        assert CollectionItem.objects.filter(
            collection=collection, item=public_item
        ).exists()

    def test_editor_can_add_specific_item_with_explicit_grant(
        self, collection, editor, specific_item
    ):
        """
        Edit-role user can add a SPECIFIC-visibility item when they hold view_item.
        """
        _grant_edit_role(editor, collection)
        client = APIClient()
        client.force_authenticate(editor)

        response = client.post(
            _add_item_url(collection),
            {"item_id": str(specific_item.pk)},
            format="json",
        )

        assert response.status_code == status.HTTP_201_CREATED

    def test_editor_cannot_add_private_item_without_grant(
        self, collection, editor, private_item
    ):
        """Edit-role user cannot add a PRIVATE item they have no explicit access to."""
        _grant_edit_role(editor, collection)
        client = APIClient()
        client.force_authenticate(editor)

        response = client.post(
            _add_item_url(collection),
            {"item_id": str(private_item.pk)},
            format="json",
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "item_id" in response.data

    def test_editor_can_add_private_item_when_granted_view(
        self, collection, editor, private_item
    ):
        """
        Edit-role user can add a PRIVATE item if they hold an explicit view_item grant.
        """
        _grant_edit_role(editor, collection)
        assign_perm("items.view_item", editor, private_item)
        client = APIClient()
        client.force_authenticate(editor)

        response = client.post(
            _add_item_url(collection),
            {"item_id": str(private_item.pk)},
            format="json",
        )

        assert response.status_code == status.HTTP_201_CREATED


# ---------------------------------------------------------------------------
# Tests: view-only role cannot add items
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestAddItemAsViewer:
    """
    A user with only the 'view' role on a collection must not be allowed to add items.
    """

    def test_viewer_cannot_add_item(self, collection, viewer, authenticated_item):
        """
        View-only user is rejected at the object-permission layer (add_items missing).
        """
        _grant_view_role(viewer, collection)
        client = APIClient()
        client.force_authenticate(viewer)

        response = client.post(
            _add_item_url(collection),
            {"item_id": str(authenticated_item.pk)},
            format="json",
        )

        assert response.status_code == status.HTTP_403_FORBIDDEN
        assert not CollectionItem.objects.filter(
            collection=collection, item=authenticated_item
        ).exists()


# ---------------------------------------------------------------------------
# Tests: unauthenticated / no access
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestAddItemAccessControl:
    """Basic access-control sanity checks for the add-item endpoint."""

    def test_unauthenticated_user_cannot_add_item(self, collection, authenticated_item):
        client = APIClient()

        response = client.post(
            _add_item_url(collection),
            {"item_id": str(authenticated_item.pk)},
            format="json",
        )

        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_stranger_without_collection_access_cannot_add_item(
        self, collection, stranger, authenticated_item
    ):
        """A fully-authenticated user with no collection grant at all gets a 404
        because the collection is not in their queryset."""
        client = APIClient()
        client.force_authenticate(stranger)

        response = client.post(
            _add_item_url(collection),
            {"item_id": str(authenticated_item.pk)},
            format="json",
        )

        assert response.status_code == status.HTTP_404_NOT_FOUND

    def test_owner_can_add_authenticated_item(
        self, collection, owner, authenticated_item
    ):
        """Sanity check: the owner can always add an AUTHENTICATED-visibility item."""
        client = APIClient()
        client.force_authenticate(owner)

        response = client.post(
            _add_item_url(collection),
            {"item_id": str(authenticated_item.pk)},
            format="json",
        )

        assert response.status_code == status.HTTP_201_CREATED

    def test_duplicate_item_returns_400(self, collection, owner, authenticated_item):
        """Adding the same item twice returns 400 with a meaningful error."""
        CollectionItem.objects.create(
            collection=collection, item=authenticated_item, added_by=owner
        )
        client = APIClient()
        client.force_authenticate(owner)

        response = client.post(
            _add_item_url(collection),
            {"item_id": str(authenticated_item.pk)},
            format="json",
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST


# ---------------------------------------------------------------------------
# Tests: duplicate-item constraint
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestDuplicateItemConstraint:
    """The unique_item_per_collection constraint must be enforced at both the
    serializer level (clean 400 with an ``item_id`` field error) and the DB
    level (UniqueConstraint), and must not prevent the same item from being
    added to *different* collections."""

    def test_adding_duplicate_returns_400_with_field_error(
        self, collection, owner, authenticated_item
    ):
        """Second attempt to add the same item yields a 400 whose body contains
        an ``item_id`` key so the frontend can surface the message next to the field."""
        CollectionItem.objects.create(
            collection=collection, item=authenticated_item, added_by=owner
        )
        client = APIClient()
        client.force_authenticate(owner)

        response = client.post(
            _add_item_url(collection),
            {"item_id": str(authenticated_item.pk)},
            format="json",
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        # Error is reported as a field-level validation error on item_id
        assert "item_id" in response.data
        # Exactly one row should exist — no duplicate was created
        assert (
            CollectionItem.objects.filter(
                collection=collection, item=authenticated_item
            ).count()
            == 1
        )

    def test_adding_duplicate_as_editor_returns_400(
        self, collection, editor, authenticated_item
    ):
        """Duplicate check applies to editors too, not only the owner."""
        _grant_edit_role(editor, collection)
        CollectionItem.objects.create(
            collection=collection, item=authenticated_item, added_by=editor
        )
        client = APIClient()
        client.force_authenticate(editor)

        response = client.post(
            _add_item_url(collection),
            {"item_id": str(authenticated_item.pk)},
            format="json",
        )

        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "item_id" in response.data

    def test_same_item_can_be_in_multiple_collections(self, owner, authenticated_item):
        """The constraint is scoped to a single collection; the same item may
        appear in other collections."""
        collection_a = Collection.objects.create(name="Collection A", owner=owner)
        collection_b = Collection.objects.create(name="Collection B", owner=owner)

        client = APIClient()
        client.force_authenticate(owner)

        resp_a = client.post(
            _add_item_url(collection_a),
            {"item_id": str(authenticated_item.pk)},
            format="json",
        )
        resp_b = client.post(
            _add_item_url(collection_b),
            {"item_id": str(authenticated_item.pk)},
            format="json",
        )

        assert resp_a.status_code == status.HTTP_201_CREATED
        assert resp_b.status_code == status.HTTP_201_CREATED

    def test_db_constraint_enforced_on_direct_create(
        self, collection, owner, authenticated_item
    ):
        """The UniqueConstraint is enforced at the DB level even when bypassing
        the serializer (e.g. direct ORM usage)."""

        CollectionItem.objects.create(
            collection=collection, item=authenticated_item, added_by=owner
        )
        with pytest.raises(IntegrityError):
            CollectionItem.objects.create(
                collection=collection, item=authenticated_item, added_by=owner
            )
