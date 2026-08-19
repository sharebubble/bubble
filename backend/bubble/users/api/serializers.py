from django.contrib.auth.models import Group
from rest_framework import serializers

from bubble.users.models import Profile, User


class GroupSerializer(serializers.ModelSerializer):
    """Serializer for auth Group model."""

    class Meta:
        model = Group
        fields = ["id", "name"]


class ProfileSerializer(serializers.ModelSerializer[Profile]):
    email = serializers.EmailField(source="user.email", read_only=True)
    username = serializers.CharField(source="user.username", read_only=True)
    name = serializers.CharField(source="user.name", required=False, allow_blank=True)

    class Meta:
        model = Profile
        fields = [
            "username",
            "name",
            "email",
            "phone",
            "matrix_id",
            "bio",
            "address",
            "email_reminder",
            "profile_image",
            "language",
            "pwa_install_dismissed",
        ]

    def update(self, instance, validated_data):
        # Pop user-level fields and update the related User object
        user_data = validated_data.pop("user", {})
        if user_data:
            user = instance.user
            for attr, value in user_data.items():
                setattr(user, attr, value)
            user.save(update_fields=list(user_data.keys()))

        return super().update(instance, validated_data)


class UserSerializer(serializers.ModelSerializer[User]):
    class Meta:
        model = User
        fields = ["id", "username", "name", "email"]
