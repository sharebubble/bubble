from rest_framework.routers import SimpleRouter

from .push_views import PushSubscriptionViewSet
from .views import NotificationPreferenceViewSet

router = SimpleRouter()
router.register(
    "notification-preferences",
    NotificationPreferenceViewSet,
    basename="notification-preference",
)
router.register(
    "push-subscriptions",
    PushSubscriptionViewSet,
    basename="push-subscription",
)
