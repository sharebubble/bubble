import logging
from dataclasses import dataclass

from PIL import Image as PILImage

from bubble.items.models import CategoryType, Image

from .google import call_model

logger = logging.getLogger(__name__)


PROMPT_RETURN_FORMAT = (
    "Antworte ausschließlich mit validem JSON in folgendem Format: "
    "{\n"
    '  "title": "Kurzer prägnanter Titel für den Gegenstand",\n'
    '  "description": "Detaillierte Beschreibung des Gegenstands '
    'und seines Zustands",\n'
    '  "category": "Hauptkategorie des Gegenstands"\n'
    '  "price": "Vorgeschlagener Verkaufspreis in Euro, mit Punkt als '
    'Komma-Trennzeichen"\n'
    "}"
)


@dataclass
class ItemImageResult:
    """Result of image processing activity."""

    title: str | None = None
    description: str | None = None
    category: str | None = None
    price: str | None = None


def analyze_image(image_id: str, language: str = "de") -> ItemImageResult:
    """Analyze a single image and generate AI suggestions."""

    categories_string = ", ".join(dict(CategoryType.choices).keys())

    prompt_instruction = (
        "Analysiere dieses Bild und gib eine strukturierte Antwort im JSON-Format. "
        "Fokussiere auf: Art des Gegenstands, Zustand, bemerkenswerte Eigenschaften. "
        "Gib einen Preisvorschlage für den Verkauf des Artikels. "
        f"Die Kategorie soll aus dieser Liste gewählt werden: {categories_string}. "
        f"Die Antwort soll in dieser Sprache erfolgend: {language}. "
    ) + PROMPT_RETURN_FORMAT

    logger.info("Prompt instruction: %s", prompt_instruction)

    img = PILImage.open(Image.objects.get(id=image_id).preview)

    parsed_response = call_model(contents=[prompt_instruction, img])

    logger.info("AI response: %s", parsed_response)

    image_result = ItemImageResult(
        title=parsed_response.get("title"),
        description=parsed_response.get("description"),
        category=parsed_response.get("category"),
        price=parsed_response.get("price"),
    )

    logger.info(
        "AI analysis completed for image %s: %s",
        image_id,
        parsed_response,
    )

    return image_result
