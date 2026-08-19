import logging
import uuid

from django.contrib.auth.models import AbstractUser
from django.db import models
from django.db.models import CharField
from django.db.models.signals import post_save
from django.dispatch import receiver
from django.urls import reverse
from django.utils.translation import gettext_lazy as _

from bubble.notifications.models import EventType, NotificationPreference
from config.settings.base import AUTH_USER_MODEL


class User(AbstractUser):
    """
    Default custom user model for bubble.
    If adding fields that need to be filled at user signup,
    check forms.SignupForm and forms.SocialSignupForms accordingly.
    """

    id = models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True)

    name = CharField(_("Name of User"), blank=True, max_length=255)
    first_name = None  # type: ignore[assignment]
    last_name = None  # type: ignore[assignment]

    # Federation
    federation_enabled = models.BooleanField(
        default=True,
        help_text=_(
            "Allow this user's profile and items to be federated via ActivityPub. "
            "Disabling this removes the user from WebFinger lookup and stops "
            "publishing their items to peer instances."
        ),
    )

    def get_absolute_url(self) -> str:
        """Get URL for user's detail view.

        Returns:
            str: URL for user detail.

        """
        return reverse("users:detail", kwargs={"username": self.username})


class LanguageChoice(models.TextChoices):
    EN = "en", _("English")
    DE = "de", _("German")


class Profile(models.Model):
    user = models.OneToOneField(
        AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="profile",
    )
    address = models.TextField(blank=True)
    phone = models.CharField(max_length=15, blank=True)
    matrix_id = models.CharField(
        max_length=255,
        blank=True,
        verbose_name=_("Matrix ID"),
        help_text=_("Matrix user ID for notifications, e.g. @alice:matrix.org"),
    )
    email_reminder = models.BooleanField(default=True)
    internal = models.BooleanField(default=False)
    bio = models.TextField(blank=True)
    profile_image = models.ImageField(upload_to="users/", blank=True, null=True)
    profile_image_alt = models.CharField(max_length=255, blank=True)
    language = models.CharField(
        max_length=10,
        choices=LanguageChoice,
        blank=True,
        default="",
        verbose_name=_("preferred language"),
        help_text=_("UI language preference for this user."),
    )

    # Federation
    federation_discoverable = models.BooleanField(
        default=True,
        help_text=_(
            "Include this profile in WebFinger discovery and the Mastodon-compatible "
            "actor endpoint. Requires federation_enabled on the User as well."
        ),
    )

    pwa_install_dismissed = models.BooleanField(
        default=False,
        help_text=_(
            "User has dismissed the home-screen prompt to install Bubble as a PWA. "
            "Once set, the prompt is not shown again."
        ),
    )

    def __str__(self):
        return f"{self.user.username}'s Profile"


@receiver(post_save, sender=User)
def create_user_profile(sender, instance, created, **kwargs):
    if created:
        Profile.objects.create(user=instance)
        _setup_default_notification_preferences(instance)


def _setup_default_notification_preferences(user) -> None:
    """Enable RocketChat message notifications by default.

    Only creates the preference row when the RocketChat Apprise URL is
    configured, always with enabled=True.
    """
    try:
        from bubble.notifications.channels import is_backend_configured  # noqa: PLC0415

        if not is_backend_configured(NotificationPreference.ProviderType.ROCKETCHAT):
            return
        NotificationPreference.objects.get_or_create(
            user=user,
            provider_type=NotificationPreference.ProviderType.ROCKETCHAT,
            event_type=EventType.NEW_MESSAGE,
            defaults={"enabled": True},
        )
    except Exception:
        logging.getLogger(__name__).exception(
            "Failed to set up default notification preferences for user %s", user.pk
        )
