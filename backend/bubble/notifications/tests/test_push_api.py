"""The subscribe / unsubscribe / status / test endpoints."""

from __future__ import annotations

from unittest.mock import patch

import pytest
from django.test import override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient

from bubble.notifications import webpush
from bubble.notifications.models import PushSubscription
from bubble.users.tests.factories import UserFactory

PRIVATE_KEY, PUBLIC_KEY = webpush.generate_keys()

configured = override_settings(
    VAPID_PUBLIC_KEY=PUBLIC_KEY,
    VAPID_PRIVATE_KEY=PRIVATE_KEY,
    VAPID_SUBJECT="mailto:admin@example.org",
)

ENDPOINT = "https://push.example.com/v1/abcdef"

SUBSCRIBE_BODY = {
    "endpoint": ENDPOINT,
    "keys": {"p256dh": "client-public-key", "auth": "client-auth-secret"},
    "user_agent": "Mozilla/5.0 (Test)",
}


@pytest.fixture
def client() -> APIClient:
    return APIClient()


def _url(name: str) -> str:
    return reverse(f"api:push-subscription-{name}")


@configured
@pytest.mark.django_db
def test_subscribe_stores_the_subscription(client: APIClient) -> None:
    user = UserFactory()
    client.force_authenticate(user)

    response = client.post(_url("subscribe"), SUBSCRIBE_BODY, format="json")

    assert response.status_code == status.HTTP_201_CREATED
    assert response.data == {"configured": True, "device_count": 1}

    subscription = PushSubscription.objects.get(endpoint=ENDPOINT)
    assert subscription.user == user
    assert subscription.p256dh == "client-public-key"
    assert subscription.auth == "client-auth-secret"
    assert subscription.user_agent == "Mozilla/5.0 (Test)"


@configured
@pytest.mark.django_db
def test_subscribe_twice_refreshes_rather_than_duplicates(client: APIClient) -> None:
    user = UserFactory()
    client.force_authenticate(user)

    client.post(_url("subscribe"), SUBSCRIBE_BODY, format="json")
    rotated = {
        **SUBSCRIBE_BODY,
        "keys": {"p256dh": "rotated-key", "auth": "rotated-secret"},
    }
    response = client.post(_url("subscribe"), rotated, format="json")

    assert response.status_code == status.HTTP_201_CREATED
    assert PushSubscription.objects.filter(endpoint=ENDPOINT).count() == 1
    assert PushSubscription.objects.get(endpoint=ENDPOINT).p256dh == "rotated-key"


@configured
@pytest.mark.django_db
def test_subscribe_moves_a_shared_browser_to_the_new_user(client: APIClient) -> None:
    """A shared device that signs in as someone else must not notify the first user."""
    first = UserFactory()
    second = UserFactory()

    client.force_authenticate(first)
    client.post(_url("subscribe"), SUBSCRIBE_BODY, format="json")

    client.force_authenticate(second)
    client.post(_url("subscribe"), SUBSCRIBE_BODY, format="json")

    assert PushSubscription.objects.filter(endpoint=ENDPOINT).count() == 1
    assert PushSubscription.objects.get(endpoint=ENDPOINT).user == second


@configured
@pytest.mark.django_db
def test_subscribe_rejects_a_malformed_body(client: APIClient) -> None:
    client.force_authenticate(UserFactory())

    response = client.post(
        _url("subscribe"), {"endpoint": "not-a-url", "keys": {}}, format="json"
    )

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert not PushSubscription.objects.exists()


@override_settings(VAPID_PUBLIC_KEY="", VAPID_PRIVATE_KEY="", VAPID_SUBJECT="")
@pytest.mark.django_db
def test_subscribe_is_unavailable_without_server_keys(client: APIClient) -> None:
    client.force_authenticate(UserFactory())

    response = client.post(_url("subscribe"), SUBSCRIBE_BODY, format="json")

    assert response.status_code == status.HTTP_503_SERVICE_UNAVAILABLE
    assert not PushSubscription.objects.exists()


@configured
@pytest.mark.django_db
def test_subscribe_requires_authentication(client: APIClient) -> None:
    response = client.post(_url("subscribe"), SUBSCRIBE_BODY, format="json")

    assert response.status_code in (
        status.HTTP_401_UNAUTHORIZED,
        status.HTTP_403_FORBIDDEN,
    )
    assert not PushSubscription.objects.exists()


@configured
@pytest.mark.django_db
def test_unsubscribe_removes_only_the_callers_device(client: APIClient) -> None:
    owner = UserFactory()
    other = UserFactory()
    PushSubscription.objects.create(user=owner, endpoint=ENDPOINT, p256dh="k", auth="a")

    # Someone else cannot delete it by knowing the endpoint.
    client.force_authenticate(other)
    response = client.post(_url("unsubscribe"), {"endpoint": ENDPOINT}, format="json")
    assert response.status_code == status.HTTP_200_OK
    assert PushSubscription.objects.filter(endpoint=ENDPOINT).exists()

    client.force_authenticate(owner)
    response = client.post(_url("unsubscribe"), {"endpoint": ENDPOINT}, format="json")
    assert response.status_code == status.HTTP_200_OK
    assert not PushSubscription.objects.filter(endpoint=ENDPOINT).exists()


@configured
@pytest.mark.django_db
def test_unsubscribe_is_idempotent(client: APIClient) -> None:
    client.force_authenticate(UserFactory())

    response = client.post(_url("unsubscribe"), {"endpoint": ENDPOINT}, format="json")

    assert response.status_code == status.HTTP_200_OK
    assert response.data["device_count"] == 0


@configured
@pytest.mark.django_db
def test_status_reports_configuration_and_device_count(client: APIClient) -> None:
    user = UserFactory()
    PushSubscription.objects.create(user=user, endpoint=ENDPOINT, p256dh="k", auth="a")
    client.force_authenticate(user)

    response = client.get(_url("push-status"))

    assert response.status_code == status.HTTP_200_OK
    assert response.data == {"configured": True, "device_count": 1}


@configured
@pytest.mark.django_db
def test_test_endpoint_enqueues_a_push(client: APIClient) -> None:
    user = UserFactory()
    PushSubscription.objects.create(user=user, endpoint=ENDPOINT, p256dh="k", auth="a")
    client.force_authenticate(user)

    with patch("bubble.notifications.api.push_views.deliver_web_push") as mocked:
        response = client.post(_url("test"))

    assert response.status_code == status.HTTP_202_ACCEPTED
    mocked.assert_called_once()
    assert mocked.call_args.args[0] == user.pk


@configured
@pytest.mark.django_db
def test_test_endpoint_rejects_a_user_without_devices(client: APIClient) -> None:
    client.force_authenticate(UserFactory())

    with patch("bubble.notifications.api.push_views.deliver_web_push") as mocked:
        response = client.post(_url("test"))

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    mocked.assert_not_called()
