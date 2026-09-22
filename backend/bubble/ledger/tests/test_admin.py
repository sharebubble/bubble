import pytest
from django.urls import reverse

from bubble.users.tests.factories import UserFactory

LEDGER_MODELS = [
    "transaction",
    "account",
    "accountbalance",
    "book",
    "category",
    "project",
    "ledgerperiod",
]


@pytest.fixture
def admin_client(client, book):
    admin = UserFactory(is_staff=True, is_superuser=True)
    client.force_login(admin)
    return client


@pytest.mark.parametrize("model", LEDGER_MODELS)
def test_changelists_render(admin_client, members, post, model):
    post((members["bob"], "10"), ("income:rental", "-10"))

    response = admin_client.get(reverse(f"admin:ledger_{model}_changelist"))

    assert response.status_code == 200  # noqa: PLR2004


def test_transactions_are_view_only(admin_client, members, post):
    tx = post((members["bob"], "10"), ("income:rental", "-10"))

    detail = admin_client.get(reverse("admin:ledger_transaction_change", args=[tx.pk]))
    add = admin_client.get(reverse("admin:ledger_transaction_add"))
    delete = admin_client.get(reverse("admin:ledger_transaction_delete", args=[tx.pk]))

    assert detail.status_code == 200  # noqa: PLR2004
    assert b'name="_save"' not in detail.content
    assert add.status_code == 403  # noqa: PLR2004
    assert delete.status_code == 403  # noqa: PLR2004


def test_user_delete_page_explains_an_unsettled_balance(admin_client, members, post):
    post((members["bob"], "10"), (members["carla"], "-10"))
    bob = members["bob"].owner

    response = admin_client.get(reverse("admin:users_user_delete", args=[bob.pk]))

    assert response.status_code == 200  # noqa: PLR2004
    assert b"must be settled first" in response.content
