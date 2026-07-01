from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient


class TestVersionView:
    """Tests for the public GET /api/version/ build-info endpoint.

    The endpoint reads only settings (no DB), so these run without a database.
    """

    def test_returns_git_sha_and_version_from_settings(self, settings):
        settings.GIT_SHA = "1a2b3c4"
        settings.APP_VERSION = "0.1.1"

        response = APIClient().get(reverse("version"))

        assert response.status_code == status.HTTP_200_OK
        assert response.json() == {"git_sha": "1a2b3c4", "version": "0.1.1"}

    def test_defaults_to_empty_strings_when_unset(self, settings):
        settings.GIT_SHA = ""
        settings.APP_VERSION = ""

        response = APIClient().get(reverse("version"))

        assert response.status_code == status.HTTP_200_OK
        assert response.json() == {"git_sha": "", "version": ""}

    def test_is_public(self, settings):
        """The gate polls this before auth is set up, so it must allow any."""
        settings.GIT_SHA = "deadbee"

        response = APIClient().get(reverse("version"))

        assert response.status_code == status.HTTP_200_OK
