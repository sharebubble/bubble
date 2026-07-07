"""Delete E2E-created test data (and optionally the E2E user pool).

Deletes only records tagged with the E2E namespace, so it is safe to run
repeatedly as a janitor. Items cascade to their bookings, messages and images.

Usage (on the target environment):
    E2E_ALLOW=1 python manage.py purge_e2e                 # all E2E items
    E2E_ALLOW=1 python manage.py purge_e2e --run-id abc123 # one run only
    E2E_ALLOW=1 python manage.py purge_e2e --dry-run
    E2E_ALLOW=1 python manage.py purge_e2e --users         # also delete pool users
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction

from bubble.bookings.models import Booking
from bubble.items.models import Item

from ._e2e import NAMESPACE_PREFIX, ROLES, require_e2e_allowed, role_credentials

User = get_user_model()


class Command(BaseCommand):
    help = "Delete E2E-namespaced test data (gated by E2E_ALLOW=1)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--run-id",
            help="Only delete data from this run (namespace 'E2E-<run-id>::').",
        )
        parser.add_argument(
            "--users",
            action="store_true",
            help="Also delete the configured E2E pool users.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report what would be deleted without deleting.",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        require_e2e_allowed()

        prefix = (
            f"{NAMESPACE_PREFIX}{options['run_id']}::"
            if options.get("run_id")
            else NAMESPACE_PREFIX
        )

        items = Item.objects.filter(name__startswith=prefix)
        bookings = Booking.objects.filter(item__in=items)
        item_count = items.count()
        booking_count = bookings.count()

        self.stdout.write(
            f"Namespace '{prefix}': {item_count} item(s), "
            f"{booking_count} booking(s) (cascade).",
        )

        user_qs = None
        if options.get("users"):
            usernames = [
                creds["username"]
                for role in ROLES
                if (creds := role_credentials(role)) is not None
            ]
            user_qs = User.objects.filter(username__in=usernames)
            self.stdout.write(f"Pool users to delete: {user_qs.count()}")

        if options.get("dry_run"):
            self.stdout.write(self.style.WARNING("Dry run — nothing deleted."))
            return

        items.delete()  # cascades bookings, messages, images
        if user_qs is not None:
            user_qs.delete()

        self.stdout.write(
            self.style.SUCCESS(
                f"Purged {item_count} item(s) and {booking_count} booking(s).",
            )
        )
