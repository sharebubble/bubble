"""Provision the E2E user pool on a stage environment.

Creates (or updates) the dedicated E2E users with known passwords, puts them in
the right group, and marks their email verified so allauth login works even when
email verification is mandatory. Idempotent.

Usage (on the target environment):
    E2E_ALLOW=1 \\
    E2E_OWNER_USERNAME=e2e-owner   E2E_OWNER_PASSWORD=... \\
    E2E_RENTERA_USERNAME=e2e-ra    E2E_RENTERA_PASSWORD=... \\
    ...                                                       \\
    python manage.py seed_e2e
"""

from __future__ import annotations

from allauth.account.models import EmailAddress
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management.base import BaseCommand
from django.db import transaction

from bubble.core.permissions_config import DefaultGroup

from ._e2e import ROLES, require_e2e_allowed, role_credentials

User = get_user_model()


class Command(BaseCommand):
    help = "Create/update the dedicated E2E user pool (gated by E2E_ALLOW=1)."

    @transaction.atomic
    def handle(self, *args, **options):
        require_e2e_allowed()

        default_group, _ = Group.objects.get_or_create(name=DefaultGroup.DEFAULT)
        admin_group, _ = Group.objects.get_or_create(name=DefaultGroup.ADMINISTRATORS)

        configured = 0
        for role in ROLES:
            creds = role_credentials(role)
            if creds is None:
                self.stdout.write(f"  - {role}: skipped (no credentials in env)")
                continue

            is_admin = role == "admin"
            user, created = User.objects.get_or_create(
                username=creds["username"],
                defaults={"email": creds["email"], "name": f"E2E {role}"},
            )
            user.email = creds["email"]
            user.name = user.name or f"E2E {role}"
            user.is_active = True
            user.is_staff = is_admin
            user.is_superuser = is_admin
            user.set_password(creds["password"])
            user.save()

            # Group membership (superuser bypasses perms anyway, but keep it tidy).
            user.groups.add(admin_group if is_admin else default_group)

            # Mark email verified so login works under mandatory verification.
            EmailAddress.objects.update_or_create(
                user=user,
                email=creds["email"],
                defaults={"verified": True, "primary": True},
            )

            configured += 1
            verb = "created" if created else "updated"
            self.stdout.write(f"  - {role}: {verb} '{creds['username']}'")

        self.stdout.write(
            self.style.SUCCESS(f"Seeded E2E user pool ({configured} configured).")
        )
