from __future__ import annotations

import logging


class CancelledErrorFilter(logging.Filter):
    """Drop log records that are just a noisy ``CancelledError`` traceback.

    These exceptions are raised when a client/browser disconnects before the
    server has finished producing the response. They are especially common with
    ASGI/Channels and OIDC redirects, but the stack trace is usually not
    actionable and fills the logs.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        # 1. Drop if the attached exception is a CancelledError.
        exc_info = record.exc_info
        if exc_info and exc_info[0] is not None:
            exc_name = getattr(exc_info[0], "__name__", "")
            if "CancelledError" in exc_name:
                return False

        # 2. Drop if the log message itself is about a shielded CancelledError.
        message = record.getMessage()
        return not ("CancelledError" in message and "shielded future" in message)


class SessionUnauthorizedFilter(logging.Filter):
    """Drop Django's routine 401 warnings for the allauth session endpoint.

    allauth answers 401 when a user is not authenticated, which is the normal
    state before login and after logout. The frontend handles this as a valid
    response, so the Django request warning is just noise.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        return "Unauthorized: /api/_allauth/browser/v1/auth/session" not in message
