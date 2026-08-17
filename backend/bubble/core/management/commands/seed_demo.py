"""Seed a realistic demo dataset for local development, screenshots and as a
content baseline for Playwright E2E runs.

Creates a small cast of users, a spread of items across every category and
sales type (rent/borrow/sell/donate/want_*), generated placeholder photos,
a couple of collections, and a few bookings with message threads — enough
for every page in the app to have something real to show.

Idempotent: safe to run repeatedly. Items/collections are matched by their
fixed name, so re-running updates nothing but also creates nothing extra;
use ``--flush`` to wipe previously seeded demo data first.

Safety: refuses to run unless ``settings.DEBUG`` is true (the default for
local/dev settings) or ``SEED_DEMO_ALLOW=1`` is set explicitly — the same
guard style as ``seed_e2e``/``purge_e2e``, so it can never touch a real
production database by accident. A public demo deployment (DEBUG=False) sets
SEED_DEMO_ALLOW=1 deliberately.

Usage:
    python manage.py seed_demo
    python manage.py seed_demo --flush          # wipe previously seeded demo data first
    python manage.py seed_demo --no-images       # skip generating placeholder photos
    DEMO_USERNAME=demo DEMO_PASSWORD=demodemo python manage.py seed_demo
"""

from __future__ import annotations

import io
import os
import random
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone
from djmoney.money import Money
from PIL import Image as PILImage
from PIL import ImageDraw, ImageFont

from bubble.bookings.models import Booking, BookingStatus, Message
from bubble.collections.models import Collection
from bubble.items.models import Image, Item, ItemStatus

User = get_user_model()

_TRUTHY = {"1", "true", "yes", "on"}

# Soft, muted card colors — cycled per item/image so the placeholder grid still
# reads as a real catalogue rather than a wall of identical gray boxes.
PALETTE = [
    (86, 130, 89),
    (168, 124, 84),
    (100, 120, 160),
    (150, 100, 130),
    (120, 140, 90),
    (180, 150, 90),
    (90, 140, 140),
    (140, 110, 90),
]

FONT_CANDIDATES = (
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
)

# (owner key, name, category, sales_type, price, rental_period, description)
ITEMS = [
    (
        "anna",
        "Bosch cordless drill",
        "tools",
        "rent",
        4,
        "d",
        "Bosch GSR 18V cordless drill with two batteries, charger and bit set. "
        "Great for furniture assembly and light drilling around the house. "
        "Please return charged.",
    ),
    (
        "anna",
        "Ladder 4m telescopic",
        "tools",
        "borrow",
        None,
        "d",
        "Telescopic aluminium ladder, extends to 4 m. Handy for changing bulbs, "
        "painting or cleaning gutters. Heavy — bring a friend.",
    ),
    (
        "ben",
        "Party tent 3x6m",
        "garden",
        "rent",
        15,
        "d",
        "White party tent for garden parties, fits about 30 people. Comes packed "
        "in two bags with all poles and pegs. Setup takes 30 minutes with two "
        "people.",
    ),
    (
        "ben",
        "Raclette grill (8 people)",
        "kitchen",
        "borrow",
        None,
        "d",
        "Classic raclette grill with 8 pans, perfect for a cozy dinner. "
        "Non-stick coating in good shape.",
    ),
    (
        "demo",
        'Mountain bike 29" Cube',
        "sports",
        "rent",
        12,
        "d",
        "Cube Attention mountain bike, 29 inch wheels, frame size L. Recently "
        "serviced, new brake pads. Helmet available on request.",
    ),
    (
        "anna",
        "Kids balance bike",
        "toys",
        "donate",
        None,
        "d",
        "Wooden balance bike our kids outgrew. Some scratches but rolls fine. "
        "Free to a good home.",
    ),
    (
        "ben",
        "Beamer Epson Full-HD",
        "electronics",
        "rent",
        8,
        "d",
        "Epson EH-TW650 projector, Full HD, HDMI. Great for movie nights or "
        "presentations. Includes HDMI cable and carrying bag.",
    ),
    (
        "demo",
        "Fondue set",
        "kitchen",
        "borrow",
        None,
        "d",
        "Cast-iron fondue set with 6 forks and burner. Cheese or meat — your choice.",
    ),
    (
        "anna",
        "Sewing machine Singer",
        "other",
        "borrow",
        None,
        "d",
        "Singer Tradition sewing machine. Works well for hemming and simple "
        "repairs. Manual included.",
    ),
    (
        "ben",
        "Camping stove + gas",
        "sports",
        "borrow",
        None,
        "d",
        "Two-flame camping stove with a half-full gas cartridge. Please replace "
        "the cartridge if you empty it.",
    ),
    (
        "demo",
        "IKEA Poäng armchair",
        "furniture",
        "sell",
        25,
        None,
        "Birch veneer Poäng with beige cushion. A few marks on the armrests, "
        "otherwise solid. Pickup only, 2nd floor.",
    ),
    (
        "anna",
        "The Lord of the Rings trilogy",
        "books",
        "borrow",
        None,
        "w",
        "Beautiful hardcover box set. Please handle with care and return within "
        "a few weeks.",
    ),
    (
        "ben",
        "Pressure washer Kärcher K5",
        "tools",
        "rent",
        7,
        "d",
        "Kärcher K5 pressure washer with patio cleaner attachment. Terrace, "
        "bikes, garden furniture — makes everything new.",
    ),
    (
        "demo",
        "Board game collection box",
        "toys",
        "borrow",
        None,
        "w",
        "A box with Catan, Carcassonne, Codenames and a few card games. Great "
        "for game nights.",
    ),
    (
        "anna",
        "Winter tires 205/55 R16",
        "vehicles",
        "sell",
        120,
        None,
        "Set of 4 Continental winter tires on steel rims, 5 mm tread left. Fits "
        "VW Golf 7 among others.",
    ),
    (
        "ben",
        "Guest room / air mattress",
        "rooms",
        "want_rent",
        None,
        None,
        "Looking for a guest room or a place to borrow an air mattress for "
        "visiting family, first weekend of next month.",
    ),
]

# (owner key, name, description, item names to include)
COLLECTIONS = [
    (
        "demo",
        "Garden & Outdoor",
        "Everything for garden projects and outdoor fun.",
        {"garden", "tools", "sports"},  # matched by category
    ),
    (
        "anna",
        "Party equipment",
        "Tents, grills, beamers — for the next community party.",
        {
            "Party tent 3x6m",
            "Beamer Epson Full-HD",
            "Raclette grill (8 people)",
            "Fondue set",
        },
    ),
]

# (item name, booker key, status, start_days_from_now, duration_days, offer, messages)
# messages: list of (sender key, text)
BOOKINGS = [
    (
        "Bosch cordless drill",
        "demo",
        BookingStatus.PENDING,
        3,
        2,
        8,
        [
            (
                "demo",
                "Hi Anna! I'd like to borrow the drill on the weekend to "
                "build a shelf. Is Saturday morning ok for pickup?",
            ),
            (
                "anna",
                "Hi! Saturday 10am works. I'll put the bit set in the case as well.",
            ),
        ],
    ),
    (
        "Party tent 3x6m",
        "demo",
        BookingStatus.CONFIRMED,
        10,
        3,
        45,
        [
            ("demo", "Thanks for confirming! We'll pick it up Friday afternoon."),
        ],
    ),
    (
        'Mountain bike 29" Cube',
        "anna",
        BookingStatus.PENDING,
        5,
        1,
        12,
        [
            (
                "anna",
                "Hello! Is the bike available on Thursday? I'd like to do "
                "a tour along the river.",
            ),
        ],
    ),
]


def _truthy(value: str) -> bool:
    return value.strip().lower() in _TRUTHY


def require_demo_seeding_allowed() -> None:
    """Abort unless this is a debug/dev database or SEED_DEMO_ALLOW=1 is set."""
    if settings.DEBUG:
        return
    if _truthy(os.environ.get("SEED_DEMO_ALLOW", "")):
        return
    msg = (
        "Refusing to run: DEBUG is off and SEED_DEMO_ALLOW is not set. This "
        "command creates visible demo accounts/listings and must not run "
        "against production by accident. Set SEED_DEMO_ALLOW=1 to confirm "
        "this targets a demo/dev environment."
    )
    raise CommandError(msg)


class Command(BaseCommand):
    help = "Seed a realistic demo dataset (users, items, bookings, collections)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--flush",
            action="store_true",
            help="Delete previously seeded demo items/collections before reseeding.",
        )
        parser.add_argument(
            "--no-images",
            action="store_true",
            help="Skip generating placeholder photos (faster).",
        )
        parser.add_argument(
            "--seed",
            type=int,
            default=42,
            help="RNG seed for placeholder image color selection (default: 42).",
        )
        parser.add_argument(
            "--username",
            default=os.environ.get("DEMO_USERNAME", "demo"),
            help="Primary demo user's username (env DEMO_USERNAME, default: demo).",
        )
        parser.add_argument(
            "--password",
            default=os.environ.get("DEMO_PASSWORD", "demodemo"),
            help="Primary demo user's password (env DEMO_PASSWORD, default: demodemo).",
        )
        parser.add_argument(
            "--email",
            default=os.environ.get("DEMO_EMAIL", "demo@example.com"),
            help="Primary demo user's email (env DEMO_EMAIL).",
        )
        parser.add_argument(
            "--no-superuser",
            action="store_true",
            help="Don't grant the primary demo user staff/superuser access.",
        )

    def handle(self, *args, **options):
        require_demo_seeding_allowed()
        random.seed(options["seed"])

        with transaction.atomic():
            users = self._seed_users(options)
            if options["flush"]:
                self._flush(users)
            items = self._seed_items(users, generate_images=not options["no_images"])
            self._seed_collections(users, items)
            self._seed_bookings(users, items)

        owners = users.values()
        item_count = Item.objects.filter(user__in=owners).count()
        booking_count = Booking.objects.filter(item__user__in=owners).count()
        self.stdout.write(
            self.style.SUCCESS(
                f"Demo data ready: {item_count} item(s), {booking_count} booking(s) "
                f"across {len(users)} user(s).",
            ),
        )

    # -- users ---------------------------------------------------------------

    def _seed_users(self, options) -> dict[str, User]:
        users: dict[str, User] = {}

        demo, created = User.objects.get_or_create(
            username=options["username"],
            defaults={"email": options["email"], "name": "Demo User"},
        )
        demo.email = options["email"]
        demo.set_password(options["password"])
        if not options["no_superuser"]:
            demo.is_staff = True
            demo.is_superuser = True
        demo.is_active = True
        demo.save()
        users["demo"] = demo
        verb = "created" if created else "updated"
        self.stdout.write(f"  - user '{demo.username}': {verb}")

        for key, name, password in (
            ("anna", "Anna Huber", "demodemo"),
            ("ben", "Ben Maier", "demodemo"),
        ):
            user, created = User.objects.get_or_create(
                username=key,
                defaults={"email": f"{key}@example.com", "name": name},
            )
            user.set_password(password)
            user.is_active = True
            user.save()
            users[key] = user
            verb = "created" if created else "updated"
            self.stdout.write(f"  - user '{key}': {verb}")

        return users

    # -- flush -----------------------------------------------------------

    def _flush(self, users: dict[str, User]) -> None:
        owners = list(users.values())
        item_count, _ = Item.objects.filter(user__in=owners).delete()
        coll_count, _ = Collection.objects.filter(owner__in=owners).delete()
        self.stdout.write(
            f"  - flushed {item_count} item-related row(s), {coll_count} "
            f"collection-related row(s)",
        )

    # -- items -----------------------------------------------------------

    def _seed_items(
        self,
        users: dict[str, User],
        *,
        generate_images: bool,
    ) -> dict[str, Item]:
        items: dict[str, Item] = {}
        for i, entry in enumerate(ITEMS):
            owner_key, name, category, sales_type, price, period, desc = entry
            # Scoped by (user, name), not name alone: Item.name isn't unique,
            # so a name-only lookup could match an unrelated item owned by
            # someone else on a dev DB that already has data.
            item, created = Item.objects.get_or_create(
                name=name,
                user=users[owner_key],
                defaults={
                    "category": category,
                    "sales_type": sales_type,
                    "status": ItemStatus.AVAILABLE,
                    "description": desc,
                    "rental_period": period or "d",
                },
            )
            if created and price is not None:
                item.price = Money(price, settings.DEFAULT_CURRENCY)
                item.save()
            if created and generate_images:
                # Cosmetic variety only — not security-sensitive.
                n_images = (
                    1 if sales_type.startswith("want") else random.choice([1, 2, 3])  # noqa: S311
                )
                for j in range(n_images):
                    image = Image(item=item, ordering=j)
                    image.original.save(
                        f"{item.slug}-{j}.jpg",
                        self._placeholder_photo(name, PALETTE[(i + j) % len(PALETTE)]),
                        save=False,
                    )
                    image.save()
            items[name] = item
            verb = "created" if created else "exists"
            self.stdout.write(f"  - item '{name}': {verb}")
        return items

    def _placeholder_photo(self, text: str, color: tuple[int, int, int]) -> ContentFile:
        size = (1000, 700)
        img = PILImage.new("RGB", size, color)
        draw = ImageDraw.Draw(img)
        stripe = tuple(min(c + 14, 255) for c in color)
        for x in range(-size[1], size[0], 90):
            draw.line([(x, size[1]), (x + size[1], 0)], fill=stripe, width=28)

        font = None
        for path in FONT_CANDIDATES:
            try:
                font = ImageFont.truetype(path, 64)
                break
            except OSError:
                continue
        font = font or ImageFont.load_default()

        bbox = draw.textbbox((0, 0), text, font=font)
        position = ((size[0] - bbox[2]) / 2, (size[1] - bbox[3]) / 2)
        draw.text(position, text, fill=(255, 255, 255), font=font)

        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=85)
        filename = f"{text[:20].replace(' ', '_').lower()}.jpg"
        return ContentFile(buf.getvalue(), name=filename)

    # -- collections -------------------------------------------------------

    def _seed_collections(self, users: dict[str, User], items: dict[str, Item]) -> None:
        for owner_key, name, description, match in COLLECTIONS:
            # Scoped by (owner, name): Collection.name isn't unique either.
            collection, created = Collection.objects.get_or_create(
                name=name,
                owner=users[owner_key],
                defaults={"description": description},
            )
            for item_name, item in items.items():
                if item_name in match or item.category in match:
                    collection.items.add(item)
            self.stdout.write(
                f"  - collection '{name}': {'created' if created else 'exists'}",
            )

    # -- bookings ------------------------------------------------------------

    def _seed_bookings(self, users: dict[str, User], items: dict[str, Item]) -> None:
        now = timezone.now()
        for item_name, booker, status, start, dur, offer, msgs in BOOKINGS:
            item = items[item_name]
            offer_money = None
            if offer is not None:
                offer_money = Money(offer, settings.DEFAULT_CURRENCY)
            booking, created = Booking.objects.get_or_create(
                item=item,
                user=users[booker],
                defaults={
                    "status": status,
                    "time_from": now + timedelta(days=start),
                    "time_to": now + timedelta(days=start + dur),
                    "offer": offer_money,
                },
            )
            if created:
                if status == BookingStatus.CONFIRMED:
                    booking.accepted_by = item.user
                    booking.save()
                for sender_key, text in msgs:
                    Message.objects.create(
                        booking=booking,
                        sender=users[sender_key],
                        message=text,
                    )
            verb = "created" if created else "exists"
            self.stdout.write(f"  - booking '{item_name}' <- {booker}: {verb}")
