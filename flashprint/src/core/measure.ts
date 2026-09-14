import type { PageBox } from './types'

/// Count the printed pages of a document without printing it.
///
/// Chromium fragments print output and CSS multi-column layout with the same
/// engine. A clone laid out in a multicol box one content column wide
/// therefore breaks at the same places as the printer, and the overflow
/// columns are the pages.
///
/// The clone keeps the inline `--fp-*` variables and the `fp-doc` class, so
/// `print.css` applies to it exactly as it applies to the preview.
export function measurePages(doc: HTMLElement, box: PageBox): number {
  const columnWidth = box.contentWidthPx
  if (columnWidth <= 0) return 1

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
    const left = clone.getBoundingClientRect().left
    let lastColumn = 0
    for (const el of clone.querySelectorAll('*')) {
      const rect = el.getBoundingClientRect()
      if (rect.width === 0) continue
      // Read the column from the left edge, not the right one. An image
      // wider than the column overflows to the right and would otherwise
      // count as an extra page.
      const column = Math.floor((rect.left - left + 1) / columnWidth)
      if (column > lastColumn) lastColumn = column
    }
    return Math.max(1, lastColumn + 1)
  } finally {
    host.remove()
  }
}
