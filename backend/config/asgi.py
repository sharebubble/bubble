"""
ASGI config for bubble project.

It exposes the ASGI callable as a module-level variable named ``application``.

For more information on this file, see
https://docs.djangoproject.com/en/dev/howto/deployment/asgi/

"""

import os
import sys
from pathlib import Path

# This allows easy placement of apps within the interior
# bubble directory.
BASE_DIR = Path(__file__).resolve(strict=True).parent.parent
sys.path.append(str(BASE_DIR / "bubble"))

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.production")

# Import the WebSocket application which includes both HTTP and WebSocket routing
from config.websocket import application  # noqa: E402, F401
