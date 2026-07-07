import pytest
from allauth.account.models import EmailAddress
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError

from bubble.bookings.tests.factories import ItemFactory
from bubble.core.management.commands._e2e import require_e2e_allowed
from bubble.items.models import Item

User = get_user_model()


class TestE2EGuard:
    """The E2E_ALLOW gate that keeps these commands off production (DB-free)."""

    def test_refuses_without_flag(self, monkeypatch):
        monkeypatch.delenv("E2E_ALLOW", raising=False)
        with pytest.raises(CommandError):
            require_e2e_allowed()

    def test_allows_with_flag(self, monkeypatch):
        monkeypatch.setenv("E2E_ALLOW", "1")
        require_e2e_allowed()  # does not raise

    def test_rejects_non_truthy(self, monkeypatch):
        monkeypatch.setenv("E2E_ALLOW", "maybe")
        with pytest.raises(CommandError):
            require_e2e_allowed()


@pytest.mark.django_db
class TestSeedE2E:
    def test_creates_pool_user_with_verified_email(self, monkeypatch):
        monkeypatch.setenv("E2E_ALLOW", "1")
        monkeypatch.setenv("E2E_OWNER_USERNAME", "e2e-owner")
        monkeypatch.setenv("E2E_OWNER_PASSWORD", "s3cret-pw")

        call_command("seed_e2e")

        user = User.objects.get(username="e2e-owner")
        assert user.is_active
        assert user.check_password("s3cret-pw")
        assert user.groups.filter(name="Default").exists()
        assert EmailAddress.objects.filter(user=user, verified=True).exists()

    def test_is_idempotent(self, monkeypatch):
        monkeypatch.setenv("E2E_ALLOW", "1")
        monkeypatch.setenv("E2E_OWNER_USERNAME", "e2e-owner")
        monkeypatch.setenv("E2E_OWNER_PASSWORD", "pw")

        call_command("seed_e2e")
        call_command("seed_e2e")

        assert User.objects.filter(username="e2e-owner").count() == 1


@pytest.mark.django_db
class TestPurgeE2E:
    def test_deletes_only_namespaced_items(self, monkeypatch):
        monkeypatch.setenv("E2E_ALLOW", "1")
        keep = ItemFactory(name="Real listing")
        drop = ItemFactory(name="E2E-run1::Drill")

        call_command("purge_e2e")

        assert Item.objects.filter(pk=keep.pk).exists()
        assert not Item.objects.filter(pk=drop.pk).exists()

    def test_dry_run_deletes_nothing(self, monkeypatch):
        monkeypatch.setenv("E2E_ALLOW", "1")
        item = ItemFactory(name="E2E-run1::Drill")

        call_command("purge_e2e", "--dry-run")

        assert Item.objects.filter(pk=item.pk).exists()
