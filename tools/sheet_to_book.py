#!/usr/bin/env python3
"""Turn the "UV Book pages" Google Sheet (exported as CSV) into content/book.md.

    python3 tools/sheet_to_book.py pages.csv

Sheet columns, one row per page:
    Page | Type (text or photo) | Text | Photo file name | Caption | Photo description

- Rows are sorted by Page; the first page number becomes `start:`. A missing
  page number in the middle becomes a blank page so numbering stays right.
- Text: paragraphs separated by a blank line inside the cell; *stars* = italics.
- Photo: the file name of a photo kept in the same Drive folder as the sheet.
  It is expected in assets/ (the sync copies it there). Big photos are
  shrunk to at most 1800px on the long side to keep the page light.

Prints the photos the book needs and exits with an error if any are missing.
"""
import csv
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
book_path = root / "content" / "book.md"
assets = root / "assets"
MAX_SIDE = 1800


def cell(row, i):
    return (row[i] if i < len(row) else "").strip()


def main(csv_path):
    rows = list(csv.reader(open(csv_path, newline="", encoding="utf-8-sig")))
    pages = {}
    for row in rows[1:]:
        num = cell(row, 0)
        if not num:
            continue
        if not num.isdigit():
            sys.exit(f"Page number '{num}' is not a whole number")
        n = int(num)
        if n in pages:
            sys.exit(f"Page {n} appears twice in the sheet")
        # a photo file name makes it a photo page, whatever the Type says
        kind = "photo" if cell(row, 3) else (cell(row, 1).lower() or "text")
        if kind == "photo":
            photo = cell(row, 3)
            if not photo:
                sys.exit(f"Page {n} is a photo page but has no photo file name")
            caption, alt = cell(row, 4), cell(row, 5) or cell(row, 4)
            if '"' in alt:
                alt = alt.replace('"', "'")
            pages[n] = f'![{caption}](assets/{photo} "{alt}")' if alt else f"![{caption}](assets/{photo})"
        else:
            text = cell(row, 2).replace("\r\n", "\n")
            # a lone --- line would start a new page
            text = re.sub(r"^\s*---\s*$", "—", text, flags=re.M)
            pages[n] = re.sub(r"\n\s*\n+", "\n\n", text)
    if not pages:
        sys.exit("The sheet has no pages")

    start, end = min(pages), max(pages)
    current = book_path.read_text() if book_path.exists() else ""
    intro = re.match(r"\s*(<!--.*?-->)", current, re.S)
    hint = re.search(r"^hint:.*$", current, re.M)
    parts = [intro.group(1) if intro else "", "", f"start: {start}"]
    if hint:
        parts.append(hint.group(0))
    for n in range(start, end + 1):
        parts += ["", "---", "", pages.get(n, "")]
    book_path.write_text("\n".join(parts).lstrip("\n") + "\n")
    print(f"wrote {book_path.relative_to(root)}: pages {start}-{end}")

    missing = False
    for n in sorted(pages):
        m = re.match(r"!\[[^\]]*\]\(assets/([^\s)]+)", pages[n])
        if not m:
            continue
        f = assets / m.group(1)
        if not f.exists():
            print(f"MISSING page {n}: {f.name}")
            missing = True
            continue
        shrink(f)
        print(f"photo   page {n}: {f.name}")
    sys.exit(1 if missing else 0)


def shrink(path):
    try:
        from PIL import Image, ImageOps
    except ImportError:
        return
    im = Image.open(path)
    im = ImageOps.exif_transpose(im)
    if max(im.size) <= MAX_SIDE:
        return
    im.thumbnail((MAX_SIDE, MAX_SIDE))
    im.convert("RGB").save(path, quality=88, optimize=True)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
