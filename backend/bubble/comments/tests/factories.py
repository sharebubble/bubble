"""Factories for comments app tests."""

import factory
from factory.django import DjangoModelFactory

from bubble.comments.models import Comment
from bubble.items.models import Item, SalesType
from bubble.items.tests.factories import ItemOwnerUserFactory


class ItemFactory(DjangoModelFactory[Item]):
    class Meta:
        model = Item

    user = factory.SubFactory(ItemOwnerUserFactory)
    name = factory.Faker("word")  # type: ignore[attr-defined]
    sales_type = SalesType.SELL


class CommentFactory(DjangoModelFactory[Comment]):
    class Meta:
        model = Comment

    item = factory.SubFactory(ItemFactory)
    user = factory.SubFactory(ItemOwnerUserFactory)
    body = factory.Faker("sentence")  # type: ignore[attr-defined]
    rating = 5
