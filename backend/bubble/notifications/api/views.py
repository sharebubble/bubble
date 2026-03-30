from __future__ import annotations

from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import GenericViewSet

from .serializers import NotificationPreferenceMeSerializer


class NotificationPreferenceViewSet(GenericViewSet):
    """ViewSet exposing a single 'me' endpoint for notification preferences."""

    permission_classes = [IsAuthenticated]
    serializer_class = NotificationPreferenceMeSerializer

    @action(detail=False, methods=["get", "patch"])
    def me(self, request):
        """Get or update the current user's notification preferences."""
        serializer = self.get_serializer()

        if request.method == "PATCH":
            serializer = self.get_serializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            serializer.update(request.user, serializer.validated_data)
            # Re-serialize to return current state
            out = NotificationPreferenceMeSerializer()
            return Response(out.to_representation(request.user))

        return Response(
            serializer.to_representation(request.user), status=status.HTTP_200_OK
        )
