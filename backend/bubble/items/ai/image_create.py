"""Small wrapper to generate images using Google GenAI Images API.

This uses a lightweight image model (configurable via AI_IMAGE_MODEL).
The function returns raw image bytes (PNG) on success.
"""

import logging
import os

from google import genai

logger = logging.getLogger(__name__)


def generate_image_from_prompt(
    prompt: str, model: str | None = None
) -> tuple[bytes | None, str | None]:
    """
    Generate an image from a text prompt using Google's GenAI Images API.

    Returns a tuple (image_bytes, mime_type) where mime_type is typically
    'image/png'.
    """
    client = genai.Client()

    model_name = model or os.environ.get("AI_IMAGE_MODEL", "gemini-2.5-flash")

    logger.info("Generating image with model %s", model_name)

    response = client.models.generate_images(
        model=model_name,
        prompt=f"Generate an image of: {prompt}",
        config=genai.types.GenerateImagesConfig(
            number_of_images=1,
        ),
    )

    if not response.generated_images:
        msg = "No images generated"
        raise ValueError(msg)

    image = response.generated_images[0].image

    return image.image_bytes, image.mime_type
