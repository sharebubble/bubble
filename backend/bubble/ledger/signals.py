from django.db.models.signals import post_save, pre_delete
from django.dispatch import receiver

from bubble.ledger.services import get_member_account, release_member_account
from config.settings.base import AUTH_USER_MODEL


@receiver(post_save, sender=AUTH_USER_MODEL)
def open_member_account(sender, instance, created, **kwargs):
    # raw: loaddata is replaying fixtures; ledger rows come from their own fixtures.
    if created and not kwargs.get("raw"):
        get_member_account(instance)


@receiver(pre_delete, sender=AUTH_USER_MODEL)
def release_account_of_deleted_user(sender, instance, **kwargs):
    # Raises NonZeroBalanceError, aborting the deletion, while the member
    # still owes or is owed money. The admin checks this upfront.
    release_member_account(instance)
