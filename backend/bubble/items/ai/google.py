import json
import os
from typing import Any

from google import genai


def call_model(contents: Any, model: str = "gemini-2.5-flash-lite") -> dict:
    """Call the Google Gemini model with the given prompt."""
    client = genai.Client()

    response = client.models.generate_content(
        model=os.environ.get("AI_MODEL", "gemini-2.5-flash-lite"),
        contents=contents,
    )

    cleaned_response = response.text.strip().replace("```json", "").replace("```", "")
    return json.loads(cleaned_response)
