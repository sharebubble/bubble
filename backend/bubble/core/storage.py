"""Storage utilities for building absolute media URLs.

When the storage backend is S3-compatible, ``django-storages`` already
produces fully-qualified URLs from ``FieldFile.url``.  With the local
filesystem backend the URL is relative (e.g. ``/media/items/…``), so we
must prepend the site domain ourselves.

Usage::

    from bubble.core.storage import absolute_media_url

    url = absolute_media_url(image_field_file, request=request)
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from django.conf import settings

if TYPE_CHECKING:
    from django.core.files import File
    from django.http import HttpRequest


def absolute_media_url(
    field_file: File,
    request: HttpRequest | None = None,
) -> str | None:
    """Return an absolute URL for *field_file*.

    Resolution order:
    1. If the field has no file, return ``None``.
    2. If ``field_file.url`` is already absolute (S3/CDN), return it as-is.
    3. If a ``request`` is available, use ``request.build_absolute_uri()``.
    4. Fall back to building the URL from ``FEDERATION_DOMAIN`` (set when
       federation is enabled) or the first ``ALLOWED_HOSTS`` entry.
    """
    if not field_file:
        return None

    try:
        url = field_file.url
    except ValueError:
        return None

    if not url:
        return None

    # Already absolute (S3, CDN, etc.)
    if url.startswith(("http://", "https://")):
        return url

    # Relative URL — build absolute
    if request is not None:
        return request.build_absolute_uri(url)

    # No request available — derive from settings
    domain = getattr(settings, "FEDERATION_DOMAIN", None)
    if not domain:
        hosts = getattr(settings, "ALLOWED_HOSTS", [])
        domain = next(
            (h for h in hosts if h not in ("localhost", "127.0.0.1", "*")),
            "localhost",
        )

    scheme = "https" if not settings.DEBUG else "http"
    return f"{scheme}://{domain}{url}"
