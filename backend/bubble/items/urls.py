from rest_framework.routers import SimpleRouter

from .api.views import ImageViewSet, ItemViewSet, PublicItemViewSet

router = SimpleRouter()

router.register("items", ItemViewSet, basename="item")
router.register("public-items", PublicItemViewSet, basename="public-item")
router.register("images", ImageViewSet, basename="image")

urlpatterns = router.urls
