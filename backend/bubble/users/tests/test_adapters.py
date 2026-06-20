import pytest

from bubble.users.adapters import SocialAccountAdapter
from bubble.users.models import Profile
from bubble.users.tests.factories import UserFactory

PHONE_MAX_LENGTH = Profile._meta.get_field("phone").max_length  # noqa: SLF001


@pytest.mark.django_db
def test_sync_profile_sets_phone_from_phone_number_claim() -> None:
    user = UserFactory()
    assert user.profile.phone == ""

    SocialAccountAdapter.sync_profile_from_oidc(user, {"phone_number": "+15551234567"})

    user.profile.refresh_from_db()
    assert user.profile.phone == "+15551234567"


@pytest.mark.django_db
def test_sync_profile_accepts_phone_claim_alias() -> None:
    user = UserFactory()

    SocialAccountAdapter.sync_profile_from_oidc(user, {"phone": "+436601234567"})

    user.profile.refresh_from_db()
    assert user.profile.phone == "+436601234567"


@pytest.mark.django_db
def test_sync_profile_does_not_overwrite_existing_phone() -> None:
    user = UserFactory()
    user.profile.phone = "+10000000000"
    user.profile.save()

    SocialAccountAdapter.sync_profile_from_oidc(user, {"phone_number": "+15551234567"})

    user.profile.refresh_from_db()
    assert user.profile.phone == "+10000000000"


@pytest.mark.django_db
def test_sync_profile_truncates_to_field_length() -> None:
    user = UserFactory()
    long_phone = "+" + "9" * 40

    SocialAccountAdapter.sync_profile_from_oidc(user, {"phone_number": long_phone})

    user.profile.refresh_from_db()
    assert len(user.profile.phone) == PHONE_MAX_LENGTH


@pytest.mark.django_db
def test_sync_profile_noop_without_phone_claim() -> None:
    user = UserFactory()

    SocialAccountAdapter.sync_profile_from_oidc(user, {"email": "x@example.com"})

    user.profile.refresh_from_db()
    assert user.profile.phone == ""
