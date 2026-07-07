from constance import config
from django.conf import settings
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView


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
