from rest_framework import status
from rest_framework.test import APIRequestFactory

from bubble.core.api.views import VersionView


class TestVersionView:
    """Tests for the public GET /api/version/ build-info endpoint.

    The view reads only settings, so we call it directly via APIRequestFactory
    (no middleware, no DB) — fast and dependency-free.
    """

    def _get(self):
        request = APIRequestFactory().get("/api/version/")
        return VersionView.as_view()(request)

    def test_returns_git_sha_and_version_from_settings(self, settings):
        settings.GIT_SHA = "1a2b3c4"
        settings.APP_VERSION = "0.1.1"

        response = self._get()

        assert response.status_code == status.HTTP_200_OK
        assert response.data == {"git_sha": "1a2b3c4", "version": "0.1.1"}

    def test_defaults_to_empty_strings_when_unset(self, settings):
        settings.GIT_SHA = ""
        settings.APP_VERSION = ""

        response = self._get()

        assert response.status_code == status.HTTP_200_OK
        assert response.data == {"git_sha": "", "version": ""}

    def test_is_public(self, settings):
        """The gate polls this before auth is set up, so it must allow any."""
        settings.GIT_SHA = "deadbee"

        response = self._get()

        assert response.status_code == status.HTTP_200_OK
