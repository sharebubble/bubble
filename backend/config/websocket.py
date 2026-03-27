"""WebSocket routing configuration."""

from channels.auth import AuthMiddlewareStack
from channels.routing import ProtocolTypeRouter, URLRouter
from django.core.asgi import get_asgi_application
from django.urls import path

from bubble.core.consumers import NotificationConsumer

# Define WebSocket URL patterns
websocket_urlpatterns = [
    path("api/ws/notifications/", NotificationConsumer.as_asgi()),
]

# Application router that handles both HTTP and WebSocket
application = ProtocolTypeRouter(
    {
        "http": get_asgi_application(),
        "websocket": AuthMiddlewareStack(URLRouter(websocket_urlpatterns)),
    }
)
