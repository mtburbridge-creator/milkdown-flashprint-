import type { PageBox } from './types'

import { splitTables } from './split'

/// Lays a clone of `doc` out as the paged flow and hands it to `read`. The
/// clone is one content column wide, and every overflow column is a page.
///
/// The clone keeps the inline `--fp-*` variables and the `fp-doc` class, so
/// `print.css` applies to it exactly as it applies to the preview. Tables
/// split across pages first when the document compresses its blocks, so
/// the repeated header rows count toward the pages.
function withPagedClone<T>(
  doc: HTMLElement,
  box: PageBox,
  read: (clone: HTMLElement) => T
): T {
  const columnWidth = box.contentWidthPx
  const clone = doc.cloneNode(true) as HTMLElement
  clone.classList.add('fp-paged')
  clone.style.setProperty('--fp-content-w', `${columnWidth}px`)
  clone.style.setProperty('--fp-content-h', `${box.contentHeightPx}px`)

  // The host sits on the body, never inside a transformed ancestor. A
  // transform would scale every rectangle this function reads.
  const host = document.createElement('div')
  host.style.cssText =
    'position:absolute;left:0;top:0;visibility:hidden;pointer-events:none;' +
    `width:${columnWidth}px;`
  host.appendChild(clone)
  document.body.appendChild(host)

  try {
    if (doc.dataset.compress === 'true') splitTables(clone, columnWidth)
    return read(clone)
  } finally {
    host.remove()
  }
}

/// Count the printed pages of a document without printing it.
///
/// Chromium fragments print output and CSS multi-column layout with the same
/// engine. A clone laid out in a multicol box one content column wide
/// therefore breaks at the same places as the printer, and the overflow
/// columns are the pages.
export function measurePages(doc: HTMLElement, box: PageBox): number {
  const columnWidth = box.contentWidthPx
  if (columnWidth <= 0) return 1

  return withPagedClone(doc, box, (clone) => {
    const left = clone.getBoundingClientRect().left
    let lastColumn = 0
    for (const el of clone.querySelectorAll('*')) {
      // Every fragment counts. A code block that runs onto a new page has
      // no element that starts there, only its own second fragment.
      for (const rect of el.getClientRects()) {
        if (rect.width === 0 || rect.height === 0) continue
        // Read the column from the left edge, not the right one. An image
        // wider than the column overflows to the right and would otherwise
        // count as an extra page.
        const column = Math.floor((rect.left - left + 1) / columnWidth)
        if (column > lastColumn) lastColumn = column
      }
    }
    return Math.max(1, lastColumn + 1)
  })
}

/// Settles the document at its current compaction for the sheet builder.
/// Tables split across pages move into `doc` itself when it compresses
/// its blocks. Returns the font size of the smallest table in pixels, or
/// `null` for a document without tables.
export function settleDocument(doc: HTMLElement, box: PageBox): number | null {
  if (box.contentWidthPx <= 0) return null

  return withPagedClone(doc, box, (clone) => {
    let smallest: number | null = null
    for (const table of clone.querySelectorAll('table')) {
      const size = parseFloat(getComputedStyle(table).fontSize)
      if (Number.isFinite(size) && (smallest === null || size < smallest))
        smallest = size
    }
    if (doc.dataset.compress === 'true')
      doc.replaceChildren(...clone.childNodes)
    return smallest
  })
}
