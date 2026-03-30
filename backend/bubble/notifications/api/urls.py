from rest_framework.routers import SimpleRouter

from .views import NotificationPreferenceViewSet

router = SimpleRouter()
router.register(
    "notification-preferences",
    NotificationPreferenceViewSet,
    basename="notification-preference",
)
