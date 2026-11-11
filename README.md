# UV book

A book on a black background lit by blacklight: the ink glows blue and the pages carry pink light from the spine and the edge.

Serve the folder (see Previewing below) and open `index.html`. Click the right page to turn it; click the left page (or press the left arrow) to turn it back.

## Adding and changing pages

The pages are edited in the **"UV Book pages" Google Sheet**, in the *UV Book* folder on Google Drive. One row per page:

| Page | Type | Text | Photo file name | Caption | Photo description |
|---|---|---|---|---|---|
| 124 | text | paragraphs, blank line between them, `*stars*` for italics | | | |
| 125 | photo | | `beach.jpg` | the caption under the photo | what the photo shows, for screen readers |

Photos go in the same Drive folder as the sheet; the file name in the row must match. Rows can be in any order (they are sorted by page number), and a skipped number becomes a blank page.

**Syncing:** the sheet is copied into `content/book.md` and the test link is rebuilt by exporting it as CSV, copying the photos into `assets/`, and running

```
python3 tools/sheet_to_book.py pages.csv
python3 tools/build_single_file.py
```

The book itself reads only `content/book.md`. Add as many pages as you like and the book turns through all of them.

- A line with just `---` starts the next page. Pages alternate left, right, left, right, starting on a left page.
- `start: 120` at the top sets the first page number; the rest count up from it.
- **Text page:** paragraphs separated by a blank line. `*asterisks*` make italics.
- **Photo page:** one line,

  ```
  ![caption under the photo](assets/my-photo.jpg "what the photo shows, for screen readers")
  ```

  Put the photo file in `assets/`. Any shape works: it is cropped from the centre to fill the frame. Every photo page uses the same frame (`PHOTO_FRAME` in `main.js`): a 3:4 window with a glowing ink border, bent along the page's curve, with the caption underneath.

## Previewing

The page loads `content/book.md`, so it needs a local web server rather than opening the file directly:

```
python3 -m http.server 8000
```

then open http://localhost:8000.

## Shareable single file

`python3 tools/build_single_file.py` bundles the page, styles, script and contents into `dist/uv-book.html` and lists the photos it uses (it stops with an error if a photo is missing). Publish that file with the `assets/` photos next to it.

## Lamp colours

The round swatches in the bottom-right corner switch the neon lamp between three palettes: **Prism**, **Sunset** and **Aura**. The choice is remembered in the browser. To open the page with a particular lamp (for example in a Framer embed), add it to the address: `?lamp=sunset` or `?lamp=aura`. Palettes are defined in `LAMP_THEMES` in `main.js`.
