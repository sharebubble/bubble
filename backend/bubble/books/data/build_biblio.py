#!/usr/bin/env python3
"""Convert the source bibliography (ODT) into ``biblio_books.json``.

The source is a 3-column ODT table exported from the library catalogue:
``Autor: Titel`` | ``Regal`` (thematic shelf) | ``Anmerkung`` (note).

This script flattens that table, parses each citation
(``Author (Year): Title : Subtitle. Place : Publisher``) into structured
fields, normalises the shelf labels, and writes a JSON file consumed by the
``import_biblio`` management command.

Parsing is deliberately conservative: the original citation is always kept
in ``raw_citation`` and a ``confidence`` flag (high/medium/low) marks records
where the author/year could not be detected, so they can be reviewed by hand.

Usage::

    python build_biblio.py path/to/bibliography.odt [out.json]
"""

import hashlib
import html
import json
import re
import sys
import zipfile
from pathlib import Path

# --- shelf (Regal) normalisation: collapse spelling/casing variants ---------
SHELF_MAP = {
    "öst": "Öst",
    "öst.": "Öst",
    "österreich": "Öst",
    "ost": "Öst",
    "fem öst": "Feminismus Öst",
    "fem, öst": "Feminismus Öst",
    "fem., öst": "Feminismus Öst",
    "fem, öst.": "Feminismus Öst",
    "fem., öst.": "Feminismus Öst",
    "fem. öst": "Feminismus Öst",
    "fem. östt": "Feminismus Öst",
    "feminismus -öst": "Feminismus Öst",
    "fem": "Feminismus",
    "feminismus": "Feminismus",
    "f": "Feminismus",
    "lateinamerika": "Lateinamerika",
    "laeinamerika": "Lateinamerika",
    "latein-amerika": "Lateinamerika",
    "lateiamerika": "Lateinamerika",
    "postkolonial": "Postkolonialismus",
    "postkolon": "Postkolonialismus",
    "postkolonialismus": "Postkolonialismus",
    "poststrukt": "Poststrukturalismus",
    "poststruk": "Poststrukturalismus",
    "poststruct": "Poststrukturalismus",
    "krittheorie": "KritTheorie",
    "postop": "PostOperaismus",
    "postoperaismus": "PostOperaismus",
    "bewaffnet": "Bewaffneter Kampf",
    "bewaffneter": "Bewaffneter Kampf",
    "rätekomm": "Rätekommunismus",
    "rätekommunismus": "Rätekommunismus",
    "komm": "Kommunismus",
    "kommunismus": "Kommunismus",
    "kommunismus (?)": "Kommunismus",
    "anarchismus": "Anarchismus",
    "anarchsimus": "Anarchismus",
    "autonom": "Autonome",
    "autonome": "Autonome",
    "bewegung": "Bewegung",
    "lit": "Literatur",
    "literatur": "Literatur",
    "19 jh": "19. Jh.",
    "19 jh.": "19. Jh.",
    "19. jh": "19. Jh.",
    "19 jhdt": "19. Jh.",
    "19 jah": "19. Jh.",
    "19 jahdt": "19. Jh.",
    "20 jhdt": "20. Jh.",
    "20. jhdt": "20. Jh.",
    "20 jahdt": "20. Jh.",
    "20 jhadt": "20. Jh.",
    "20. jahrh.": "20. Jh.",
    "vor 1918": "Vor 1918",
    "vor 1800": "Vor 1800",
    "jugo": "Jugoslawien",
    "su": "Sowjetunion",
    "gb": "Großbritannien",
    "gr": "Griechenland",
    "griechenland": "Griechenland",
    "afri": "Afrika",
    "afrika": "Afrika",
    "antira": "Antirassismus",
    "antisemitismus": "Antisemitismus",
    "ak-bibliothek": "AK-Bibliothek",
    "ak-biblio": "AK-Bibliothek",
    "bücherei": "Bibliothek",
    "bibliothek": "Bibliothek",
    "stadtbibliothek": "Bibliothek",
    "sonst": "Sonstiges",
}

ABBR = {
    "st.",
    "bd.",
    "hg.",
    "jg.",
    "nr.",
    "vol.",
    "no.",
    "jr.",
    "dr.",
    "prof.",
    "aufl.",
    "bde.",
    "ca.",
    "u.a.",
    "d.",
    "v.",
    "w.",
    "g.",
    "a.",
    "m.",
    "f.",
    "h.",
    "b.",
    "c.",
    "t.",
    "j.",
    "s.",
    "e.",
    "r.",
    "o.",
    "p.",
    "l.",
    "n.",
}

PUB_CUE = re.compile(r"^[A-ZÄÖÜ][^:]{0,45}?\s*[:,]\s*\S")


def norm_shelf(s: str) -> str:
    if not s:
        return ""
    return SHELF_MAP.get(s.strip().lower(), s.strip())


def read_table(odt_path: Path) -> list[dict]:
    """Return raw rows ``{raw, shelf, note}`` from the ODT table."""
    with zipfile.ZipFile(odt_path) as zf:
        data = zf.read("content.xml").decode("utf-8")
    rows = re.findall(r"<table:table-row.*?</table:table-row>", data, re.S)

    def cell_text(cell: str) -> str:
        c = re.sub(r"<text:tab/>", " ", cell)
        c = re.sub(r"</text:p>", "\n", c)
        c = re.sub(r"<[^>]+>", "", c)
        return re.sub(r"[ \t]+", " ", html.unescape(c)).strip().replace("\n", " ")

    records = []
    for row in rows[1:]:  # skip header row
        cells = re.findall(r"<table:table-cell.*?</table:table-cell>", row, re.S)
        if len(cells) < 3:
            continue
        raw = cell_text(cells[0]).strip()
        if not raw:
            continue
        records.append(
            {"raw": raw, "shelf": cell_text(cells[1]), "note": cell_text(cells[2])}
        )
    return records


def smart_period_split(text: str) -> list[str]:
    """Split on '. ' but not after abbreviations, initials, or years."""
    segs, last = [], 0
    for m in re.finditer(r"\.(\s+)", text):
        pre = text[last : m.start()]
        word = pre.split()[-1] if pre.split() else ""
        if (word + ".").lower() in ABBR or re.fullmatch(
            r"[A-Za-zÄÖÜäöü]|\d{1,4}", word
        ):
            continue
        segs.append(text[last : m.start() + 1])
        last = m.end()
    segs.append(text[last:])
    return [s.strip() for s in segs if s.strip()]


def parse_entry(raw: str) -> dict:
    s = raw.strip()
    out = {
        "authors": [],
        "editors": False,
        "year": None,
        "title": "",
        "subtitle": "",
        "place": "",
        "publisher": "",
        "confidence": "high",
    }
    title_block = s
    ym = re.search(r"\((\d{4})[a-z]?\)", s)
    if ym:
        out["year"] = int(ym.group(1))
        before, after = s[: ym.start()].strip(), s[ym.end() :].strip()
        if after.startswith(":"):  # "(Year):" => text before is the author block
            if "(Hg" in before or "(Hrsg" in before:
                out["editors"] = True
            before = re.sub(r"\s*\((?:Hg|Hrsg)[^)]*\)\s*", "", before).strip()
            out["authors"] = _split_authors(before)
            title_block = after[1:].strip()
        else:  # "(Year)." => anonymous / institutional work
            title_block = (before + " " + after.lstrip(".").strip()).strip()
    else:
        mby = re.match(r"^(.{2,70}?)\s*\(?(?:Hg|Hrsg)?\)?\s*(\d{4})\)?\s*:\s+(.*)$", s)
        if mby and (
            "," in mby.group(1) or " / " in mby.group(1) or "(Hg" in mby.group(1)
        ):
            au = mby.group(1)
            out["editors"] = "(Hg" in au or "(Hrsg" in au
            au = re.sub(r"\s*\((?:Hg|Hrsg)[^)]*\)\s*", "", au).strip()
            out["authors"] = _split_authors(au)
            out["year"] = int(mby.group(2))
            title_block = mby.group(3).strip()
        else:
            m = re.match(r"^([A-ZÄÖÜ][^.:()]{1,60}?):\s+(.*)$", s)
            if m and ("," in m.group(1) or " / " in m.group(1)):
                out["authors"] = _split_authors(m.group(1))
                title_block = m.group(2).strip()
            else:
                out["confidence"] = "low"

    place, publisher, title_block = _extract_imprint(title_block)
    out["place"], out["publisher"] = place, publisher

    tb = re.split(r"\s+:\s+", title_block.strip().rstrip("."), maxsplit=1)
    out["title"] = tb[0].strip().rstrip(".").strip()
    if len(tb) > 1:
        out["subtitle"] = tb[1].strip().rstrip(".").strip()
    if not out["authors"] and out["confidence"] == "high":
        out["confidence"] = "medium"
    if not out["title"]:
        out["confidence"] = "low"
    return out


def _extract_imprint(title_block: str) -> tuple[str, str, str]:
    """Split a trailing ``Place : Publisher`` off the title block.

    Returns ``(place, publisher, remaining_title_block)``.  When no plausible
    imprint is found the title block is returned unchanged.
    """
    segs = smart_period_split(title_block.strip())
    if len(segs) < 2:
        return "", "", title_block
    tail = segs[-1].rstrip(".,").strip()
    if not (PUB_CUE.match(tail) and len(tail) < 80):
        return "", "", title_block
    parts = re.split(r"\s*[:,]\s*", tail, maxsplit=1)
    place = parts[0].strip()
    publisher = parts[1].strip().rstrip(",.").strip() if len(parts) > 1 else ""
    return place, publisher, " ".join(segs[:-1])


def _split_authors(block: str) -> list[str]:
    return [
        a.strip().rstrip(",").strip() for a in re.split(r"\s*/\s*", block) if a.strip()
    ]


def build(odt_path: Path, out_path: Path) -> None:
    seen, out = set(), []
    for r in read_table(odt_path):
        raw = r["raw"]
        key = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]  # noqa: S324
        if key in seen:
            continue
        seen.add(key)
        p = parse_entry(raw)
        out.append(
            {
                "import_key": key,
                "title": p["title"] or raw.rstrip("."),
                "subtitle": p["subtitle"],
                "authors": p["authors"],
                "editors": p["editors"],
                "year": p["year"],
                "publisher": p["publisher"],
                "place": p["place"],
                "shelf": norm_shelf(r["shelf"]),
                "isbn": "",
                "language": "",
                "note": r["note"],
                "confidence": p["confidence"],
                "raw_citation": raw,
            }
        )
    out_path.write_text(
        json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"wrote {len(out)} records to {out_path}")  # noqa: T201


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    src = Path(sys.argv[1])
    dest = (
        Path(sys.argv[2])
        if len(sys.argv) > 2
        else Path(__file__).with_name("biblio_books.json")
    )
    build(src, dest)
