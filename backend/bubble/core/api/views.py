from constance import config
from django.conf import settings
from drf_spectacular.utils import OpenApiExample, extend_schema, inline_serializer
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView


class VersionView(APIView):
    """
    Public build-info endpoint.

    Reports the git commit SHA and release version baked into the running image.
    Used by the E2E release-gate pipeline to confirm that the environment under
    test is actually serving the commit being validated before tests start
    (see docs/e2e-testing/plan.md §7.2). Unauthenticated and cheap.
    """

    permission_classes = [AllowAny]

    @extend_schema(
        responses=inline_serializer(
            name="Version",
            fields={
                "git_sha": serializers.CharField(),
                "version": serializers.CharField(),
            },
        ),
        examples=[
            OpenApiExample(
                "Example",
                value={"git_sha": "1a2b3c4", "version": "0.1.1"},
            ),
        ],
    )
    def get(self, request, *args, **kwargs):
        return Response(
            {
                "git_sha": getattr(settings, "GIT_SHA", "") or "",
                "version": getattr(settings, "APP_VERSION", "") or "",
            },
            status=status.HTTP_200_OK,
        )


class ConfigView(APIView):
    """
    API endpoint that returns the current Constance configuration.
    """

    permission_classes = [AllowAny]

    def get(self, request, *args, **kwargs):
        # Retrieve all configuration values from django-constance

        constance_config = getattr(settings, "CONSTANCE_CONFIG_PUBLIC", []) or []
        config_values = {key: getattr(config, key) for key in constance_config}

        # Derived flags — which notification channels are configured on the
        # backend. Per-user availability additionally depends on the user having
        # filled in the matching profile field (see notification-preferences/me).
        from bubble.notifications.channels import (  # noqa: PLC0415
            ProviderType,
            is_backend_configured,
        )

        config_values["NOTIFICATIONS_ENABLED"] = {
            str(provider): is_backend_configured(provider) for provider in ProviderType
        }

        return Response(config_values, status=status.HTTP_200_OK)
