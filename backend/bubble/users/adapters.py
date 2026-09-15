from __future__ import annotations

import logging
import mimetypes
import typing

import requests
import sentry_sdk
from allauth.account.adapter import DefaultAccountAdapter
from allauth.socialaccount.adapter import DefaultSocialAccountAdapter
from django.conf import settings
from django.contrib.auth.models import Group
from django.core.files.base import ContentFile

from bubble.core.permissions_config import DefaultGroup

if typing.TYPE_CHECKING:
    from allauth.socialaccount.models import SocialLogin
    from django.http import HttpRequest

    from bubble.users.models import Profile, User

logger = logging.getLogger(__name__)


class AccountAdapter(DefaultAccountAdapter):
    def is_open_for_signup(self, request: HttpRequest) -> bool:
        return getattr(settings, "ACCOUNT_ALLOW_REGISTRATION", True)


class SocialAccountAdapter(DefaultSocialAccountAdapter):
    def is_open_for_signup(
        self,
        request: HttpRequest,
        sociallogin: SocialLogin,
    ) -> bool:
        return getattr(settings, "SOCIALACCOUNT_ALLOW_REGISTRATION", True)

    def on_authentication_error(
        self,
        request: HttpRequest,
        provider,
        error=None,
        exception=None,
        extra_context=None,
    ) -> None:
        """Log and report social login failures so `error=unknown` can be diagnosed.

        allauth reports many failures by redirecting the browser back to the SPA
        with only an error code. This hook captures the underlying exception and
        request context before the redirect happens.
        """
        super().on_authentication_error(
            request,
            provider,
            error=error,
            exception=exception,
            extra_context=extra_context,
        )

        error_code = error.value if hasattr(error, "value") else error
        provider_id = getattr(provider, "id", None)
        provider_name = getattr(provider, "name", None)

        # Avoid double-reporting the same exception if allauth already handed it
        # to Sentry via its own error handling.
        exception_info = (
            {"type": type(exception).__name__, "message": str(exception)}
            if exception
            else None
        )

        context = {
            "provider_id": provider_id,
            "provider_name": provider_name,
            "error_code": error_code,
            "error_enum": str(error),
            "extra_context": extra_context,
            "user_agent": request.headers.get("user-agent"),
            "remote_addr": request.META.get("REMOTE_ADDR"),
            "referer": request.headers.get("referer"),
            "session_key": request.session.session_key,
        }

        logger.warning(
            "Social login failed: provider=%s error=%s exception=%s",
            provider_id,
            error_code,
            exception_info,
            extra={"social_auth_context": context},
        )

        with sentry_sdk.new_scope() as scope:
            scope.set_context("social_auth", context)
            scope.set_tag("provider", provider_id)
            scope.set_tag("auth_error_code", error_code)
            sentry_sdk.capture_message(
                (
                    f"Social login failed: {provider_name or provider_id}"
                    f" returned {error_code}"
                ),
                level="warning",
            )

    def update_groups(self, user, sociallogin):
        # add to default group
        default_group, _ = Group.objects.get_or_create(name=DefaultGroup.DEFAULT)
        user.groups.add(default_group)

        # check admin group
        groups = sociallogin.account.extra_data.get("userinfo", {}).get("groups", [])
        provider_admin_group_name = sociallogin.provider.app.settings.get(
            "admin_group_name", ""
        )

        if provider_admin_group_name in groups:
            internal_group, _ = Group.objects.get_or_create(
                name=DefaultGroup.ADMINISTRATORS
            )
            user.groups.add(internal_group)
            user.is_staff = True
            user.is_superuser = True
            user.save()

    def pre_social_login(self, request, sociallogin):
        """
        Triggered every time a user logs in.
        We use this to sync profile data from Authentik to Django.
        """
        # If the user doesn't exist yet, populate_user (the logic from before) handles
        if not sociallogin.is_existing:
            return

        user = sociallogin.user
        data = sociallogin.account.extra_data

        # Map Authentik OIDC claims to Django User fields
        # Note: Authentik keys in extra_data usually match standard OIDC claims
        if userinfo := data.get("userinfo", {}):
            user.username = userinfo.get("preferred_username") or user.username
            user.email = userinfo.get("email") or user.email
            user.name = userinfo.get("name") or user.name
            user.save()
            self.sync_profile_from_oidc(user, userinfo)

        self.update_groups(user, sociallogin)

    @staticmethod
    def sync_profile_from_oidc(user: User, userinfo: dict[str, typing.Any]) -> None:
        """Populate profile fields from OIDC claims (phone number, avatar).

        Standard OIDC exposes the phone as ``phone_number`` (some providers use
        ``phone``) and the avatar as ``picture``. Only an empty profile field is
        filled so a value the user set in Bubble is never overwritten.
        """
        from bubble.users.models import Profile  # noqa: PLC0415

        profile, _created = Profile.objects.get_or_create(user=user)

        phone = userinfo.get("phone_number") or userinfo.get("phone")
        if phone and not profile.phone:
            max_length = Profile._meta.get_field("phone").max_length  # noqa: SLF001
            profile.phone = str(phone)[:max_length]
            profile.save(update_fields=["phone"])

        picture_url = userinfo.get("picture")
        if picture_url and not profile.profile_image:
            SocialAccountAdapter._sync_avatar_from_url(profile, picture_url)

    @staticmethod
    def _sync_avatar_from_url(profile: Profile, picture_url: str) -> None:
        """Download the SSO-provided avatar and attach it as the profile image."""
        try:
            response = requests.get(picture_url, timeout=10)
            response.raise_for_status()
        except requests.RequestException:
            logger.warning(
                "Could not fetch SSO avatar for %s from %s",
                profile.user.username,
                picture_url,
                exc_info=True,
            )
            return

        content_type = response.headers.get("Content-Type", "").split(";")[0]
        extension = mimetypes.guess_extension(content_type) or ".jpg"
        filename = f"{profile.user.username}-avatar{extension}"
        profile.profile_image.save(filename, ContentFile(response.content), save=True)

    def populate_user(
        self,
        request: HttpRequest,
        sociallogin: SocialLogin,
        data: dict[str, typing.Any],
    ) -> User:
        """
        Populates user information from social provider info.

        See: https://docs.allauth.org/en/latest/socialaccount/advanced.html#creating-and-populating-user-instances
        """
        user = super().populate_user(request, sociallogin, data)
        if not user.name:
            if name := data.get("name"):
                user.name = name
            elif first_name := data.get("first_name"):
                user.name = first_name
                if last_name := data.get("last_name"):
                    user.name += f" {last_name}"
        return user

    def save_user(self, request, sociallogin, form=None):
        """
        Saves a newly signed up social login. We override this to ensure that the
        user is added to the default group on signup.
        """
        user = super().save_user(request, sociallogin, form)
        self.update_groups(user, sociallogin)

        userinfo = sociallogin.account.extra_data.get("userinfo", {})
        if userinfo:
            self.sync_profile_from_oidc(user, userinfo)

        return user
