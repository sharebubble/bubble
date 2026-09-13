"""Model-level tests for item favorites."""

import pytest
from django.db import IntegrityError

from bubble.favorites.models import FavoriteItem
from bubble.items.models import Item, ItemStatus, VisibilityType
from bubble.users.tests.factories import UserFactory


@pytest.fixture
def item(db):
    return Item.objects.create(
        name="Drill",
        description="a drill",
        user=UserFactory(),
        status=ItemStatus.AVAILABLE,
        visibility=VisibilityType.PUBLIC,
    )


@pytest.mark.django_db
def test_a_user_cannot_favorite_the_same_item_twice(item):
    user = UserFactory()
    FavoriteItem.objects.create(user=user, item=item)

    with pytest.raises(IntegrityError):
        FavoriteItem.objects.create(user=user, item=item)


@pytest.mark.django_db
def test_two_users_can_favorite_the_same_item(item):
    users = [UserFactory(), UserFactory()]
    for user in users:
        FavoriteItem.objects.create(user=user, item=item)

    assert FavoriteItem.objects.count() == len(users)


@pytest.mark.django_db
def test_for_user_is_empty_for_anonymous_users(item):
    from django.contrib.auth.models import AnonymousUser

    FavoriteItem.objects.create(user=UserFactory(), item=item)

    assert not FavoriteItem.objects.for_user(AnonymousUser()).exists()
