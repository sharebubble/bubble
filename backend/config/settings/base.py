# ruff: noqa: ERA001, E501
"""Base settings to build other settings files upon."""

from pathlib import Path

import environ

# https://docs.djangoproject.com/en/dev/ref/settings/#languages
from django.utils.translation import gettext_lazy as _

BASE_DIR = Path(__file__).resolve(strict=True).parent.parent.parent
# bubble/
APPS_DIR = BASE_DIR / "bubble"
env = environ.Env()

READ_DOT_ENV_FILE = env.bool("DJANGO_READ_DOT_ENV_FILE", default=True)
if READ_DOT_ENV_FILE:
    # OS environment variables take precedence over variables from .env
    env.read_env(str(BASE_DIR / ".env"))

# GENERAL

# https://docs.djangoproject.com/en/dev/ref/settings/#allowed-hosts
ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS", default=[])

# set the dynamic Pod IP injected by K8s
if pod_ip := env("POD_IP", default="").strip():
    ALLOWED_HOSTS.append(pod_ip)

if "localhost" not in ALLOWED_HOSTS:
    ALLOWED_HOSTS.append("localhost")
if "127.0.0.1" not in ALLOWED_HOSTS:
    ALLOWED_HOSTS.append("127.0.0.1")

FRONTEND_URL = env.str("FRONTEND_URL", default="")
if not FRONTEND_URL:
    FRONTEND_URL = (
        f"https://{ALLOWED_HOSTS[0]}" if ALLOWED_HOSTS else "http://localhost:3000"
    )

# Homeserver part of a Matrix ID (the "example.com" in "@alice:example.com").
# Matrix IDs conventionally use the bare site domain even when the
# client-server API itself is served from a subdomain (e.g. matrix.example.com),
# via .well-known delegation — so this defaults to the site's own domain
# rather than parsing it out of APPRISE_MATRIX_URL. Override it explicitly
# when that doesn't hold (e.g. the Matrix homeserver lives on a different
# domain entirely).
APPRISE_MATRIX_HOSTNAME = env("APPRISE_MATRIX_HOSTNAME", default="").strip() or (
    ALLOWED_HOSTS[0] if ALLOWED_HOSTS else ""
)

# ------------------------------------------------------------------------------
# https://docs.djangoproject.com/en/dev/ref/settings/#debug
DEBUG = env.bool("DJANGO_DEBUG", False)
# Build info baked into the image at build time (see backend/Dockerfile).
# Exposed via GET /api/version/ and consumed by the E2E release-gate pipeline
# (docs/e2e-testing/plan.md §7.2).
GIT_SHA = env.str("GIT_SHA", default="")
APP_VERSION = env.str("APP_VERSION", default="")
# Local time zone. Choices are
# http://en.wikipedia.org/wiki/List_of_tz_zones_by_name
# though not all of them may be available with every OS.
# In Windows, this must be set to your system time zone.
TIME_ZONE = "Europe/Vienna"
# https://docs.djangoproject.com/en/dev/ref/settings/#language-code
LANGUAGE_CODE = env.str("LANGUAGE_CODE", default="en")

LANGUAGES = [
    ("de", _("Deutsch")),
    ("en", _("English")),
]
# https://docs.djangoproject.com/en/dev/ref/settings/#site-id
SITE_ID = 1
# https://docs.djangoproject.com/en/dev/ref/settings/#use-i18n
USE_I18N = True
# https://docs.djangoproject.com/en/dev/ref/settings/#use-tz
USE_TZ = True
# https://docs.djangoproject.com/en/dev/ref/settings/#locale-paths
LOCALE_PATHS = [str(BASE_DIR / "locale")]

# DATABASES
# ------------------------------------------------------------------------------
# https://docs.djangoproject.com/en/dev/ref/settings/#databases
DATABASES = {
    "default": env.db(
        "DATABASE_URL", "postgres://postgres:local-dev-password@localhost:5432/bubble"
    )
}
DATABASES["default"]["ATOMIC_REQUESTS"] = True
# https://docs.djangoproject.com/en/stable/ref/settings/#std:setting-DEFAULT_AUTO_FIELD
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# URLS
# ------------------------------------------------------------------------------
# https://docs.djangoproject.com/en/dev/ref/settings/#root-urlconf
ROOT_URLCONF = "config.urls"
# https://docs.djangoproject.com/en/dev/ref/settings/#wsgi-application
WSGI_APPLICATION = "config.wsgi.application"

# APPS
# ------------------------------------------------------------------------------
DJANGO_APPS = [
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.sites",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # "django.contrib.humanize", # Handy template tags
    "django.contrib.admin",  # required
    "django.forms",
    "django.contrib.postgres",
]
THIRD_PARTY_APPS = [
    "guardian",
    "simple_history",
    "djmoney",
    "imagekit",
    "allauth",
    "allauth.account",
    "allauth.headless",
    # "allauth.mfa",
    "allauth.socialaccount",
    "allauth.socialaccount.providers.openid_connect",
    "allauth.socialaccount.providers.nextcloud",
    "channels",
    "rest_framework",
    "rest_framework.authtoken",
    "django_filters",
    "corsheaders",
    "drf_spectacular",
    "constance",
    "huey.contrib.djhuey",
    "django_ratelimit",
]
LOCAL_APPS = [
    "bubble.users",
    "bubble.items.apps.ItemsConfig",
    "bubble.bookings.apps.BookingsConfig",
    "bubble.core.apps.CoreConfig",
    "bubble.favorites.apps.FavoritesConfig",
    "bubble.books.apps.BooksConfig",
    "bubble.collections.apps.CollectionsConfig",
    "bubble.coins.apps.CoinsConfig",
    "bubble.comments.apps.CommentsConfig",
    "bubble.notifications.apps.NotificationsConfig",
    "bubble.federation.apps.FederationConfig",
    "bubble.caldav.apps.CaldavConfig",
]
# https://docs.djangoproject.com/en/dev/ref/settings/#installed-apps
INSTALLED_APPS = DJANGO_APPS + THIRD_PARTY_APPS + LOCAL_APPS

# AUTHENTICATION
# ------------------------------------------------------------------------------
# https://docs.djangoproject.com/en/dev/ref/settings/#authentication-backends
AUTHENTICATION_BACKENDS = [
    "django.contrib.auth.backends.ModelBackend",
    "allauth.account.auth_backends.AuthenticationBackend",
    "guardian.backends.ObjectPermissionBackend",
]
# https://docs.djangoproject.com/en/dev/ref/settings/#auth-user-model
# or "users.User"
AUTH_USER_MODEL = "users.User"

# https://docs.djangoproject.com/en/dev/ref/settings/#login-redirect-url
LOGIN_REDIRECT_URL = "users:redirect"
# https://docs.djangoproject.com/en/dev/ref/settings/#login-url
LOGIN_URL = "account_login"

# PASSWORDS
# ------------------------------------------------------------------------------
# https://docs.djangoproject.com/en/dev/ref/settings/#password-hashers
PASSWORD_HASHERS = [
    # https://docs.djangoproject.com/en/dev/topics/auth/passwords/#using-argon2-with-django
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2SHA1PasswordHasher",
    "django.contrib.auth.hashers.BCryptSHA256PasswordHasher",
]
# https://docs.djangoproject.com/en/dev/ref/settings/#auth-password-validators
AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",
    },
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# MIDDLEWARE
# ------------------------------------------------------------------------------
# https://docs.djangoproject.com/en/dev/ref/settings/#middleware
MIDDLEWARE = [
    "allow_cidr.middleware.AllowCIDRMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.locale.LocaleMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "allauth.account.middleware.AccountMiddleware",
    "simple_history.middleware.HistoryRequestMiddleware",
]

# STATIC
# ------------------------------------------------------------------------------
# https://docs.djangoproject.com/en/dev/ref/settings/#static-root
STATIC_ROOT = str(BASE_DIR / "staticfiles")
# https://docs.djangoproject.com/en/dev/ref/settings/#static-url
STATIC_URL = "/static/"
# https://docs.djangoproject.com/en/dev/ref/contrib/staticfiles/#std:setting-STATICFILES_DIRS
STATICFILES_DIRS = [str(APPS_DIR / "static")]
# https://docs.djangoproject.com/en/dev/ref/contrib/staticfiles/#staticfiles-finders
STATICFILES_FINDERS = [
    "django.contrib.staticfiles.finders.FileSystemFinder",
    "django.contrib.staticfiles.finders.AppDirectoriesFinder",
]

# MEDIA
# ------------------------------------------------------------------------------
# https://docs.djangoproject.com/en/dev/ref/settings/#media-root
MEDIA_ROOT = str(APPS_DIR / "media")
# https://docs.djangoproject.com/en/dev/ref/settings/#media-url
MEDIA_URL = "/media/"

# TEMPLATES
# ------------------------------------------------------------------------------
# https://docs.djangoproject.com/en/dev/ref/settings/#templates
TEMPLATES = [
    {
        # https://docs.djangoproject.com/en/dev/ref/settings/#std:setting-TEMPLATES-BACKEND
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        # https://docs.djangoproject.com/en/dev/ref/settings/#dirs
        "DIRS": [str(APPS_DIR / "templates"), str(APPS_DIR / "core" / "templates")],
        # https://docs.djangoproject.com/en/dev/ref/settings/#app-dirs
        "APP_DIRS": True,
        "OPTIONS": {
            # https://docs.djangoproject.com/en/dev/ref/settings/#template-context-processors
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.template.context_processors.i18n",
                "django.template.context_processors.media",
                "django.template.context_processors.static",
                "django.template.context_processors.tz",
                "django.contrib.messages.context_processors.messages",
                "bubble.core.context_processors.theme_context",
            ],
        },
    },
]

# https://docs.djangoproject.com/en/dev/ref/settings/#form-renderer
FORM_RENDERER = "django.forms.renderers.TemplatesSetting"

# FIXTURES
# ------------------------------------------------------------------------------
# https://docs.djangoproject.com/en/dev/ref/settings/#fixture-dirs
FIXTURE_DIRS = (str(APPS_DIR / "fixtures"),)

# SECURITY
# ------------------------------------------------------------------------------
# https://docs.djangoproject.com/en/dev/ref/settings/#session-cookie-httponly
SESSION_COOKIE_HTTPONLY = True
# https://docs.djangoproject.com/en/dev/ref/settings/#csrf-cookie-httponly
# CSRF_COOKIE_HTTPONLY = False  # must be accessible from Javascript
# https://docs.djangoproject.com/en/dev/ref/settings/#x-frame-options
X_FRAME_OPTIONS = "DENY"

# EMAIL
# ------------------------------------------------------------------------------
# https://docs.djangoproject.com/en/dev/ref/settings/#email-backend
EMAIL_BACKEND = env(
    "DJANGO_EMAIL_BACKEND",
    default="django.core.mail.backends.smtp.EmailBackend",
)
# https://docs.djangoproject.com/en/dev/ref/settings/#email-timeout
EMAIL_TIMEOUT = 5

# ADMIN
# ------------------------------------------------------------------------------
# Django Admin URL.
ADMIN_URL = "admin/"
# https://docs.djangoproject.com/en/dev/ref/settings/#admins
ADMINS = [("""Fabian Helm""", "fabian@hoad.at")]
# https://docs.djangoproject.com/en/dev/ref/settings/#managers
MANAGERS = ADMINS
# https://cookiecutter-django.readthedocs.io/en/latest/settings.html#other-environment-settings

# Force the `admin` sign in process to go through the `django-allauth` workflow
DJANGO_ADMIN_FORCE_ALLAUTH = env.bool("DJANGO_ADMIN_FORCE_ALLAUTH", default=False)

# LOGGING
# ------------------------------------------------------------------------------
# https://docs.djangoproject.com/en/dev/ref/settings/#logging
# See https://docs.djangoproject.com/en/dev/topics/logging for
# more details on how to customize your logging configuration.

LOG_LEVEL = env("DJANGO_LOG_LEVEL", default="INFO")

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "verbose": {
            "format": "%(levelname)s %(asctime)s %(module)s %(process)d %(thread)d %(message)s",
        },
    },
    "handlers": {
        "console": {
            "level": LOG_LEVEL,
            "class": "logging.StreamHandler",
            "formatter": "verbose",
        },
    },
    "root": {"level": LOG_LEVEL, "handlers": ["console"]},
    "loggers": {
        "django.db.backends": {
            "level": "ERROR",
            "handlers": ["console"],
            "propagate": False,
        },
        "django.security.DisallowedHost": {
            "level": "ERROR",
            "handlers": ["console"],
            "propagate": False,
        },
    },
}

REDIS_URL = env("REDIS_URL", default="redis://redis:6379/0")
REDIS_SSL = REDIS_URL.startswith("rediss://")

# Channels
# ------------------------------------------------------------------------------
ASGI_APPLICATION = "config.asgi.application"

CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {
            "hosts": [{"address": REDIS_URL, "socket_timeout": None}],
        },
    },
}

# Huey
# ------------------------------------------------------------------------------
HUEY = {
    "huey_class": "huey.RedisHuey",
    "name": "bubble",
    "url": REDIS_URL,
    "immediate": False,
    "consumer": {
        "workers": 2,
        "worker_type": "thread",
    },
}

# django-allauth
# ------------------------------------------------------------------------------
ACCOUNT_ALLOW_REGISTRATION = env.bool("ACCOUNT_ALLOW_REGISTRATION", default=False)

SOCIALACCOUNT_ONLY = env.bool("SOCIALACCOUNT_ONLY", default=False)

# https://docs.allauth.org/en/latest/account/configuration.html
ACCOUNT_LOGIN_METHODS = {"username"} if not SOCIALACCOUNT_ONLY else {}
# https://docs.allauth.org/en/latest/account/configuration.html
ACCOUNT_SIGNUP_FIELDS = (
    None if SOCIALACCOUNT_ONLY else ["email*", "username*", "password1*", "password2*"]
)
# https://docs.allauth.org/en/latest/account/configuration.html
ACCOUNT_EMAIL_VERIFICATION = env("ACCOUNT_EMAIL_VERIFICATION", default="none")
# https://docs.allauth.org/en/latest/account/configuration.html
ACCOUNT_ADAPTER = "bubble.users.adapters.AccountAdapter"
# https://docs.allauth.org/en/latest/account/forms.html
ACCOUNT_FORMS = {"signup": "bubble.users.forms.UserSignupForm"}
# https://docs.allauth.org/en/latest/socialaccount/configuration.html
SOCIALACCOUNT_ADAPTER = "bubble.users.adapters.SocialAccountAdapter"
# https://docs.allauth.org/en/latest/socialaccount/configuration.html
SOCIALACCOUNT_FORMS = {"signup": "bubble.users.forms.UserSocialSignupForm"}

SOCIALACCOUNT_ENABLED = env.bool("SOCIALACCOUNT_ENABLED", default=True)

SOCIALACCOUNT_ALLOW_REGISTRATION = env.bool(
    "SOCIALACCOUNT_ALLOW_REGISTRATION", default=True
)

SOCIALACCOUNT_EMAIL_AUTHENTICATION = True

SOCIALACCOUNT_PROVIDERS = {}

if nextcloud_server_url := env("NEXTCLOUD_SERVER_URL", default=""):
    SOCIALACCOUNT_PROVIDERS["nextcloud"] = {
        "APPS": [
            {
                "client_id": env("NEXTCLOUD_CLIENT_ID", default="default_client_id"),
                "secret": env("NEXTCLOUD_SECRET", default="default_secret"),
                "settings": {
                    "server": nextcloud_server_url,
                },
            },
        ],
    }

if oidc_server_url := env("OIDC_SERVER_URL", default=""):
    SOCIALACCOUNT_PROVIDERS["openid_connect"] = {
        "APPS": [
            {
                "provider_id": env("OIDC_PROVIDER_ID", default="oidc"),
                "name": env("OIDC_PROVIDER_NAME", default="OpenID Connect"),
                "client_id": env("OIDC_CLIENT_ID", default=""),
                "secret": env("OIDC_SECRET", default=""),
                "settings": {
                    "server_url": oidc_server_url,
                    "admin_group_name": env("OIDC_ADMIN_GROUP_NAME", default="admin"),
                    # Request the phone scope so the provider returns the
                    # phone_number claim, used to pre-fill the profile phone.
                    "scope": env.list(
                        "OIDC_SCOPE",
                        default=["openid", "profile", "email", "phone"],
                    ),
                },
            },
        ],
    }

# django-rest-framework
# -------------------------------------------------------------------------------
# django-rest-framework - https://www.django-rest-framework.org/api-guide/settings/
REST_FRAMEWORK = {
    "DEFAULT_RENDERER_CLASSES": [
        "drf_orjson_renderer.renderers.ORJSONRenderer",
        "rest_framework.renderers.BrowsableAPIRenderer",
    ],
    "DEFAULT_PARSER_CLASSES": (
        "drf_orjson_renderer.parsers.ORJSONParser",
        "rest_framework.parsers.FormParser",
        "rest_framework.parsers.MultiPartParser",
    ),
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework.authentication.SessionAuthentication",
        "rest_framework.authentication.TokenAuthentication",
        "allauth.headless.contrib.rest_framework.authentication.XSessionTokenAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.DjangoObjectPermissions",
    ),
    "DEFAULT_FILTER_BACKENDS": ["django_filters.rest_framework.DjangoFilterBackend"],
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 20,
}

HEADLESS_FRONTEND_URLS = {
    "socialaccount_login_error": FRONTEND_URL,
    "account_confirm_email": FRONTEND_URL,
}
HEADLESS_SERVE_SPECIFICATION = True
HEADLESS_ONLY = True

# django-cors-headers - https://github.com/adamchainz/django-cors-headers#setup
CORS_URLS_REGEX = r"^/api/.*$"

CORS_ALLOWED_ORIGINS = [FRONTEND_URL]

CORS_ALLOW_CREDENTIALS = True

CSRF_TRUSTED_ORIGINS = [FRONTEND_URL]


# By Default swagger ui is available only to admin user(s). You can change permission classes to change that
# See more configuration options at https://drf-spectacular.readthedocs.io/en/latest/settings.html#settings
SPECTACULAR_SETTINGS = {
    "TITLE": "bubble API",
    "DESCRIPTION": "Documentation of API endpoints of bubble",
    "VERSION": "1.0.0",
    "SERVE_PERMISSIONS": ["rest_framework.permissions.AllowAny"],
    "SCHEMA_PATH_PREFIX": "/api/",
}

# Your stuff...
# ------------------------------------------------------------------------------

DEFAULT_CURRENCY = env("DEFAULT_CURRENCY", default="EUR")

CONSTANCE_ADDITIONAL_FIELDS = {
    "item_visibility": [
        "django.forms.fields.ChoiceField",
        {
            "widget": "django.forms.Select",
            "choices": (
                ("public", "Public"),
                ("authenticated", "All logged in user"),
                ("internal", "Internal groups only"),
                ("hidden", "Hidden"),
            ),
        },
    ],
}

CONSTANCE_CONFIG = {
    "REQUIRE_LOGIN": (True, "Require a user to login to view the site"),
    "DEFAULT_ITEM_VISIBILITY": (
        "authenticated",
        "Select default item visibility for new items. Options: public, authenticated, internal, hidden",
        "item_visibility",
    ),
    "APPRISE_ROCKETCHAT_URL": (
        env("APPRISE_ROCKETCHAT_URL", default=""),
        "Apprise URL template for RocketChat notifications. Use {target} as a "
        "placeholder for the recipient's RocketChat username, e.g. "
        "rocket://user:password@rocketchat.example.com/@{target}",
    ),
    "APPRISE_SIGNAL_URL": (
        env("APPRISE_SIGNAL_URL", default=""),
        "Apprise URL template for Signal notifications. Use {target} as a "
        "placeholder for the recipient's phone number, e.g. "
        "signal://signal-api.example.com/+15551230000/{target}",
    ),
    "APPRISE_MATRIX_URL": (
        env("APPRISE_MATRIX_URL", default=""),
        "Apprise URL template for Matrix notifications. Use {target} as a "
        "placeholder for the recipient's Matrix ID, e.g. "
        "matrixs://user:password@matrix.example.com/{target}",
    ),
    "APPRISE_MAILTOS_URL": (
        env("APPRISE_MAILTOS_URL", default=""),
        "Apprise URL template for email (mailtos) notifications. Use {target} "
        "as a placeholder for the recipient's email address, e.g. "
        "mailtos://user:password@smtp.example.com?to={target}",
    ),
    "FEDERATION_ENABLED": (
        env.bool("FEDERATION_ENABLED", default=False),
        "Enable ActivityPub federation. Requires FEDERATION_DOMAIN and FEDERATION_KEY_ENCRYPTION_KEY.",
    ),
    "FEDERATION_DEFAULT_ITEM_VISIBILITY": (
        env("FEDERATION_DEFAULT_ITEM_VISIBILITY", default="local_only"),
        "Default federation visibility for new items: 'public_federated' or 'local_only'.",
    ),
    "COIN_NAME": (
        env("COIN_NAME", default="Treibhaus Coins"),
        "Name of the community currency offered after a free (zero-price) "
        "transaction, e.g. 'Treibhaus Coins'.",
    ),
    "COIN_SHORT_NAME": (
        env("COIN_SHORT_NAME", default="THC"),
        "Short name of the community currency used next to amounts, e.g. 'THC'.",
    ),
    "COIN_SLIDER_MAX": (
        env.int("COIN_SLIDER_MAX", default=100),
        "Upper end of the coin slider shown after a free transaction. One coin "
        "is meant to be worth roughly one unit of DEFAULT_CURRENCY.",
    ),
}

CONSTANCE_CONFIG_PUBLIC = [
    "REQUIRE_LOGIN",
    "DEFAULT_ITEM_VISIBILITY",
    "COIN_NAME",
    "COIN_SHORT_NAME",
    "COIN_SLIDER_MAX",
]

ISBN_LOOKUP_BASE_URL = env("ISBN_LOOKUP_BASE_URL", default="http://isbn-search:8000")

# WEB PUSH (VAPID)
# ------------------------------------------------------------------------------
# Browser push requires an application server keypair (VAPID, RFC 8292). The
# public key is handed to the browser when it subscribes and is exposed through
# GET /api/config/; the private key signs the JWT on every send and must stay
# secret, hence env rather than Constance (which is editable in the admin).
# Both are base64url: the private key is the raw 32-byte P-256 scalar, the public
# key the 65-byte uncompressed point. Generate a pair with:
#   python manage.py generate_vapid_keys
# Push delivery stays disabled while either key is empty.
VAPID_PUBLIC_KEY = env("VAPID_PUBLIC_KEY", default="")
VAPID_PRIVATE_KEY = env("VAPID_PRIVATE_KEY", default="")
# The "sub" claim: a mailto: or https: URL push services can use to contact the
# operator about a misbehaving deployment. Falls back to DEFAULT_FROM_EMAIL.
VAPID_SUBJECT = env("VAPID_SUBJECT", default="")
# Push services drop a notification that could not be delivered within the TTL.
VAPID_TTL_SECONDS = env.int("VAPID_TTL_SECONDS", default=12 * 60 * 60)

# FEDERATION
# ------------------------------------------------------------------------------
# Enable ActivityPub federation by setting FEDERATION_ENABLED=true and
# configuring FEDERATION_DOMAIN + FEDERATION_KEY_ENCRYPTION_KEY.
FEDERATION_ENABLED = env.bool("FEDERATION_ENABLED", default=False)
FEDERATION_DOMAIN = env("FEDERATION_DOMAIN", default="")
FEDERATION_INSTANCE_NAME = env("FEDERATION_INSTANCE_NAME", default="")
# Fernet-style base64-encoded 32-byte key for encrypting actor private keys.
# Generate with:
#   python -c "import secrets, base64; print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())"
FEDERATION_KEY_ENCRYPTION_KEY = env("FEDERATION_KEY_ENCRYPTION_KEY", default="")
FEDERATION_DELIVERY_TIMEOUT = env.int("FEDERATION_DELIVERY_TIMEOUT", default=10)
FEDERATION_DELIVERY_MAX_RETRIES = env.int("FEDERATION_DELIVERY_MAX_RETRIES", default=8)
# Inbox rate limit expressed as django-ratelimit rate string, e.g. "60/m" or "200/h".
FEDERATION_INBOX_RATE_LIMIT = env("FEDERATION_INBOX_RATE_LIMIT", default="60/m")

# STORAGE
# ------------------------------------------------------------------------------
# STORAGE_BACKEND: "local" (default) or "s3"
# When "s3", django-storages S3Boto3Storage is used for media files.
# Static files always use WhiteNoise (or the locally-configured backend).
STORAGE_BACKEND = env("STORAGE_BACKEND", default="local")

if STORAGE_BACKEND == "s3":
    # S3-compatible object storage (AWS S3, MinIO, Cloudflare R2, Backblaze B2, …)
    AWS_ACCESS_KEY_ID = env("S3_ACCESS_KEY")
    AWS_SECRET_ACCESS_KEY = env("S3_SECRET_KEY")
    AWS_STORAGE_BUCKET_NAME = env("S3_BUCKET")
    # Optional: override endpoint for non-AWS providers (MinIO, R2, etc.)
    AWS_S3_ENDPOINT_URL = env("S3_ENDPOINT_URL", default="")
    # Optional: CDN or direct bucket URL base (used to build absolute media URLs)
    # When empty, django-storages constructs URLs from the endpoint + bucket.
    AWS_S3_CUSTOM_DOMAIN = env("S3_CUSTOM_DOMAIN", default="")
    # Always serve files via HTTPS
    AWS_S3_USE_SSL = env.bool("S3_USE_SSL", default=True)
    # Do not overwrite existing files with the same name
    AWS_S3_FILE_OVERWRITE = False
    # Cache-Control header for uploaded objects
    AWS_S3_OBJECT_PARAMETERS = {
        "CacheControl": "max-age=86400",
    }
    # Path prefix inside the bucket for media files
    AWS_LOCATION = env("S3_MEDIA_PREFIX", default="media")
    # Addressing style: "path" required for MinIO, "auto" for AWS
    AWS_S3_ADDRESSING_STYLE = env("S3_ADDRESSING_STYLE", default="path")
    # Signature version: s3v4 required for MinIO / most non-AWS providers
    AWS_S3_SIGNATURE_VERSION = env("S3_SIGNATURE_VERSION", default="s3v4")

    STORAGES = {
        "default": {
            "BACKEND": "storages.backends.s3boto3.S3Boto3Storage",
        },
        "staticfiles": {
            "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
        },
    }
    # Override MEDIA_URL so Django's url() helpers produce absolute URLs.
    # django-storages builds this automatically when AWS_S3_CUSTOM_DOMAIN is set.
    if AWS_S3_CUSTOM_DOMAIN:
        MEDIA_URL = f"https://{AWS_S3_CUSTOM_DOMAIN}/{AWS_LOCATION}/"
    elif AWS_S3_ENDPOINT_URL:
        MEDIA_URL = f"{AWS_S3_ENDPOINT_URL}/{AWS_STORAGE_BUCKET_NAME}/{AWS_LOCATION}/"
else:
    # Local filesystem — keep existing behaviour
    STORAGES = {
        "default": {
            "BACKEND": "django.core.files.storage.FileSystemStorage",
        },
        "staticfiles": {
            "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
        },
    }

# CACHES
# ------------------------------------------------------------------------------
# https://docs.djangoproject.com/en/dev/ref/settings/#caches
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "",
    },
}

CONSTANCE_BACKEND = "constance.backends.database.DatabaseBackend"

if REDIS_URL:
    CACHES = {
        "default": {
            "BACKEND": "django_redis.cache.RedisCache",
            "LOCATION": REDIS_URL,
            "OPTIONS": {
                "CLIENT_CLASS": "django_redis.client.DefaultClient",
                # Mimicking memcache behavior.
                # https://github.com/jazzband/django-redis#memcached-exceptions-behavior
                "IGNORE_EXCEPTIONS": True,
            },
        },
    }
    CONSTANCE_DATABASE_CACHE_BACKEND = "default"
