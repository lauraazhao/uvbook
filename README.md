# UV book

A book on a black background lit by blacklight: the ink glows blue and the pages carry pink light from the spine and the edge.

Open `index.html` in a browser (no build step). Click the right page to turn it; click the left page (or press the left arrow) to turn it back.

## Photo pages

Any page can be a photo page instead of text. Put the image in `assets/` and give the page's section a `data-image` and an optional `data-caption`:

```html
<section data-page="124" data-side="left" aria-label="Page 124"
         data-image="assets/my-photo.jpg" data-caption="a short caption">
  <img src="assets/my-photo.jpg" alt="Describe the photo for screen readers." />
  <p>a short caption</p>
</section>
```

Every photo page uses the same frame (`PHOTO_FRAME` in `main.js`): a 3:4 window with a glowing ink border, bent along the page's curve, with the caption underneath. Photos of any shape are cropped from the centre to fill the frame.
