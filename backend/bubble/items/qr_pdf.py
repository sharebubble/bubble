"""Printable QR-code sheet for quick-renting an item.

The sheet is drawn with Pillow (already a dependency) and saved as a one-page
A4 PDF, so no extra PDF library is needed.
"""

from __future__ import annotations

import io
import textwrap
from typing import TYPE_CHECKING

import qrcode
from django.conf import settings
from django.utils.translation import gettext as _
from PIL import Image, ImageDraw, ImageFont

if TYPE_CHECKING:
    from bubble.items.models import Item

# A4 at 150 dpi.
DPI = 150
PAGE_SIZE = (1240, 1754)
MARGIN = 100
QR_SIZE = 900
# Pillow's built-in font lacks umlauts, so prefer DejaVu Sans (installed in
# the backend image via fonts-dejavu-core).
FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def quick_rent_url(item: Item) -> str:
    """Frontend URL a scan of the item's QR code opens."""
    return f"{settings.FRONTEND_URL.rstrip('/')}/item/{item.id}/quick-rent"


def _font(size: int):
    try:
        return ImageFont.truetype(FONT_PATH, size)
    except OSError:
        return ImageFont.load_default(size=size)


def _draw_centered(draw, y, text, font, fill="black") -> int:
    """Draw ``text`` horizontally centred at ``y``; return the next free y."""
    left, top, right, bottom = draw.textbbox((0, 0), text, font=font)
    draw.text(((PAGE_SIZE[0] - (right - left)) / 2, y), text, font=font, fill=fill)
    return y + (bottom - top) + 20


def render_quick_rent_pdf(item: Item) -> bytes:
    """Render the item's QR-code sheet and return it as PDF bytes."""
    url = quick_rent_url(item)

    qr = qrcode.QRCode(
        error_correction=qrcode.constants.ERROR_CORRECT_M, border=2, box_size=10
    )
    qr.add_data(url)
    qr.make(fit=True)
    qr_image = (
        qr.make_image(fill_color="black", back_color="white")
        .get_image()
        .convert("RGB")
        .resize((QR_SIZE, QR_SIZE), Image.Resampling.NEAREST)
    )

    page = Image.new("RGB", PAGE_SIZE, "white")
    draw = ImageDraw.Draw(page)
    title_font = _font(72)
    name_font = _font(56)
    text_font = _font(34)
    small_font = _font(24)

    y = MARGIN
    y = _draw_centered(draw, y, _("Scan to rent"), title_font)
    for line in textwrap.wrap(
        item.name or _("Item"), width=32, max_lines=2, placeholder=" …"
    ):
        y = _draw_centered(draw, y, line, name_font)

    y += 20
    page.paste(qr_image, ((PAGE_SIZE[0] - QR_SIZE) // 2, y))
    y += QR_SIZE + 40

    for line in (
        _("Scan once to rent this item right away."),
        _("Scan again when you bring it back to return it."),
    ):
        y = _draw_centered(draw, y, line, text_font)

    _draw_centered(draw, PAGE_SIZE[1] - MARGIN, url, small_font, fill="#555555")

    buffer = io.BytesIO()
    page.save(buffer, format="PDF", resolution=DPI)
    return buffer.getvalue()
