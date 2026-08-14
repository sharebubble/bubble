from django.conf import settings
from rest_framework.routers import DefaultRouter, SimpleRouter

from bubble.bookings.urls import router as bookings_router
from bubble.books.urls import router as books_router
from bubble.coins.urls import router as coins_router
from bubble.collections.urls import router as collections_router
from bubble.comments.urls import router as comments_router
from bubble.items.urls import router as items_router
from bubble.notifications.api.urls import router as notifications_router
from bubble.users.api.views import GroupViewSet, ProfileViewSet, UserViewSet

router = DefaultRouter() if settings.DEBUG else SimpleRouter()

router.register("users", UserViewSet)
router.register("profiles", ProfileViewSet, basename="profile")
router.register("groups", GroupViewSet, basename="group")

router.registry.extend(items_router.registry)
router.registry.extend(bookings_router.registry)
router.registry.extend(books_router.registry)
router.registry.extend(collections_router.registry)
router.registry.extend(coins_router.registry)
router.registry.extend(comments_router.registry)
router.registry.extend(notifications_router.registry)

app_name = "api"
urlpatterns = router.urls
