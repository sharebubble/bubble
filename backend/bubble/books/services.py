import logging
import re

import requests
from django.conf import settings
from django.core.files.base import ContentFile
from django.utils.text import slugify
from django.utils.translation import gettext_lazy as _
from rest_framework.exceptions import APIException, ValidationError

from bubble.items.models import Item

logger = logging.getLogger(__name__)


class ISBNValidationError(ValidationError):
    """Raised when ISBN is invalid or cannot be validated."""


class ISBNMetadataNotFoundError(APIException):
    """Raised when no metadata can be found for the given ISBN."""

    status_code = 404
    default_detail = "No metadata found for the given ISBN."
    default_code = "metadata_not_found"


def _canonicalize_isbn(isbn: str) -> str | None:
    """
    Strip hyphens and spaces from an ISBN string and validate it.

    Returns the cleaned ISBN string if it is a valid 10- or 13-digit ISBN,
    or None if the input is not valid.
    """
    clean = re.sub(r"[\s\-]", "", isbn)
    if re.fullmatch(r"\d{10}|\d{13}", clean):
        return clean
    return None


class ISBNLookupService:
    """Service for fetching book metadata from the local isbn-lookup service."""

    def get_book_details(self, isbn: str) -> tuple[dict, str]:
        """
        Fetch book details from the local isbn-lookup service.

        Returns a tuple of (metadata dict, clean_isbn string).

        Raises:
            ISBNValidationError: If the ISBN format is invalid.
            ISBNMetadataNotFoundError: If no metadata can be found for the ISBN.
        """
        clean_isbn = _canonicalize_isbn(isbn)
        if not clean_isbn:
            raise ISBNValidationError(
                _("Invalid ISBN format: %(isbn)s") % {"isbn": isbn}
            )

        url = f"{settings.ISBN_LOOKUP_BASE_URL}/book/{clean_isbn}"
        try:
            response = requests.get(url, timeout=10)
            response.raise_for_status()
        except requests.HTTPError as exc:
            if (
                exc.response is not None
                and exc.response.status_code == requests.codes.not_found
            ):
                msg = f"No metadata found for ISBN: {isbn}"
                raise ISBNMetadataNotFoundError(msg) from exc
            logger.exception(
                "ISBN lookup service HTTP error for ISBN %s at %s", isbn, url
            )
            msg = f"ISBN lookup service error for ISBN {isbn}."
            raise ISBNMetadataNotFoundError(msg) from exc
        except requests.RequestException as exc:
            logger.exception(
                "ISBN lookup service request failed for ISBN %s at %s", isbn, url
            )
            msg = f"ISBN lookup service unreachable for ISBN {isbn}."
            raise ISBNMetadataNotFoundError(msg) from exc

        return response.json(), clean_isbn

    def update_book_from_isbn(self, item: Item, isbn: str | None = None) -> None:
        """
        Update Item fields and properties with metadata from the isbn-lookup service.
        """
        props = dict(item.properties or {})
        isbn_to_use = isbn or props.get("isbn", "")
        if not isbn_to_use:
            return

        details, clean_isbn = self.get_book_details(isbn_to_use)
        props["isbn"] = clean_isbn
        props["metadata"] = details

        self._update_item_from_details(item, props, details)
        item.properties = props
        item.save()

        self._fetch_and_set_cover_image(item, details)

    def _update_item_from_details(self, item: Item, props: dict, details: dict) -> None:
        """
        Update item fields and property dict from the isbn-lookup response.

        The service returns a dict with keys:
        - 'isbn': canonical ISBN-13
        - 'title': book title
        - 'description': book description
        - 'authors': list of author names
        - 'genres': list of genre strings
        - 'publication_year': int or null
        - 'topic': topic string or null
        - 'publisher': publisher name or null
        - 'cover_image': URL string or null
        - 'language': BCP-47 language code or null
        - 'sources': list of source identifiers
        """
        if details.get("title"):
            item.name = details["title"]

        if details.get("description"):
            item.description = details["description"]

        if details.get("publication_year") is not None:
            props["year"] = details["publication_year"]

        if details.get("language"):
            props["language"] = details["language"]

        if details.get("authors"):
            existing = props.get("authors") or []
            merged = list({*existing, *details["authors"]})
            props["authors"] = sorted(merged)

        if details.get("publisher"):
            props["publisher"] = details["publisher"]

        if details.get("genres"):
            props["genres"] = details["genres"]

        if details.get("topic"):
            props["topic"] = details["topic"]

    def _fetch_and_set_cover_image(self, item: Item, details: dict) -> None:
        """
        Fetch and attach a cover image from the URL provided by the lookup service.
        """
        if item.images.exists():  # type: ignore[attr-defined]
            return

        cover_url = details.get("cover_image")
        if not cover_url:
            return

        try:
            response = requests.get(cover_url, timeout=10)
            response.raise_for_status()
            image_name = f"{slugify(item.name)}-cover.jpg"
            item.images.create(  # type: ignore[attr-defined]
                original=ContentFile(response.content, name=image_name)
            )
        except requests.RequestException:
            pass
