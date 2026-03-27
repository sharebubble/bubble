from django.db import models

from config.settings.base import AUTH_USER_MODEL


class Favorite(models.Model):
    user = models.ForeignKey(
        AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="favorites",
    )
    title = models.CharField(max_length=255)
    url = models.URLField(max_length=500)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("user", "url")
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.user.username} - {self.title}"

    @classmethod
    def get_user_favorites(cls, user):
        return cls.objects.filter(user=user)
