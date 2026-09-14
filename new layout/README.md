# Handoff: FlashPrint "Dock" redesign (option 1c)

## Overview
Restyle and re-layout the FlashPrint app (`flashprint/src/app` in `mtburbridge-creator/milkdown-flashprint-`) as a dark slate + brass interface with a parchment document area. The editor and a large sheet preview sit side by side at full height; all fit controls move from the right-hand panel into a single bottom dock.

## About the Design Files
The `.dc.html` files in this bundle are **design references built in HTML**. They are static mockups of the intended look, not production code. Recreate them inside the existing Vue 3 + TSX app (`app.tsx`, `controls.tsx`, `preview.tsx`, `app.css`) using its current patterns. Keep all existing behaviour (Crepe editor, refit controller, localStorage settings, print root, drop overlay) unchanged; this is a chrome and layout change.

## Fidelity
**High-fidelity.** Colors, spacing, type, and layout below are final. Match them exactly.

## Source of truth in the mockup
`FlashPrint Redesign.dc.html`, the frame with `id="1c"` (badge "1c Dock"). Everything else in that file (1a, 1b, and the "Current" recreation) is for comparison only.

## Screen: App shell (1440 × 900 reference)
`.app-shell` stays `display:flex; flex-direction:column; height:100dvh`. Background `#2c3541`, default text `#c9a66b`, font `Noto Sans`.

### Top bar (`.top-bar`)
- Height 52px, padding `0 20px`, background `#28303b`, bottom border `1px solid rgba(201,166,107,.22)`.
- `display:grid; grid-template-columns: 1fr auto 1fr; align-items:center`.
- **Left cell**: wordmark "FlashPrint" in `Noto Serif` 600 18px `#e3c27e`; gap 14px; then the loaded file name (or nothing if pasted) in 12px `#a9945f`.
- **Center cell — status pill**: `display:flex; gap:8px; padding:5px 14px; border-radius:999px; background:#1f262e; border:1px solid rgba(201,166,107,.3); font-size:12px; color:#e3c27e; white-space:nowrap`. Leading 7px dot `#c9a66b`. Text is the existing `formatStatus()` output, e.g. `4 pages on 2 sheets` with the ` · font 13.5px · line 1.4` tail in `#a9945f`. Warning state (target not reached): dot and text `#e0895a`.
- **Right cell** (`justify-content:flex-end; gap:6px`): ghost buttons "Paste", "Open .md", "Clear" — `font-size:13px; padding:6px 12px; border:none; border-radius:6px; background:transparent; color:#c9a66b`; hover `background:rgba(201,166,107,.1)`. Then primary "Print" — `font-weight:700; padding:7px 18px; margin-left:6px; border-radius:6px; background:#c9a66b; color:#1f262e; box-shadow:0 0 0 1px #e3c27e inset`; hover `background:#e3c27e`.

### Body split (`.body-split`)
`display:flex; flex:1; min-height:0`. Two children, no side pane.

**Editor pane** (`.editor-pane`)
- `flex:0 0 55%` (792px at 1440), `min-width:0; box-sizing:border-box; overflow-y:auto`.
- Background parchment `#f1e7d3`. Editor padding: `.fp-editor .milkdown .ProseMirror { padding: 48px 80px }`.
- Override Crepe frame theme variables on `.fp-editor .milkdown`:
  - `--crepe-color-background: #f1e7d3`
  - `--crepe-color-on-background: #2a2420`
  - `--crepe-color-primary: #3b2f1e` (headings via `h1–h6 { color: #3b2f1e }`)
  - `--crepe-color-outline: #9a8a6e` (list bullets/numbers, checkbox borders)
  - `--crepe-color-selected: #b8945a` (blockquote bar)
  - `--crepe-color-inline-area: #e6dabf` (code / pre backgrounds; set pre/code background directly to `#e6dabf` rather than the color-mix)
  - `--crepe-color-inline-code: #8a4a1c`
  - table cell borders `1px solid #d6c9ad`
- Optional: a 60px fade at the bottom of the pane, `linear-gradient(rgba(241,231,211,0), #f1e7d3)`, positioned absolute over the scroll area.

**Preview pane** (`.preview-pane-wrapper` / `.preview-pane`)
- `flex:1; min-width:0`, background `#232b35`, `border-left:1px solid rgba(201,166,107,.22)`, padding `28px 32px`, `overflow-y:scroll; scrollbar-gutter:stable` (keep the existing stable-gutter comment/reasoning).
- Sheets scale to the pane's content width exactly as today (`preview.tsx` logic unchanged). At 1440 this yields ≈585px wide sheets.
- Sheet shadow: `0 4px 24px rgba(0,0,0,.55)`. Sheet paper on screen: `#f7f1e3`; two-up fold line `1px dashed #c9b995`. (Print output stays white — keep `@media print` untouched.)
- Vertical gap between sheet groups 26px. Caption (`.preview-caption`): 11px, `#a9945f`, `letter-spacing:.06em; text-transform:uppercase`, 8px below sheet, text "Sheet n of total".

### Bottom dock (replaces `.controls-panel`)
- `flex-shrink:0; height:76px; background:#1f262e; border-top:1px solid rgba(201,166,107,.3); display:flex; align-items:center; gap:28px; padding:0 24px`.
- Each control is a column: label + control, `gap:5px`. Label: 10px 600 `#a9945f`, `letter-spacing:.08em; text-transform:uppercase`.
- **Segmented control** style (shared): `display:flex; border:1px solid rgba(201,166,107,.35); border-radius:6px; overflow:hidden; font-size:12px`. Segment: `padding:5px 12px; color:#c9a66b`, segments after the first get `border-left:1px solid rgba(201,166,107,.2)`. Selected segment: `background:#c9a66b; color:#1f262e; font-weight:600`. Hover on unselected: `background:rgba(201,166,107,.1)`.
- Controls, left to right (same settings paths as `controls.tsx`):
  1. **Layout** — segments "Two-up" / "Single" → `settings.page.layout` (`two-up` | `single`). Still call `applyLayoutSuggestions` on change.
  2. **Paper** — segments "Letter" / "A4" / "Legal" → `settings.page.paper` (replaces the `<select>`).
  3. **Margin** — stepper: `−` button, value cell (`padding:5px 10px; color:#e3c27e; background:#28303b; min-width:52px; text-align:center`, shows `0.5 in`), `+` button; step 0.05, min 0.2, max 1.5 → `settings.page.marginIn`; mark `touched 'page.marginIn'`.
  4. **Round pages to** — segments "None" / "Even" / "×4" / "Exact [n]" → `settings.fit.rounding`; mark `touched 'fit.rounding'`. The Exact segment embeds a small number input (`width:26px; border:1px solid rgba(201,166,107,.3); border-radius:4px; font-size:11px; text-align:center`), disabled (color `#8a7a56`) unless rounding is `exact`; value → `settings.fit.exactPages`.
  5. **Font px · min / base** — two number cells styled like the margin value cell (`min-width:44px`), separated by `→` in `#a9945f`; min 6–16 step .5 → `fit.minFontPx` (keep the max ≥ min clamp), base 10–24 step .5 → `fit.maxFontPx`. Show the pt hint (`minFontPx × 0.75`) as a title/tooltip.
  6. **Page numbers** — pushed right with `margin-left:auto`; label 12px `#c9a66b` then a toggle: track `34×20px; border-radius:999px; background:#c9a66b` (off: `rgba(201,166,107,.25)`), knob `14px` circle `#1f262e`, `top:3px`, right 3px when on / left 3px when off. → `settings.page.pageNumbers`.
- The print-dialog tips paragraph moves to a `title` on the Print button (or a small "?" popover) — it has no home in the dock.

### Drop overlay
Keep behaviour; recolor: `background: rgba(201,166,107,.12); border: 3px dashed #c9a66b; color: #e3c27e`.

### Responsive (`max-width: 900px`)
Stack editor above preview as today (`flex-direction:column`), editor `55vh`, preview `60vh`. Dock becomes `height:auto; flex-wrap:wrap; gap:16px 24px; padding:12px 16px`; the Page numbers toggle drops `margin-left:auto`.

## Interactions & Behavior
- All handlers are the existing ones from `app.tsx` / `controls.tsx`; only the widgets change (radio → segmented, select → segmented, number inputs → stepper/cells, checkbox → toggle).
- Segments and toggle animate `background-color 120ms ease`.
- Focus-visible on any dock control: `outline: 2px solid #e3c27e; outline-offset: 2px`.
- Status pill text updates on every fit result exactly as `statusText` does now.

## State Management
Unchanged: `settings` (reactive, persisted via `saveSettings`), `touched`, `fitResult`, `clipboardHint`, `dragActive`, `previewSheets`.

## Design Tokens (replace `:root` in `app.css`)
```
--fp-bg: #2c3541          /* shell */
--fp-bg-raised: #28303b   /* top bar */
--fp-bg-deep: #232b35     /* preview pane */
--fp-bg-dock: #1f262e     /* dock, pills, value cells */
--fp-border: rgba(201,166,107,.22)
--fp-border-strong: rgba(201,166,107,.35)
--fp-text: #c9a66b        /* brass */
--fp-text-bright: #e3c27e
--fp-text-muted: #a9945f
--fp-text-disabled: #8a7a56
--fp-accent: #c9a66b
--fp-accent-text: #1f262e
--fp-warning: #e0895a
--fp-paper: #f1e7d3       /* editor parchment */
--fp-sheet: #f7f1e3       /* preview sheet on screen */
--fp-ink: #2a2420
--fp-shadow: 0 4px 24px rgba(0,0,0,.55)
```
Type: Noto Sans (UI, 10/11/12/13px), Noto Serif 600 18px (wordmark). Radii: 6px controls, 999px pills/toggle. Fonts are already loaded in `index.html`.

## Screenshots
- `screenshots/1c-dock-full.png` — full 1440×900 frame
- `screenshots/1c-top-bar.png` — top bar at 2×
- `screenshots/1c-dock-controls.png` — bottom dock at 2×

## Assets
None. No icons or images; the status dot and toggle are CSS.

## Files
- `FlashPrint Redesign.dc.html` — mockup; use frame `#1c`. Also contains 1a, 1b and a recreation of the current UI for reference.
- `FpDoc.dc.html` — static stand-in for the Crepe editor content (sample markdown). Not to be implemented; the real editor renders this.
- `FpSheet.dc.html` — static stand-in for one two-up preview sheet. Not to be implemented; `core/render.ts` produces the real sheets.
