# UV book

A book on a black background lit by blacklight: the ink glows blue and the pages carry pink light from the spine and the edge.

Open `index.html` in a browser (no build step). Click the right page to turn it; click the left page (or press the left arrow) to turn it back.

## Adding and changing pages

Everything in the book lives in one file: **`content/book.md`**. Edit it and the book updates; no code changes needed. Add as many pages as you like and the book turns through all of them.

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
