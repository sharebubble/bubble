"""Tests for the public read-only iCalendar feeds (item + collection)."""

from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework import status

from bubble.bookings.models import Booking, BookingStatus
from bubble.caldav.models import CalendarLink
from bubble.collections.models import Collection, CollectionItem
from bubble.users.tests.factories import UserFactory

from .factories import BorrowItemFactory, RentItemFactory, SellItemFactory


class ItemFeedTests(TestCase):
    def setUp(self):
        self.owner = UserFactory()
        self.booker = UserFactory(name="Alice Example")
        self.item = RentItemFactory(user=self.owner, name="Cordless Drill")
        self.now = timezone.now()

    def _book(self, booking_status, start_offset_h, end_offset_h):
        return Booking.objects.create(
            item=self.item,
            user=self.booker,
            status=booking_status,
            time_from=self.now + timedelta(hours=start_offset_h),
            time_to=self.now + timedelta(hours=end_offset_h),
        )

    def _feed(self):
        link = CalendarLink.get_or_create_for_item(self.item)
        return self.client.get(f"/caldav/item/{link.secret}.ics")

    def test_feed_calendar_name_is_item_name(self):
        resp = self._feed()
        assert resp.status_code == status.HTTP_200_OK
        assert resp["Content-Type"].startswith("text/calendar")
        body = resp.content.decode()
        assert "X-WR-CALNAME:Cordless Drill" in body

    def test_pending_is_tentative_confirmed_is_confirmed(self):
        self._book(BookingStatus.PENDING, 1, 2)
        self._book(BookingStatus.CONFIRMED, 5, 6)
        body = self._feed().content.decode()
        assert "STATUS:TENTATIVE" in body
        assert "STATUS:CONFIRMED" in body

    def test_cancelled_bookings_excluded(self):
        self._book(BookingStatus.CANCELLED, 1, 2)
        body = self._feed().content.decode()
        assert "BEGIN:VEVENT" not in body

    def test_item_feed_event_summary_is_booker_name(self):
        # The calendar is named after the item, so each event's title is the
        # person who booked it.
        self._book(BookingStatus.CONFIRMED, 1, 2)
        body = self._feed().content.decode()
        assert "SUMMARY:Alice Example" in body

    def test_unknown_secret_404(self):
        resp = self.client.get("/caldav/item/does-not-exist.ics")
        assert resp.status_code == status.HTTP_404_NOT_FOUND

    def test_secret_is_short_but_unguessable(self):
        link = CalendarLink.get_or_create_for_item(self.item)
        min_secret_length = 16  # token_urlsafe(15) → 20 chars
        assert len(link.secret) >= min_secret_length

    def test_non_bookable_item_has_no_feed(self):
        sell = SellItemFactory(user=self.owner)
        # A link can't meaningfully be created via API, but even a forced one 404s.
        link = CalendarLink.objects.create(kind="item", item=sell, user=self.owner)
        resp = self.client.get(f"/caldav/item/{link.secret}.ics")
        assert resp.status_code == status.HTTP_404_NOT_FOUND


class CollectionFeedTests(TestCase):
    def setUp(self):
        self.owner = UserFactory()
        self.booker = UserFactory(name="Bob Borrower")
        self.collection = Collection.objects.create(
            name="Garden Shed", owner=self.owner
        )
        self.drill = RentItemFactory(user=self.owner, name="Hammer Drill")
        self.ladder = BorrowItemFactory(user=self.owner, name="Tall Ladder")
        self.forsale = SellItemFactory(user=self.owner, name="Old Bike")
        for item in (self.drill, self.ladder, self.forsale):
            CollectionItem.objects.create(
                collection=self.collection, item=item, added_by=self.owner
            )
        self.now = timezone.now()
        Booking.objects.create(
            item=self.drill,
            user=self.booker,
            status=BookingStatus.CONFIRMED,
            time_from=self.now,
            time_to=self.now + timedelta(hours=2),
        )

    def _feed(self):
        link = CalendarLink.get_or_create_for_collection(self.collection)
        return self.client.get(f"/caldav/collection/{link.secret}.ics")

    def test_event_summary_is_item_name_and_description_is_booker(self):
        body = self._feed().content.decode()
        assert "SUMMARY:Hammer Drill" in body
        assert "DESCRIPTION:Bob Borrower" in body

    def test_calendar_name_is_collection_name(self):
        body = self._feed().content.decode()
        assert "X-WR-CALNAME:Garden Shed" in body

    def test_only_bookable_items_included(self):
        # Add a booking on the non-bookable item; it must not appear.
        Booking.objects.create(
            item=self.forsale,
            user=self.booker,
            status=BookingStatus.CONFIRMED,
            time_from=self.now,
            time_to=self.now + timedelta(hours=1),
        )
        body = self._feed().content.decode()
        assert "Old Bike" not in body
