# FlashPrint

FlashPrint takes pasted markdown, fits it to a target page count, and prints
it. Paste or drop a document into the Crepe editor, pick a page target, and
the app shrinks font size and spacing until the printed page count matches,
with a live paged preview and two-up landscape printing to halve the paper
you use.

## Run it

```sh
pnpm --filter=@milkdown/flashprint start
```

This starts a dev server, by default on `http://localhost:5173`.

## How fitting works

The preview measures a full render of the document in a hidden, unscaled
box and reads its layout with the same multi-column pagination Chromium
uses when it prints, so the page count on screen matches the printed page
count. A compaction ladder shrinks paragraph and heading spacing before it
shrinks the font, since tighter spacing reads better than a smaller
typeface. A binary search over that ladder finds the tightest setting that
still hits the requested page count, or reports the closest it could reach
at the minimum font size.

## Printing

In the print dialog, choose Landscape for two-up printing (or Portrait for
one page per sheet), set Margins to None, Scale to 100%, and turn off
headers and footers. FlashPrint sets the page size itself through an
injected `@page` rule, so the browser's paper size setting does not matter.

## Deployment

A push to `main` builds and deploys this app to GitHub Pages at
`https://<owner>.github.io/milkdown-flashprint-/`.
