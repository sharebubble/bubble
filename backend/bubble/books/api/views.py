"""API views for books."""

from django_filters.rest_framework import DjangoFilterBackend
from drf_spectacular.utils import extend_schema
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import DjangoModelPermissions
from rest_framework.response import Response

from bubble.books.api.filters import BookFilter
from bubble.books.api.serializers import BookListSerializer, BookSerializer
from bubble.books.services import ISBNLookupService
from bubble.items.api.search import RelevanceOrderingFilter
from bubble.items.models import Item


class BookViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing books (Items with category='books').

    list: Get all books
    retrieve: Get a specific book by UUID
    create: Create a new book
    update: Update a book
    partial_update: Partially update a book
    destroy: Delete a book
    """

    serializer_class = BookSerializer
    permission_classes = [DjangoModelPermissions]
    lookup_field = "id"
    filterset_class = BookFilter
    # `BookFilter.search` replaces DRF's SearchFilter so the same `search`
    # parameter is matched once, and ranked title-first.
    filter_backends = [
        DjangoFilterBackend,
        RelevanceOrderingFilter,
    ]
    ordering_fields = ["created_at", "updated_at", "name", "relevance"]
    ordering = ["-created_at"]

    def get_queryset(self):
        return (
            Item.objects.get_for_user(self.request.user)
            .filter(category="books")
            .select_related("user")
            .prefetch_related("images")
        )

    def get_serializer_class(self):
        """Return appropriate serializer class based on action."""
        if self.action == "list":
            return BookListSerializer
        return BookSerializer

    def perform_create(self, serializer):
        """Force category=books on create."""
        serializer.save(user=self.request.user, category="books")

    @extend_schema(
        request={
            "application/json": {
                "type": "object",
                "properties": {
                    "isbn": {
                        "type": "string",
                        "description": (
                            "ISBN number to fetch book details from "
                            "OpenLibrary API. If not provided, uses the "
                            "book's existing ISBN."
                        ),
                        "example": "9780980200447",
                    }
                },
            }
        },
        responses={200: BookSerializer},
    )
    @action(detail=True, methods=["put"])
    def isbn_update(self, request, *args, **kwargs):
        """
        Update book details from OpenLibrary based on ISBN.

        Optionally provide an ISBN in the request body to update the book with
        data from OpenLibrary. If no ISBN is provided, the book's existing ISBN
        will be used.
        """
        item = self.get_object()
        isbn = request.data.get("isbn")

        existing_isbn = (item.properties or {}).get("isbn", "")
        if not isbn and not existing_isbn:
            return Response(
                {"error": "Book does not have an ISBN and none was provided."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        service = ISBNLookupService()
        service.update_book_from_isbn(item, isbn=isbn)

        serializer = self.get_serializer(item)
        return Response(serializer.data)
