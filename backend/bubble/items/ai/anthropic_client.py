import anthropic
from django.conf import settings

ANTHROPIC_API_KEY = getattr(settings, "ANTHROPIC_API_KEY", "")
ANTHROPIC_MODEL = getattr(settings, "ANTHROPIC_MODEL", "claude-2")


def call_model(
    prompt: str,
    model: str = ANTHROPIC_MODEL,
    max_tokens=500,
    extra_prompt: dict | None = None,
) -> str:
    """Call the Anthropic model with the given prompt."""
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

    content = [
        {"type": "text", "text": prompt},
    ]
    if extra_prompt:
        content.append(extra_prompt)

    message = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        messages=[{"role": "user", "content": content}],
    )

    return "".join([m.text for m in message.content])
