from rest_framework.routers import SimpleRouter

from .api.views import BookingViewSet, MessageViewSet, PublicBookingViewSet

router = SimpleRouter()

router.register("bookings", BookingViewSet, basename="booking")
router.register("public-bookings", PublicBookingViewSet, basename="public-booking")
router.register("messages", MessageViewSet, basename="message")

urlpatterns = router.urls
