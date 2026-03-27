"""Context processors for the core app."""


def theme_context(request):
    """Add theme-related context variables."""
    # Get theme preference from session, cookie, or default to 'auto'
    current_theme = request.session.get("theme")

    if not current_theme:
        # Check for theme preference in cookies
        current_theme = request.COOKIES.get("theme", "auto")

    # Validate theme mode
    valid_themes = ["light", "dark", "auto"]
    if current_theme not in valid_themes:
        current_theme = "auto"

    # For template data-bs-theme attribute:
    # - Return 'light' or 'dark' for explicit themes
    # - Return None for 'auto' to let CSS media queries handle it
    data_bs_theme = current_theme if current_theme != "auto" else None

    return {
        "site_name": "Bubble",
        "current_theme": current_theme,
        "data_bs_theme": data_bs_theme,
        "available_themes": [
            {"value": "light", "label": "Light"},
            {"value": "dark", "label": "Dark"},
            {"value": "auto", "label": "Auto"},
        ],
    }
