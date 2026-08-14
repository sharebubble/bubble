"""URL configuration for the coins app."""

from rest_framework.routers import SimpleRouter

from bubble.coins.api.views import CoinValuationViewSet

router = SimpleRouter()

router.register("coin-valuations", CoinValuationViewSet, basename="coin-valuation")

urlpatterns = router.urls
