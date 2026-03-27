"""URL configuration for collections app."""

from rest_framework.routers import DefaultRouter

from bubble.collections.api.views import CollectionItemViewSet, CollectionViewSet

router = DefaultRouter()
router.register(r"collections", CollectionViewSet, basename="collection")
router.register(r"collection-items", CollectionItemViewSet, basename="collection-item")

urlpatterns = router.urls
