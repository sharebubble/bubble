from rest_framework.routers import SimpleRouter

from .api.views import CommentViewSet

router = SimpleRouter()

router.register("comments", CommentViewSet, basename="comment")

urlpatterns = router.urls
