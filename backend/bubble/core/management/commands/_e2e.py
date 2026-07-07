"""Shared helpers for the E2E seed/purge management commands.

These commands create and delete test data on the stage environment. They are
deliberately gated behind an explicit ``E2E_ALLOW`` env flag so they can never
run against production by accident (see docs/e2e-testing/plan.md §6.2).
"""

from __future__ import annotations

import os

from django.core.management.base import CommandError

# Roles in the E2E user pool. Must match e2e/support/config.ts ROLES.
ROLES = ("owner", "renterA", "renterB", "admin")

# Data created by tests is tagged with this prefix so purge can delete exactly
# what E2E created and nothing else. Must match e2e/support/namespace.ts.
NAMESPACE_PREFIX = "E2E-"

_TRUTHY = {"1", "true", "yes", "on"}


def require_e2e_allowed() -> None:
    """Abort unless E2E_ALLOW is explicitly set truthy."""
    if os.environ.get("E2E_ALLOW", "").strip().lower() not in _TRUTHY:
        msg = (
            "Refusing to run: set E2E_ALLOW=1 to confirm this targets an E2E "
            "environment (never production)."
        )
        raise CommandError(msg)


def role_credentials(role: str) -> dict[str, str] | None:
    """Read a pooled role's username/password/email from env, or None if unset.

    Uses the same env convention as the Playwright side:
      E2E_<ROLE>_USERNAME / E2E_<ROLE>_PASSWORD / E2E_<ROLE>_EMAIL (optional)
    """
    key = role.upper()
    username = os.environ.get(f"E2E_{key}_USERNAME", "").strip()
    password = os.environ.get(f"E2E_{key}_PASSWORD", "").strip()
    if not username or not password:
        return None
    email = os.environ.get(f"E2E_{key}_EMAIL", "").strip() or f"{username}@e2e.local"
    return {"username": username, "password": password, "email": email}
