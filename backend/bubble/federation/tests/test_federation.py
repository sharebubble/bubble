"""Federation integration tests.

Covers:
- WebFinger / NodeInfo / host-meta discovery endpoints
- Instance actor and Person actor views
- Inbox view (signature bypass, allowlist, dedup, dispatch)
- AP object endpoints (item, booking, message)
- Health endpoint
- Person outbox pagination
- Serializers (item_to_ap, booking_to_ap, message_to_ap)
- Signals (item federation, user opt-out cascade, booking/message)
- Outbox helpers (publish_item_*, publish_booking_*, publish_message_*)
- Inbound task handlers (_handle_create_item, _handle_offer_booking, etc.)
"""

from __future__ import annotations

import json
import uuid
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings

from bubble.federation.models import (
    AllowlistState,
    Follow,
    InboundActivity,
    LocalActorKey,
    OutboundDelivery,
    RemoteActor,
    RemoteInstance,
    RemoteItem,
)

User = get_user_model()

# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

FEDERATION_SETTINGS = {
    "FEDERATION_ENABLED": True,
    "FEDERATION_DOMAIN": "bubble.test",
    "FEDERATION_KEY_ENCRYPTION_KEY": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
}


def _make_user(**kwargs):
    defaults = {
        "username": f"user_{uuid.uuid4().hex[:8]}",
        "email": f"{uuid.uuid4().hex[:6]}@example.com",
        "federation_enabled": True,
    }
    defaults.update(kwargs)
    return User.objects.create_user(password="pw", **defaults)


def _make_instance(domain="peer.example", state=AllowlistState.ALLOWED):
    return RemoteInstance.objects.create(
        domain=domain,
        allowlist_state=state,
        inbox_url=f"https://{domain}/federation/inbox",
    )


def _make_remote_actor(instance, username="remoteuser"):
    return RemoteActor.objects.create(
        instance=instance,
        ap_id=f"https://{instance.domain}/federation/users/{username}",
        preferred_username=username,
        name="Remote User",
        inbox_url=f"https://{instance.domain}/federation/users/{username}/inbox",
        shared_inbox_url=f"https://{instance.domain}/federation/inbox",
        public_key_pem="",
    )


def _make_item(user, **kwargs):
    from bubble.items.models import Item, SalesType

    defaults = {
        "name": "Test item",
        "sales_type": SalesType.SELL,
        "federation_visibility": "public_federated",
        "active": True,
    }
    defaults.update(kwargs)
    item = Item(user=user, **defaults)
    item.save()
    return item


# ---------------------------------------------------------------------------
# Discovery endpoints
# ---------------------------------------------------------------------------


@override_settings(**FEDERATION_SETTINGS)
class WebFingerTestCase(TestCase):
    def setUp(self):
        self.user = _make_user(username="alice")

    def test_webfinger_acct_resource(self):
        resp = self.client.get(
            "/.well-known/webfinger",
            {"resource": "acct:alice@bubble.test"},
        )
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.content)
        self.assertEqual(data["subject"], "acct:alice@bubble.test")
        self.assertIn("links", data)

    def test_webfinger_actor_uri_resource(self):
        resp = self.client.get(
            "/.well-known/webfinger",
            {"resource": "https://bubble.test/federation/users/alice"},
        )
        self.assertEqual(resp.status_code, 200)

    def test_webfinger_unknown_user_404(self):
        resp = self.client.get(
            "/.well-known/webfinger",
            {"resource": "acct:nobody@bubble.test"},
        )
        self.assertEqual(resp.status_code, 404)

    def test_webfinger_wrong_domain_404(self):
        resp = self.client.get(
            "/.well-known/webfinger",
            {"resource": "acct:alice@other.example"},
        )
        self.assertEqual(resp.status_code, 404)

    def test_webfinger_no_resource_400(self):
        resp = self.client.get("/.well-known/webfinger")
        self.assertEqual(resp.status_code, 400)

    def test_webfinger_federation_disabled_404(self):
        with self.settings(FEDERATION_ENABLED=False):
            resp = self.client.get(
                "/.well-known/webfinger",
                {"resource": "acct:alice@bubble.test"},
            )
            self.assertEqual(resp.status_code, 404)


@override_settings(**FEDERATION_SETTINGS)
class NodeInfoTestCase(TestCase):
    def test_nodeinfo_index(self):
        resp = self.client.get("/.well-known/nodeinfo")
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.content)
        self.assertIn("links", data)
        self.assertTrue(data["links"][0]["href"].endswith("/nodeinfo/2.1"))

    def test_nodeinfo_21(self):
        resp = self.client.get("/federation/nodeinfo/2.1")
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.content)
        self.assertEqual(data["version"], "2.1")
        self.assertIn("activitypub", data["protocols"])
        self.assertIn("software", data)

    def test_host_meta(self):
        resp = self.client.get("/.well-known/host-meta")
        self.assertEqual(resp.status_code, 200)
        self.assertIn(b"webfinger", resp.content)


# ---------------------------------------------------------------------------
# Actor views
# ---------------------------------------------------------------------------


@override_settings(**FEDERATION_SETTINGS)
class InstanceActorTestCase(TestCase):
    def test_instance_actor_returns_application(self):
        resp = self.client.get(
            "/federation/instance-actor",
            headers={"accept": "application/activity+json"},
        )
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.content)
        self.assertEqual(data["type"], "Application")
        self.assertIn("publicKey", data)
        self.assertIn("inbox", data)


@override_settings(**FEDERATION_SETTINGS)
class PersonActorTestCase(TestCase):
    def setUp(self):
        self.user = _make_user(username="bob")

    def test_person_actor_ap_request(self):
        resp = self.client.get(
            "/federation/users/bob", headers={"accept": "application/activity+json"}
        )
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.content)
        self.assertEqual(data["type"], "Person")
        self.assertEqual(data["preferredUsername"], "bob")
        self.assertIn("publicKey", data)
        self.assertIn("inbox", data)
        self.assertIn("outbox", data)
        self.assertIn("followers", data)
        self.assertIn("attachment", data)  # Mastodon profile metadata

    def test_person_actor_browser_redirect(self):
        resp = self.client.get("/federation/users/bob", headers={"accept": "text/html"})
        self.assertEqual(resp.status_code, 302)

    def test_person_actor_unknown_user_404(self):
        resp = self.client.get(
            "/federation/users/nobody", headers={"accept": "application/activity+json"}
        )
        self.assertEqual(resp.status_code, 404)

    def test_person_actor_federation_disabled_user_404(self):
        self.user.federation_enabled = False
        self.user.save()
        resp = self.client.get(
            "/federation/users/bob", headers={"accept": "application/activity+json"}
        )
        self.assertEqual(resp.status_code, 404)

    def test_person_actor_context_includes_toot(self):
        resp = self.client.get(
            "/federation/users/bob", headers={"accept": "application/activity+json"}
        )
        data = json.loads(resp.content)
        context = data["@context"]
        # context is a list; find the dict entry containing toot:
        toot_entry = next(
            (c for c in context if isinstance(c, dict) and "toot" in c), None
        )
        self.assertIsNotNone(toot_entry, "toot: vocab not found in @context")


# ---------------------------------------------------------------------------
# Followers / Following / Featured / Outbox
# ---------------------------------------------------------------------------


@override_settings(**FEDERATION_SETTINGS)
class PersonCollectionsTestCase(TestCase):
    def setUp(self):
        self.user = _make_user(username="carol")

    def test_followers_collection(self):
        resp = self.client.get(
            "/federation/users/carol/followers",
            headers={"accept": "application/activity+json"},
        )
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.content)
        self.assertEqual(data["type"], "OrderedCollection")

    def test_following_collection(self):
        resp = self.client.get(
            "/federation/users/carol/following",
            headers={"accept": "application/activity+json"},
        )
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.content)
        self.assertEqual(data["type"], "OrderedCollection")

    def test_featured_collection(self):
        resp = self.client.get(
            "/federation/users/carol/featured",
            headers={"accept": "application/activity+json"},
        )
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.content)
        self.assertEqual(data["type"], "OrderedCollection")

    def test_outbox_summary(self):
        resp = self.client.get(
            "/federation/users/carol/outbox",
            headers={"accept": "application/activity+json"},
        )
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.content)
        self.assertEqual(data["type"], "OrderedCollection")
        self.assertIn("first", data)

    def test_outbox_page_empty(self):
        resp = self.client.get(
            "/federation/users/carol/outbox?page=1",
            headers={"accept": "application/activity+json"},
        )
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.content)
        self.assertEqual(data["type"], "OrderedCollectionPage")
        self.assertEqual(data["orderedItems"], [])

    def test_outbox_page_with_items(self):
        _make_item(self.user)
        _make_item(self.user)
        resp = self.client.get(
            "/federation/users/carol/outbox?page=1",
            headers={"accept": "application/activity+json"},
        )
        data = json.loads(resp.content)
        self.assertEqual(len(data["orderedItems"]), 2)
        self.assertEqual(data["orderedItems"][0]["type"], "Create")

    def test_outbox_pagination_next_link(self):
        # Create 3 items, fetch page_size=2
        for _ in range(3):
            _make_item(self.user)
        resp = self.client.get(
            "/federation/users/carol/outbox?page=1&page_size=2",
            headers={"accept": "application/activity+json"},
        )
        data = json.loads(resp.content)
        self.assertIn("next", data)
        self.assertEqual(len(data["orderedItems"]), 2)


# ---------------------------------------------------------------------------
# Health endpoint
# ---------------------------------------------------------------------------


@override_settings(**FEDERATION_SETTINGS)
class HealthEndpointTestCase(TestCase):
    def test_health_returns_200(self):
        resp = self.client.get("/federation/health")
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.content)
        self.assertTrue(data["federation_enabled"])
        self.assertIn("outbound", data)
        self.assertIn("inbound", data)
        self.assertIn("instances", data)

    def test_health_counts_allowed_instances(self):
        _make_instance("allowed.example", AllowlistState.ALLOWED)
        _make_instance("blocked.example", AllowlistState.BLOCKED)
        resp = self.client.get("/federation/health")
        data = json.loads(resp.content)
        self.assertGreaterEqual(data["instances"]["allowed"], 1)
        self.assertGreaterEqual(data["instances"]["blocked"], 1)

    def test_health_disabled_returns_404(self):
        with self.settings(FEDERATION_ENABLED=False):
            resp = self.client.get("/federation/health")
            self.assertEqual(resp.status_code, 404)


# ---------------------------------------------------------------------------
# AP object endpoints
# ---------------------------------------------------------------------------


@override_settings(**FEDERATION_SETTINGS)
class ItemAPObjectTestCase(TestCase):
    def setUp(self):
        self.user = _make_user(username="dave")
        self.item = _make_item(self.user, federation_visibility="public_federated")

    def test_item_ap_object_returns_200(self):
        resp = self.client.get(
            f"/federation/items/{self.item.pk}",
            headers={"accept": "application/activity+json"},
        )
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.content)
        self.assertIn("bubble:Item", data.get("type", ""))

    def test_local_only_item_returns_404(self):
        self.item.federation_visibility = "local_only"
        self.item.save()
        resp = self.client.get(
            f"/federation/items/{self.item.pk}",
            headers={"accept": "application/activity+json"},
        )
        self.assertEqual(resp.status_code, 404)

    def test_item_browser_redirect(self):
        resp = self.client.get(
            f"/federation/items/{self.item.pk}", headers={"accept": "text/html"}
        )
        self.assertEqual(resp.status_code, 302)

    def test_nonexistent_item_404(self):
        resp = self.client.get(
            f"/federation/items/{uuid.uuid4()}",
            headers={"accept": "application/activity+json"},
        )
        self.assertEqual(resp.status_code, 404)


# ---------------------------------------------------------------------------
# Inbox
# ---------------------------------------------------------------------------


@override_settings(**FEDERATION_SETTINGS)
class InboxTestCase(TestCase):
    def setUp(self):
        self.instance = _make_instance("sender.example", AllowlistState.ALLOWED)
        self.activity = {
            "id": "https://sender.example/activities/1",
            "type": "Create",
            "actor": "https://sender.example/federation/users/rem",
            "object": {
                "id": "https://sender.example/federation/items/abc",
                "type": "Item",
                "attributedTo": "https://sender.example/federation/users/rem",
                "name": "Remote widget",
            },
        }

    def _post(self, activity=None, path="/federation/inbox"):
        body = json.dumps(activity or self.activity).encode()
        return self.client.post(
            path,
            data=body,
            content_type="application/activity+json",
        )

    @patch("bubble.federation.views.InboxView._verify_signature", return_value=True)
    def test_valid_activity_accepted(self, _mock_sig):
        resp = self._post()
        self.assertEqual(resp.status_code, 202)
        self.assertTrue(
            InboundActivity.objects.filter(
                ap_id="https://sender.example/activities/1"
            ).exists()
        )

    @patch("bubble.federation.views.InboxView._verify_signature", return_value=True)
    def test_duplicate_activity_idempotent(self, _mock_sig):
        self._post()
        resp = self._post()
        self.assertEqual(resp.status_code, 202)
        self.assertEqual(
            InboundActivity.objects.filter(
                ap_id="https://sender.example/activities/1"
            ).count(),
            1,
        )

    def test_blocked_instance_rejected(self):
        self.instance.allowlist_state = AllowlistState.BLOCKED
        self.instance.save()
        resp = self._post()
        self.assertEqual(resp.status_code, 403)

    def test_unknown_instance_rejected(self):
        activity = dict(self.activity)
        activity["id"] = "https://unknown.example/activities/1"
        activity["actor"] = "https://unknown.example/users/x"
        resp = self._post(activity)
        self.assertEqual(resp.status_code, 403)

    def test_malformed_body_rejected(self):
        resp = self.client.post(
            "/federation/inbox",
            data=b"not json",
            content_type="application/activity+json",
        )
        self.assertEqual(resp.status_code, 400)

    def test_missing_fields_rejected(self):
        resp = self._post({"type": "Create"})
        self.assertEqual(resp.status_code, 400)

    @patch("bubble.federation.views.InboxView._verify_signature", return_value=False)
    def test_bad_signature_rejected(self, _mock_sig):
        self.instance.allowlist_state = AllowlistState.ALLOWED
        self.instance.save()
        resp = self._post()
        self.assertEqual(resp.status_code, 401)

    def test_federation_disabled_404(self):
        with self.settings(FEDERATION_ENABLED=False):
            resp = self._post()
            self.assertEqual(resp.status_code, 404)


# ---------------------------------------------------------------------------
# Serializers
# ---------------------------------------------------------------------------


@override_settings(**FEDERATION_SETTINGS)
class ItemSerializerTestCase(TestCase):
    def setUp(self):
        self.user = _make_user(username="eve")
        self.item = _make_item(self.user)

    def test_item_to_ap_shape(self):
        from bubble.federation.serializers import item_to_ap

        doc = item_to_ap(self.item)
        self.assertIn("bubble:Item", doc.get("type", ""))
        self.assertIn("id", doc)
        self.assertIn("attributedTo", doc)
        self.assertIn("name", doc)

    def test_item_to_create_activity_shape(self):
        from bubble.federation.serializers import item_to_create_activity

        act = item_to_create_activity(self.item)
        self.assertEqual(act["type"], "Create")
        self.assertIn("object", act)
        self.assertEqual(act["object"]["type"], "bubble:Item")

    def test_item_to_update_activity_shape(self):
        from bubble.federation.serializers import item_to_update_activity

        act = item_to_update_activity(self.item)
        self.assertEqual(act["type"], "Update")

    def test_item_to_delete_activity_shape(self):
        from bubble.federation.serializers import item_to_delete_activity

        act = item_to_delete_activity(self.item)
        self.assertEqual(act["type"], "Delete")


@override_settings(**FEDERATION_SETTINGS)
class BookingSerializerTestCase(TestCase):
    def setUp(self):
        self.owner = _make_user(username="frank")
        self.booker = _make_user(username="grace")
        self.item = _make_item(self.owner)
        self.instance = _make_instance("remote.example")
        self.remote_actor = _make_remote_actor(self.instance, "remgrace")

    def _make_booking(self, remote=False):
        from bubble.bookings.models import Booking, BookingStatus

        if remote:
            return Booking.objects.create(
                item=self.item,
                remote_booker_actor=self.remote_actor,
                status=BookingStatus.PENDING,
            )
        return Booking.objects.create(
            item=self.item,
            user=self.booker,
            status=BookingStatus.PENDING,
        )

    def test_booking_to_ap_shape(self):
        from bubble.federation.serializers import booking_to_ap

        booking = self._make_booking()
        doc = booking_to_ap(booking)
        self.assertIn("bubble:BookingProposal", doc.get("type", ""))
        self.assertIn("id", doc)
        self.assertIn("attributedTo", doc)

    def test_booking_offer_activity(self):
        from bubble.federation.serializers import booking_to_offer_activity

        booking = self._make_booking()
        act = booking_to_offer_activity(booking)
        self.assertEqual(act["type"], "Offer")

    def test_booking_accept_activity(self):
        from bubble.federation.serializers import booking_to_accept_activity

        booking = self._make_booking(remote=True)
        act = booking_to_accept_activity(booking)
        self.assertEqual(act["type"], "Accept")

    def test_booking_reject_activity(self):
        from bubble.federation.serializers import booking_to_reject_activity

        booking = self._make_booking(remote=True)
        act = booking_to_reject_activity(booking)
        self.assertEqual(act["type"], "Reject")

    def test_booking_cancel_activity(self):
        from bubble.federation.serializers import booking_to_cancel_activity

        booking = self._make_booking(remote=True)
        act = booking_to_cancel_activity(booking, self.remote_actor.ap_id)
        self.assertEqual(act["type"], "Undo")


@override_settings(**FEDERATION_SETTINGS)
class MessageSerializerTestCase(TestCase):
    def setUp(self):
        self.owner = _make_user(username="hank")
        self.booker = _make_user(username="iris")
        self.item = _make_item(self.owner)
        self.instance = _make_instance("msg.example")
        self.remote_actor = _make_remote_actor(self.instance, "remiris")

    def _make_booking_and_message(self):
        from bubble.bookings.models import Booking, BookingStatus, Message

        booking = Booking.objects.create(
            item=self.item,
            user=self.booker,
            status=BookingStatus.PENDING,
        )
        msg = Message.objects.create(
            booking=booking,
            sender=self.booker,
            message="Hello there",
        )
        return booking, msg

    def test_message_to_ap_shape(self):
        from bubble.federation.serializers import message_to_ap

        _, msg = self._make_booking_and_message()
        doc = message_to_ap(msg)
        self.assertEqual(doc["type"], "Note")
        self.assertIn("id", doc)
        self.assertIn("content", doc)
        self.assertIn("inReplyTo", doc)

    def test_message_create_activity(self):
        from bubble.federation.serializers import message_to_create_activity

        _, msg = self._make_booking_and_message()
        act = message_to_create_activity(msg)
        self.assertEqual(act["type"], "Create")
        self.assertEqual(act["object"]["type"], "Note")


# ---------------------------------------------------------------------------
# Outbox helpers
# ---------------------------------------------------------------------------


@override_settings(**FEDERATION_SETTINGS)
class OutboxHelpersTestCase(TestCase):
    def setUp(self):
        self.user = _make_user(username="jake")
        self.item = _make_item(self.user)
        self.instance = _make_instance("outbox.example", AllowlistState.ALLOWED)
        # Give the instance a shared inbox so deliveries are enqueued
        self.instance.inbox_url = "https://outbox.example/federation/inbox"
        self.instance.save()

    @patch("bubble.federation.tasks.deliver_activity")
    def test_publish_item_create_enqueues_delivery(self, mock_deliver):
        from bubble.federation.outbox import publish_item_create

        publish_item_create(self.item)
        self.assertTrue(OutboundDelivery.objects.exists())

    @patch("bubble.federation.tasks.deliver_activity")
    def test_publish_item_update_enqueues_delivery(self, mock_deliver):
        from bubble.federation.outbox import publish_item_update

        publish_item_update(self.item)
        self.assertTrue(OutboundDelivery.objects.exists())

    @patch("bubble.federation.tasks.deliver_activity")
    def test_publish_item_delete_enqueues_delivery(self, mock_deliver):
        from bubble.federation.outbox import publish_item_delete

        publish_item_delete(self.item)
        self.assertTrue(OutboundDelivery.objects.exists())

    @patch("bubble.federation.tasks.deliver_activity")
    def test_publish_delete_person_enqueues_delivery(self, mock_deliver):
        from bubble.federation.outbox import publish_delete_person

        publish_delete_person("jake", "https://bubble.test/federation/users/jake")
        self.assertTrue(OutboundDelivery.objects.exists())
        delivery = OutboundDelivery.objects.first()
        self.assertEqual(delivery.activity_type, "Delete")

    def test_publish_item_create_disabled_no_delivery(self):
        with self.settings(FEDERATION_ENABLED=False):
            from bubble.federation.outbox import publish_item_create

            publish_item_create(self.item)
        self.assertFalse(OutboundDelivery.objects.exists())


# ---------------------------------------------------------------------------
# Inbound task handlers
# ---------------------------------------------------------------------------


@override_settings(**FEDERATION_SETTINGS)
class InboundHandlersTestCase(TestCase):
    def setUp(self):
        self.owner = _make_user(username="kim")
        self.item = _make_item(self.owner)
        self.instance = _make_instance("inbound.example", AllowlistState.ALLOWED)
        self.remote_actor = _make_remote_actor(self.instance, "remkim")

    def _remote_item_obj(self, item_id=None):
        return {
            "id": item_id or f"https://inbound.example/federation/items/{uuid.uuid4()}",
            "type": "Item",
            "attributedTo": self.remote_actor.ap_id,
            "name": "Remote widget",
            "bubble:salesType": "sell",
        }

    @patch("bubble.federation.tasks.fetch_remote_actor")
    def test_handle_create_item_creates_remote_item(self, mock_fetch):
        from bubble.federation.tasks import _handle_create_item

        mock_fetch.return_value = self.remote_actor
        obj = self._remote_item_obj()
        _handle_create_item({"object": obj})
        self.assertTrue(RemoteItem.objects.filter(ap_id=obj["id"]).exists())

    @patch("bubble.federation.tasks.fetch_remote_actor")
    def test_handle_update_item_updates_remote_item(self, mock_fetch):
        from bubble.federation.tasks import _handle_update_item

        mock_fetch.return_value = self.remote_actor
        obj = self._remote_item_obj()
        _handle_update_item({"object": obj})
        _handle_update_item({"object": {**obj, "name": "Updated widget"}})
        ri = RemoteItem.objects.get(ap_id=obj["id"])
        self.assertEqual(ri.name, "Updated widget")

    def test_handle_delete_item_soft_deletes(self):
        from bubble.federation.tasks import _handle_delete_item

        ri = RemoteItem.objects.create(
            ap_id="https://inbound.example/federation/items/del",
            remote_actor=self.remote_actor,
            instance=self.instance,
            name="To delete",
        )
        _handle_delete_item({"object": {"id": ri.ap_id}})
        ri.refresh_from_db()
        self.assertTrue(ri.deleted)

    @patch("bubble.federation.tasks.fetch_remote_actor")
    def test_handle_offer_booking_creates_booking(self, mock_fetch):
        from bubble.federation.tasks import _handle_offer_booking

        mock_fetch.return_value = self.remote_actor
        booking_ap_id = f"https://inbound.example/federation/bookings/{uuid.uuid4()}"
        item_uri = f"https://bubble.test/federation/items/{self.item.pk}"
        _handle_offer_booking(
            {
                "actor": self.remote_actor.ap_id,
                "object": {
                    "id": booking_ap_id,
                    "type": "bubble:BookingProposal",
                    "object": item_uri,
                    "bubble:bookingStatus": "1",
                },
            }
        )
        from bubble.bookings.models import Booking

        self.assertTrue(Booking.objects.filter(ap_id=booking_ap_id).exists())

    @patch("bubble.federation.tasks.fetch_remote_actor")
    def test_handle_offer_booking_unknown_item_ignored(self, mock_fetch):
        from bubble.federation.tasks import _handle_offer_booking

        mock_fetch.return_value = self.remote_actor
        _handle_offer_booking(
            {
                "actor": self.remote_actor.ap_id,
                "object": {
                    "id": f"https://inbound.example/bookings/{uuid.uuid4()}",
                    "type": "bubble:BookingProposal",
                    "object": f"https://bubble.test/federation/items/{uuid.uuid4()}",
                },
            }
        )
        from bubble.bookings.models import Booking

        self.assertFalse(
            Booking.objects.filter(remote_booker_actor=self.remote_actor).exists()
        )

    @patch("bubble.federation.tasks.fetch_remote_actor")
    def test_handle_accept_booking(self, mock_fetch):
        from bubble.bookings.models import Booking, BookingStatus
        from bubble.federation.tasks import _handle_accept_booking

        mock_fetch.return_value = self.remote_actor
        booking = Booking.objects.create(
            item=self.item,
            remote_booker_actor=self.remote_actor,
            status=BookingStatus.PENDING,
        )
        booking_uri = f"https://bubble.test/federation/bookings/{booking.pk}"
        _handle_accept_booking({"object": booking_uri})
        booking.refresh_from_db()
        self.assertEqual(booking.status, BookingStatus.CONFIRMED)

    @patch("bubble.federation.tasks.fetch_remote_actor")
    def test_handle_reject_booking(self, mock_fetch):
        from bubble.bookings.models import Booking, BookingStatus
        from bubble.federation.tasks import _handle_reject_booking

        mock_fetch.return_value = self.remote_actor
        booking = Booking.objects.create(
            item=self.item,
            remote_booker_actor=self.remote_actor,
            status=BookingStatus.PENDING,
        )
        booking_uri = f"https://bubble.test/federation/bookings/{booking.pk}"
        _handle_reject_booking({"object": booking_uri})
        booking.refresh_from_db()
        self.assertEqual(booking.status, BookingStatus.REJECTED)

    @patch("bubble.federation.tasks.fetch_remote_actor")
    def test_handle_cancel_booking(self, mock_fetch):
        from bubble.bookings.models import Booking, BookingStatus
        from bubble.federation.tasks import _handle_cancel_booking

        mock_fetch.return_value = self.remote_actor
        booking = Booking.objects.create(
            item=self.item,
            remote_booker_actor=self.remote_actor,
            status=BookingStatus.PENDING,
        )
        booking_uri = f"https://bubble.test/federation/bookings/{booking.pk}"
        _handle_cancel_booking({"object": booking_uri})
        booking.refresh_from_db()
        self.assertEqual(booking.status, BookingStatus.CANCELLED)

    @patch("bubble.federation.tasks.fetch_remote_actor")
    def test_handle_note_message_creates_message(self, mock_fetch):
        from bubble.bookings.models import Booking, BookingStatus, Message
        from bubble.federation.tasks import _handle_note_message

        mock_fetch.return_value = self.remote_actor
        booking = Booking.objects.create(
            item=self.item,
            remote_booker_actor=self.remote_actor,
            status=BookingStatus.PENDING,
        )
        booking_uri = f"https://bubble.test/federation/bookings/{booking.pk}"
        msg_ap_id = f"https://inbound.example/messages/{uuid.uuid4()}"
        _handle_note_message(
            {
                "actor": self.remote_actor.ap_id,
                "object": {
                    "id": msg_ap_id,
                    "type": "Note",
                    "inReplyTo": booking_uri,
                    "content": "Hello from remote",
                },
            }
        )
        self.assertTrue(Message.objects.filter(ap_id=msg_ap_id).exists())


# ---------------------------------------------------------------------------
# Signals
# ---------------------------------------------------------------------------


@override_settings(**FEDERATION_SETTINGS)
class ItemFederationSignalTestCase(TestCase):
    def setUp(self):
        self.user = _make_user(username="leo")
        self.instance = _make_instance("sig.example", AllowlistState.ALLOWED)
        self.instance.inbox_url = "https://sig.example/federation/inbox"
        self.instance.save()

    @patch("bubble.federation.tasks.deliver_activity")
    def test_create_public_item_triggers_create_delivery(self, mock_deliver):
        _make_item(self.user, federation_visibility="public_federated")
        self.assertTrue(
            OutboundDelivery.objects.filter(activity_type="Create").exists()
        )

    @patch("bubble.federation.tasks.deliver_activity")
    def test_update_public_item_triggers_update_delivery(self, mock_deliver):
        item = _make_item(self.user, federation_visibility="public_federated")
        OutboundDelivery.objects.all().delete()
        item.name = "Updated name"
        item.save()
        self.assertTrue(
            OutboundDelivery.objects.filter(activity_type="Update").exists()
        )

    @patch("bubble.federation.tasks.deliver_activity")
    def test_delete_public_item_triggers_delete_delivery(self, mock_deliver):
        item = _make_item(self.user, federation_visibility="public_federated")
        OutboundDelivery.objects.all().delete()
        item.delete()
        self.assertTrue(
            OutboundDelivery.objects.filter(activity_type="Delete").exists()
        )

    @patch("bubble.federation.tasks.deliver_activity")
    def test_local_item_no_delivery(self, mock_deliver):
        _make_item(self.user, federation_visibility="local_only")
        self.assertFalse(OutboundDelivery.objects.exists())

    @patch("bubble.federation.tasks.deliver_activity")
    def test_visibility_transition_local_to_public_triggers_create(self, mock_deliver):
        item = _make_item(self.user, federation_visibility="local_only")
        OutboundDelivery.objects.all().delete()
        item.federation_visibility = "public_federated"
        item.save()
        self.assertTrue(
            OutboundDelivery.objects.filter(activity_type="Create").exists()
        )

    @patch("bubble.federation.tasks.deliver_activity")
    def test_visibility_transition_public_to_local_triggers_delete(self, mock_deliver):
        item = _make_item(self.user, federation_visibility="public_federated")
        OutboundDelivery.objects.all().delete()
        item.federation_visibility = "local_only"
        item.save()
        self.assertTrue(
            OutboundDelivery.objects.filter(activity_type="Delete").exists()
        )


@override_settings(**FEDERATION_SETTINGS)
class UserFederationOptOutTestCase(TestCase):
    def setUp(self):
        self.user = _make_user(username="mia", federation_enabled=True)
        self.instance = _make_instance("optout.example", AllowlistState.ALLOWED)
        self.instance.inbox_url = "https://optout.example/federation/inbox"
        self.instance.save()

    @patch("bubble.federation.tasks.deliver_activity")
    def test_disabling_federation_cascades_delete(self, mock_deliver):
        _make_item(self.user, federation_visibility="public_federated")
        OutboundDelivery.objects.all().delete()

        self.user.federation_enabled = False
        self.user.save()

        self.assertTrue(
            OutboundDelivery.objects.filter(activity_type="Delete").exists()
        )

    @patch("bubble.federation.tasks.deliver_activity")
    def test_disabling_federation_flips_visibility_to_local_only(self, mock_deliver):
        from bubble.items.models import Item

        _make_item(self.user, federation_visibility="public_federated")
        self.user.federation_enabled = False
        self.user.save()
        # All items should be flipped to local_only
        self.assertFalse(
            Item.objects.filter(
                user=self.user, federation_visibility="public_federated"
            ).exists()
        )

    @patch("bubble.federation.tasks.deliver_activity")
    def test_gdpr_delete_person_on_user_deletion(self, mock_deliver):
        username = self.user.username
        self.user.delete()
        self.assertTrue(
            OutboundDelivery.objects.filter(activity_type="Delete").exists()
        )
        delivery = OutboundDelivery.objects.filter(activity_type="Delete").first()
        self.assertIn(username, delivery.payload.get("object", {}).get("id", ""))


# ---------------------------------------------------------------------------
# Follow handlers
# ---------------------------------------------------------------------------


@override_settings(**FEDERATION_SETTINGS)
class FollowHandlerTestCase(TestCase):
    def test_handle_follow_creates_follow(self):
        from bubble.federation.tasks import _handle_follow

        _handle_follow(
            {
                "actor": "https://peer.example/users/x",
                "object": "https://bubble.test/federation/users/alice",
            }
        )
        self.assertTrue(
            Follow.objects.filter(
                follower_ap_id="https://peer.example/users/x",
                followee_ap_id="https://bubble.test/federation/users/alice",
                accepted=True,
            ).exists()
        )

    def test_handle_undo_follow_deletes_follow(self):
        from bubble.federation.tasks import _handle_undo_follow

        Follow.objects.create(
            follower_ap_id="https://peer.example/users/x",
            followee_ap_id="https://bubble.test/federation/users/alice",
            accepted=True,
        )
        _handle_undo_follow(
            {
                "actor": "https://peer.example/users/x",
                "object": {
                    "type": "Follow",
                    "object": "https://bubble.test/federation/users/alice",
                },
            }
        )
        self.assertFalse(
            Follow.objects.filter(
                follower_ap_id="https://peer.example/users/x"
            ).exists()
        )


# ---------------------------------------------------------------------------
# LocalActorKey auto-creation
# ---------------------------------------------------------------------------


@override_settings(**FEDERATION_SETTINGS)
class LocalActorKeySignalTestCase(TestCase):
    def test_keypair_created_for_new_user(self):
        user = _make_user(username="newactor")
        self.assertTrue(LocalActorKey.objects.filter(user=user).exists())
