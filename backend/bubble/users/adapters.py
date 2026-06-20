from __future__ import annotations

import typing

from allauth.account.adapter import DefaultAccountAdapter
from allauth.socialaccount.adapter import DefaultSocialAccountAdapter
from django.conf import settings
from django.contrib.auth.models import Group

from bubble.core.permissions_config import DefaultGroup

if typing.TYPE_CHECKING:
    from allauth.socialaccount.models import SocialLogin
    from django.http import HttpRequest

    from bubble.users.models import User


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
        """Populate profile fields from OIDC claims (currently the phone number).

        Standard OIDC exposes the phone as ``phone_number``; some providers use
        ``phone``. Only an empty profile field is filled so a value the user set
        in Bubble is never overwritten.
        """
        from bubble.users.models import Profile  # noqa: PLC0415

        phone = userinfo.get("phone_number") or userinfo.get("phone")
        if not phone:
            return

        profile, _created = Profile.objects.get_or_create(user=user)
        if not profile.phone:
            max_length = Profile._meta.get_field("phone").max_length  # noqa: SLF001
            profile.phone = str(phone)[:max_length]
            profile.save(update_fields=["phone"])

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
