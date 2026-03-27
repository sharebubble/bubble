from allauth.account.forms import SignupForm
from allauth.socialaccount.forms import SignupForm as SocialSignupForm
from django import forms
from django.contrib.auth import forms as admin_forms
from django.utils.translation import gettext_lazy as _

from .models import User


class UserAdminChangeForm(admin_forms.UserChangeForm):
    class Meta(admin_forms.UserChangeForm.Meta):  # type: ignore[name-defined]
        model = User


class UserAdminCreationForm(admin_forms.AdminUserCreationForm):  # type: ignore[name-defined]  # django-stubs is missing the class, thats why the error is thrown: typeddjango/django-stubs#2555
    """
    Form for User Creation in the Admin Area.
    To change user signup, see UserSignupForm and UserSocialSignupForm.
    """

    class Meta(admin_forms.UserCreationForm.Meta):  # type: ignore[name-defined]
        model = User
        error_messages = {
            "username": {"unique": _("This username has already been taken.")},
        }


class UserSignupForm(SignupForm):
    """
    Form that will be rendered on a user sign up section/screen.
    Default fields will be added automatically.
    Check UserSocialSignupForm for accounts created from social.
    """


class UserSocialSignupForm(SocialSignupForm):
    """
    Renders the form when user has signed up using social accounts.
    Default fields will be added automatically.
    See UserSignupForm otherwise.
    """


class UserProfileUpdateForm(forms.ModelForm):
    """
    Form for updating user profile information including User and Profile fields.
    """

    # User fields
    name = forms.CharField(
        max_length=255,
        required=False,
        label=_("Name"),
        widget=forms.TextInput(attrs={"class": "form-control"}),
    )
    email = forms.EmailField(
        required=True,
        label=_("E-Mail"),
        widget=forms.EmailInput(attrs={"class": "form-control"}),
    )

    # Profile fields
    address = forms.CharField(
        required=False,
        label=_("Adresse"),
        widget=forms.Textarea(attrs={"class": "form-control", "rows": 3}),
    )
    phone = forms.CharField(
        max_length=15,
        required=False,
        label=_("Telefon"),
        widget=forms.TextInput(attrs={"class": "form-control"}),
    )

    class Meta:
        model = User
        fields = [
            "name",
            "email",
        ]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.instance and hasattr(self.instance, "profile"):
            self.fields["address"].initial = self.instance.profile.address
            self.fields["phone"].initial = self.instance.profile.phone

    def save(self, *, commit=True):
        user = super().save(commit=commit)
        if commit:
            # Update profile fields
            profile = user.profile
            profile.address = self.cleaned_data["address"]
            profile.phone = self.cleaned_data["phone"]
            profile.save()
        return user
