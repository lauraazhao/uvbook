#!/usr/bin/env python3
"""Bundle the book into one HTML file (for the shareable test link).

    python3 tools/build_single_file.py [out.html]

Inlines styles.css, main.js and content/book.md into a single page, and prints
the photos it uses (they are published next to the page under assets/).
"""
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
out = Path(sys.argv[1]) if len(sys.argv) > 1 else root / "dist" / "uv-book.html"

page = (root / "index.html").read_text()
css = (root / "styles.css").read_text()
js = (root / "main.js").read_text()
book = (root / "content" / "book.md").read_text()

head = page[page.index("<head>") + 6 : page.index("</head>")]
head = re.sub(
    r'\s*<meta charset[^>]*>|\s*<meta name="viewport"[^>]*>|\s*<title>.*?</title>|\s*<link rel="stylesheet" href="styles.css" />',
    "",
    head,
)
body = page[page.index("<body>") + 6 : page.index("</body>")]
body = body.replace(
    '<script type="module" src="main.js"></script>',
    '<script type="text/markdown" id="book-content">\n'
    + book.replace("</script", "<\\/script")
    + "\n</script>\n<script type=\"module\">\n"
    + js
    + "\n</script>",
)

out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(
    '<title>UV Book</title>\n<meta name="claude:viewport-fit-sides" content="cover">'
    + head
    + "<style>\n"
    + css
    + "\n</style>\n"
    + body
)

photos = sorted(set(re.findall(r"!\[[^\]]*\]\(\s*([^\s)]+)", re.sub(r"<!--.*?-->", "", book, flags=re.S))))
missing = [p for p in photos if not (root / p).exists()]
print(f"wrote {out}")
for p in photos:
    print(("MISSING " if p in missing else "photo   ") + p)
sys.exit(1 if missing else 0)
