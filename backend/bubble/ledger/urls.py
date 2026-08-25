"""URL configuration for the ledger app."""

from rest_framework.routers import SimpleRouter

from bubble.ledger.api.views import BookingPaymentViewSet

router = SimpleRouter()

router.register("payments", BookingPaymentViewSet, basename="payment")

urlpatterns = router.urls
