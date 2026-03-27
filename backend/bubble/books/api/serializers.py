"""Serializers for books API.

Books are stored as Items with category='books'.  Book-specific fields live
in Item.properties (JSONB).  The serializers expose the same field names as
before so existing API consumers are unaffected.
"""

from rest_framework import serializers

from bubble.items.api.serializers import ItemListSerializer, ItemSerializer
from bubble.items.models import Item


def _props(instance):
    """Return the properties dict for an Item, defaulting to empty dict."""
    return instance.properties or {}


class BookListSerializer(ItemListSerializer):
    """Lightweight serializer for Book list view."""

    isbn = serializers.SerializerMethodField()
    language = serializers.SerializerMethodField()
    year = serializers.SerializerMethodField()
    topic = serializers.SerializerMethodField()
    authors = serializers.SerializerMethodField()
    genres = serializers.SerializerMethodField()
    verlag_name = serializers.SerializerMethodField()
    shelf_name = serializers.SerializerMethodField()

    class Meta(ItemListSerializer.Meta):
        model = Item
        fields = "__all__"

    def get_isbn(self, obj):
        return _props(obj).get("isbn", "")

    def get_language(self, obj):
        return _props(obj).get("language", "")

    def get_year(self, obj):
        return _props(obj).get("year")

    def get_topic(self, obj):
        return _props(obj).get("topic", "")

    def get_authors(self, obj):
        return _props(obj).get("authors", [])

    def get_genres(self, obj):
        return _props(obj).get("genres", [])

    def get_verlag_name(self, obj):
        return _props(obj).get("publisher", "")

    def get_shelf_name(self, obj):
        return _props(obj).get("shelf", "")


class BookSerializer(ItemSerializer):
    """Full serializer for Book detail view.

    Read-side: exposes isbn, language, year, topic, metadata, authors,
    genres, verlag (publisher name), shelf from Item.properties.

    Write-side: accepts authors (list of strings), genres (list of strings),
    publisher (string), shelf (string), isbn, language, year, topic,
    metadata.  The old UUID-based author_ids / genre_ids / verlag_id /
    shelf_id fields are no longer accepted.
    """

    # --- read-only property fields ---
    isbn = serializers.SerializerMethodField()
    language = serializers.SerializerMethodField()
    year = serializers.SerializerMethodField()
    topic = serializers.SerializerMethodField()
    metadata = serializers.SerializerMethodField()
    authors = serializers.SerializerMethodField()
    genres = serializers.SerializerMethodField()
    # "verlag" kept as a dict with a "name" key for backward compat
    verlag = serializers.SerializerMethodField()
    shelf = serializers.SerializerMethodField()

    # --- write-only fields that update Item.properties ---
    isbn_write = serializers.CharField(
        write_only=True, source="isbn", required=False, allow_blank=True
    )
    language_write = serializers.CharField(
        write_only=True, source="language", required=False, allow_blank=True
    )
    year_write = serializers.IntegerField(
        write_only=True, source="year", required=False, allow_null=True
    )
    topic_write = serializers.CharField(
        write_only=True, source="topic", required=False, allow_blank=True
    )
    metadata_write = serializers.JSONField(
        write_only=True, source="metadata", required=False, allow_null=True
    )
    authors_write = serializers.ListField(
        child=serializers.CharField(allow_blank=True),
        write_only=True,
        source="authors",
        required=False,
    )
    genres_write = serializers.ListField(
        child=serializers.CharField(allow_blank=True),
        write_only=True,
        source="genres",
        required=False,
    )
    publisher = serializers.CharField(write_only=True, required=False, allow_blank=True)
    shelf_write = serializers.CharField(
        write_only=True, source="shelf_str", required=False, allow_blank=True
    )

    class Meta(ItemSerializer.Meta):
        model = Item
        fields = "__all__"

    # --- read getters ---

    def get_isbn(self, obj):
        return _props(obj).get("isbn", "")

    def get_language(self, obj):
        return _props(obj).get("language", "")

    def get_year(self, obj):
        return _props(obj).get("year")

    def get_topic(self, obj):
        return _props(obj).get("topic", "")

    def get_metadata(self, obj):
        return _props(obj).get("metadata")

    def get_authors(self, obj):
        return _props(obj).get("authors", [])

    def get_genres(self, obj):
        return _props(obj).get("genres", [])

    def get_verlag(self, obj):
        name = _props(obj).get("publisher", "")
        return {"name": name} if name else None

    def get_shelf(self, obj):
        name = _props(obj).get("shelf", "")
        return {"name": name} if name else None

    # --- write handling ---

    def update(self, instance, validated_data):
        # Extract book-property keys from validated_data before passing to
        # the parent update (which would try to set them as model fields).
        book_keys = (
            "isbn",
            "language",
            "year",
            "topic",
            "metadata",
            "authors",
            "genres",
        )
        props = dict(instance.properties or {})

        for key in book_keys:
            if key in validated_data:
                props[key] = validated_data.pop(key)

        # publisher / shelf come through their write_only source names.
        if "publisher" in validated_data:
            props["publisher"] = validated_data.pop("publisher")
        if "shelf_str" in validated_data:
            props["shelf"] = validated_data.pop("shelf_str")

        validated_data["properties"] = props
        return super().update(instance, validated_data)

    def create(self, validated_data):
        book_keys = (
            "isbn",
            "language",
            "year",
            "topic",
            "metadata",
            "authors",
            "genres",
        )
        props = {}

        for key in book_keys:
            if key in validated_data:
                props[key] = validated_data.pop(key)

        if "publisher" in validated_data:
            props["publisher"] = validated_data.pop("publisher")
        if "shelf_str" in validated_data:
            props["shelf"] = validated_data.pop("shelf_str")

        validated_data["properties"] = props
        return super().create(validated_data)
