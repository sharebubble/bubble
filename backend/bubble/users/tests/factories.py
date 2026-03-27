from collections.abc import Sequence
from typing import Any

import factory
from factory.django import DjangoModelFactory

from bubble.users.models import User


class UserFactory(DjangoModelFactory[User]):
    username = factory.Faker("user_name")  # type: ignore[attr-defined]
    email = factory.Faker("email")  # type: ignore[attr-defined]
    name = factory.Faker("name")  # type: ignore[attr-defined]

    @factory.post_generation  # type: ignore[misc]
    def password(
        self,
        create: bool,  # noqa: FBT001
        extracted: Sequence[Any],
        **kwargs,
    ):
        password = (
            extracted
            if extracted
            else factory.Faker(  # type: ignore[attr-defined]
                "password",
                length=42,
                special_chars=True,
                digits=True,
                upper_case=True,
                lower_case=True,
            ).evaluate(None, None, extra={"locale": None})
        )
        self.set_password(password)  # type: ignore[attr-defined]

    @classmethod
    def _after_postgeneration(cls, instance, create, results=None):
        """Save again the instance if creating and at least one hook ran."""
        if create and results and not cls._meta.skip_postgeneration_save:  # type: ignore[attr-defined]
            # Some post-generation hooks ran, and may have modified us.
            instance.save()

    class Meta:
        model = User
        django_get_or_create = ["username"]
