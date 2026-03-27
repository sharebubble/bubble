import pytest
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient, APIRequestFactory

from bubble.users.api.views import UserViewSet
from bubble.users.models import User
from bubble.users.tests.factories import UserFactory


@pytest.mark.django_db
class TestUserViewSet:
    @pytest.fixture
    def api_rf(self) -> APIRequestFactory:
        return APIRequestFactory()

    def test_get_queryset(self, user: User, api_rf: APIRequestFactory):
        view = UserViewSet()
        request = api_rf.get("/fake-url/")
        request.user = user

        view.request = request

        assert user in view.get_queryset()

    def test_me(self, user: User, api_rf: APIRequestFactory):
        view = UserViewSet()
        request = api_rf.get("/fake-url/")
        request.user = user

        view.request = request

        response = view.me(request)  # type: ignore[call-arg, arg-type, misc]

        assert response.data == {
            "id": str(user.id),
            "username": user.username,
            "name": user.name,
            "email": user.email,
        }


@pytest.mark.django_db
class TestProfileViewSet:
    """Test the /api/profiles/me/ endpoint for viewing user profiles (read-only)."""

    @pytest.fixture
    def client(self):
        return APIClient()

    @pytest.fixture
    def user(self):
        return UserFactory()

    @pytest.fixture
    def authenticated_client(self, client, user):
        client.force_authenticate(user=user)
        return client

    def test_get_profile_me_authenticated(self, authenticated_client, user):
        """Test authenticated user can view their profile."""
        url = reverse("api:profile-me")
        response = authenticated_client.get(url)

        assert response.status_code == status.HTTP_200_OK
        assert "username" in response.data
        assert "name" in response.data
        assert "email" in response.data
        assert "phone" in response.data
        assert "bio" in response.data
        assert "profile_image" in response.data

    def test_get_profile_me_unauthenticated(self, client):
        """Test unauthenticated user cannot view profile."""
        url = reverse("api:profile-me")
        response = client.get(url)

        # With DjangoObjectPermissions as default, anonymous users get 403
        assert response.status_code == status.HTTP_403_FORBIDDEN

    def test_profile_is_read_only(self, authenticated_client):
        """Test that profile endpoint is read-only (no PUT/POST/DELETE)."""
        url = reverse("api:profile-me")

        # Test PUT is not allowed
        response = authenticated_client.put(url, {"bio": "test"}, format="json")
        assert response.status_code == status.HTTP_405_METHOD_NOT_ALLOWED

        # Test POST is not allowed
        response = authenticated_client.post(url, {"bio": "test"}, format="json")
        assert response.status_code == status.HTTP_405_METHOD_NOT_ALLOWED

        # Test DELETE is not allowed
        response = authenticated_client.delete(url)
        assert response.status_code == status.HTTP_405_METHOD_NOT_ALLOWED
