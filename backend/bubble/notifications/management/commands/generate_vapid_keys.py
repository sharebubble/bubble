"""Generate a VAPID keypair for browser push notifications.

Usage:
    python manage.py generate_vapid_keys

Prints the two environment variables to set. The keypair identifies this
deployment to the browsers' push services, so generating a new one invalidates
every existing subscription: browsers reject a push signed by a key that differs
from the one they subscribed with, and users have to re-enable notifications.
Generate once per environment and keep the private key with your other secrets.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand

from bubble.notifications.webpush import generate_keys, get_public_key


class Command(BaseCommand):
    help = "Generate a VAPID keypair for web push and print it as env vars."

    def add_arguments(self, parser):
        parser.add_argument(
            "--force",
            action="store_true",
            help="Generate even though keys are already configured.",
        )

    def handle(self, *args, **options):
        if get_public_key() and not options["force"]:
            self.stderr.write(
                self.style.WARNING(
                    "VAPID_PUBLIC_KEY is already configured. Replacing it "
                    "invalidates every existing push subscription and users will "
                    "have to re-enable notifications. Re-run with --force to "
                    "generate a new keypair anyway."
                )
            )
            return

        private_key, public_key = generate_keys()

        self.stdout.write("# Web push (VAPID) — add to your environment:")
        self.stdout.write(f"VAPID_PRIVATE_KEY={private_key}")
        self.stdout.write(f"VAPID_PUBLIC_KEY={public_key}")
        self.stdout.write("# Optional; defaults to mailto:$DEFAULT_FROM_EMAIL")
        self.stdout.write("# VAPID_SUBJECT=mailto:admin@example.org")
        self.stdout.write("")
        self.stdout.write(
            self.style.WARNING(
                "Keep VAPID_PRIVATE_KEY secret. Existing subscriptions stop "
                "working if the keypair changes."
            )
        )
