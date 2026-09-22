"""Member accounts: opened with the user, released (anonymised) when they leave."""

from decimal import Decimal

import pytest
from django.contrib.admin.sites import AdminSite
from django.db import transaction
from django.test import RequestFactory

from bubble.ledger.exceptions import NonZeroBalanceError
from bubble.ledger.models import Account, AccountType, NormalSide
from bubble.ledger.services import get_member_account, verify_ledger
from bubble.ledger.tests.helpers import raw_balance
from bubble.users.admin import UserAdmin
from bubble.users.models import User
from bubble.users.tests.factories import UserFactory


def test_new_user_gets_a_member_account(book):
    user = UserFactory(name="Erin")

    account = Account.objects.get(owner=user)
    assert account.type == AccountType.MEMBER
    assert account.normal_side == NormalSide.CREDIT
    assert account.code == f"member:{user.pk}"
    assert account.name == "Erin"
    assert raw_balance(account) == 0
    assert get_member_account(user) == account


def test_get_member_account_is_idempotent(book):
    user = UserFactory()
    assert get_member_account(user) == get_member_account(user)
    assert Account.objects.filter(owner=user).count() == 1


def test_deleting_a_settled_member_keeps_the_account_anonymised(members, post):
    post((members["bob"], "10"), (members["carla"], "-10"))
    post((members["carla"], "10"), (members["bob"], "-10"))  # settled again
    bob = members["bob"].owner

    bob.delete()

    account = Account.objects.get(pk=members["bob"].pk)
    assert account.owner is None
    assert account.name.startswith("Former member #")
    assert "Bob" not in account.name
    assert not account.is_active
    # Both of his entries are still there and the books still add up.
    assert account.entries.count() == 2  # noqa: PLR2004
    assert verify_ledger().ok


def test_deleting_a_member_who_still_owes_money_is_refused(members, post):
    post((members["bob"], "10"), (members["carla"], "-10"))
    bob = members["bob"].owner

    # Django runs pre_delete inside atomic(savepoint=False); a caller that
    # wants to carry on after the refusal needs its own savepoint.
    with pytest.raises(NonZeroBalanceError, match="settle it"), transaction.atomic():
        bob.delete()

    assert User.objects.filter(pk=bob.pk).exists()
    assert Account.objects.get(pk=members["bob"].pk).owner == bob


def test_admin_lists_unsettled_members_as_protected(members, post):
    post((members["bob"], "10"), (members["carla"], "-10"))
    admin = UserAdmin(User, AdminSite())
    request = RequestFactory().get("/")
    request.user = UserFactory(is_superuser=True, is_staff=True)

    users = User.objects.filter(
        pk__in=[members["bob"].owner.pk, members["dan"].owner.pk]
    )
    *_, protected = admin.get_deleted_objects(users, request)

    assert len(protected) == 1
    assert "Bob" in str(protected[0])
    assert str(Decimal("-10.00")) in str(protected[0])
