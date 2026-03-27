import json

from django.contrib.auth.mixins import LoginRequiredMixin
from django.contrib.messages.views import SuccessMessageMixin
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.urls import reverse_lazy
from django.utils.translation import gettext_lazy as _
from django.views import View
from django.views.generic import DeleteView, ListView

from bubble.users.models import User

from .models import Favorite


class CheckFavoriteStatusView(LoginRequiredMixin, View):
    """AJAX view to check if current page is favorited"""

    def get(self, request):
        url = request.GET.get("url")
        if not url:
            return JsonResponse({"error": _("URL is required")}, status=400)

        is_favorited = Favorite.objects.filter(user=request.user, url=url).exists()
        return JsonResponse({"is_favorited": is_favorited})


class ToggleFavoriteView(LoginRequiredMixin, View):
    """AJAX view to toggle favorite status"""

    def post(self, request):
        data = json.loads(request.body)
        url = data.get("url")
        title = data.get("title", "")
        update_title = data.get("update_title", False)

        if not url:
            return JsonResponse({"error": _("URL is required")}, status=400)

        # If this is a title update request
        if update_title:
            try:
                favorite = Favorite.objects.get(user=request.user, url=url)
                favorite.title = title
                favorite.save()
                return JsonResponse(
                    {
                        "status": "updated",
                        "message": _("Favorite updated"),
                        "is_favorited": True,
                    },
                )
            except Favorite.DoesNotExist:
                # Create new if doesn't exist
                Favorite.objects.create(user=request.user, url=url, title=title)
                return JsonResponse(
                    {
                        "status": "added",
                        "message": _("Added to favorites"),
                        "is_favorited": True,
                    },
                )

        favorite, created = Favorite.objects.get_or_create(
            user=request.user,
            url=url,
            defaults={"title": title},
        )

        if not created:
            # If it already exists, remove it
            favorite.delete()
            return JsonResponse(
                {
                    "status": "removed",
                    "message": _("Remove from favorites"),
                    "is_favorited": False,
                },
            )

        return JsonResponse(
            {
                "status": "added",
                "message": _("Added to favorites"),
                "is_favorited": True,
            },
        )


class UserFavoritesView(LoginRequiredMixin, ListView):
    """Display user's favorites with pagination"""

    model = Favorite
    template_name = "favorites/user_favorites.html"
    context_object_name = "favorites"
    paginate_by = 10

    def get_queryset(self):
        username = self.kwargs.get("username")
        user = get_object_or_404(User, username=username)
        # Only show own favorites or if user is staff
        if self.request.user == user or self.request.user.is_staff:
            return Favorite.objects.filter(user=user)
        return Favorite.objects.none()

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        username = self.kwargs.get("username")
        context["profile_user"] = get_object_or_404(User, username=username)
        return context


class DeleteFavoriteView(LoginRequiredMixin, SuccessMessageMixin, DeleteView):
    """Delete a favorite"""

    model = Favorite
    success_message = _("Favorite deleted successfully")

    def get_queryset(self):
        # Users can only delete their own favorites
        return super().get_queryset().filter(user=self.request.user)

    def get_success_url(self):
        return reverse_lazy(
            "favorites:user_list",
            kwargs={"username": self.request.user.username},
        )

    def delete(self, request, *args, **kwargs):
        if request.headers.get("X-Requested-With") == "XMLHttpRequest":
            self.object = self.get_object()
            self.object.delete()
            return JsonResponse(
                {"status": "success", "message": str(self.success_message)},
            )
        return super().delete(request, *args, **kwargs)
