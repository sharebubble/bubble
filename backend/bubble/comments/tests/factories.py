"""Factories for comments app tests."""

import factory
from factory.django import DjangoModelFactory

from bubble.comments.models import Comment
from bubble.items.tests.factories import ItemOwnerUserFactory


class CommentFactory(DjangoModelFactory[Comment]):
    class Meta:
        model = Comment

    user = factory.SubFactory(ItemOwnerUserFactory)
    body = factory.Faker("sentence")  # type: ignore[attr-defined]
    rating = 5
