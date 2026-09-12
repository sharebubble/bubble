from rest_framework.routers import SimpleRouter

from .views import FavoriteItemViewSet

router = SimpleRouter()
router.register("favorites", FavoriteItemViewSet, basename="favorite")
