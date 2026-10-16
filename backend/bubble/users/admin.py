from allauth.account.decorators import secure_admin_login
from django.conf import settings
from django.contrib import admin
from django.contrib.auth import admin as auth_admin
from django.utils.translation import gettext_lazy as _

from bubble.ledger.models import AccountBalance

from .forms import UserAdminChangeForm, UserAdminCreationForm
from .models import User

if settings.DJANGO_ADMIN_FORCE_ALLAUTH:
    # Force the `admin` sign in process to go through the `django-allauth` workflow:
    # https://docs.allauth.org/en/latest/common/admin.html#admin
    admin.autodiscover()
    admin.site.login = secure_admin_login(admin.site.login)  # type: ignore[method-assign]


@admin.register(User)
class UserAdmin(auth_admin.UserAdmin):
    form = UserAdminChangeForm
    add_form = UserAdminCreationForm
    fieldsets = (
        (None, {"fields": ("username", "password")}),
        (_("Personal info"), {"fields": ("name", "email")}),
        (
            _("Permissions"),
            {
                "fields": (
                    "is_active",
                    "is_staff",
                    "is_superuser",
                    "groups",
                    "user_permissions",
                ),
            },
        ),
        (_("Important dates"), {"fields": ("last_login", "date_joined")}),
    )
    list_display = ["username", "name", "is_superuser"]
    search_fields = ["name"]

    def get_deleted_objects(self, objs, request):
        """Refuse to delete members whose ledger account is not settled.

        Deleting a user releases their member account (it stays, anonymised),
        which is only allowed at a zero balance. Listing them as protected
        makes the admin show why, instead of failing mid-delete.
        """
        deleted, model_count, perms_needed, protected = super().get_deleted_objects(
            objs, request
        )
        unsettled = AccountBalance.objects.filter(
            account__owner__in=list(objs)
        ).exclude(balance=0)
        protected = list(protected) + [
            _("%(account)s: balance %(balance)s must be settled first")
            % {"account": b.account.name, "balance": b.display_balance}
            for b in unsettled.select_related("account")
        ]
        return deleted, model_count, perms_needed, protected
