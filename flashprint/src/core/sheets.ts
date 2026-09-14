import type { PageBox, PageSettings } from './types'

import { sheetsFor } from './paper'

/// Options for the sheet builders.
export interface SheetOptions {
  /// Upper bound on the pages that get a rendered clone. Every page clones
  /// the whole document, so a long document at many pages multiplies its
  /// own layout cost. Pages past the bound are left out of the sheets.
  maxPages?: number
  /// Set `aborted` to stop an asynchronous build between chunks.
  signal?: { aborted: boolean }
  /// Pages built between two pauses of the asynchronous build.
  chunk?: number
}

const DEFAULT_CHUNK = 6

function setGeometry(root: HTMLElement, box: PageBox): void {
  const { style } = root
  style.setProperty('--fp-sheet-w', `${box.sheetWidthPx}px`)
  style.setProperty('--fp-sheet-h', `${box.sheetHeightPx}px`)
  style.setProperty('--fp-page-w', `${box.pageWidthPx}px`)
  style.setProperty('--fp-page-h', `${box.pageHeightPx}px`)
  style.setProperty('--fp-margin', `${box.marginPx}px`)
  style.setProperty('--fp-content-w', `${box.contentWidthPx}px`)
  style.setProperty('--fp-content-h', `${box.contentHeightPx}px`)
}

function buildPage(
  doc: HTMLElement,
  box: PageBox,
  index: number,
  pages: number,
  settings: PageSettings
): HTMLElement {
  const page = document.createElement('div')
  page.className = 'fp-page'
  // A two-up sheet with an odd page count ends on a blank page. It still
  // needs the element, so the sheet keeps its shape.
  if (index >= pages) return page

  page.dataset.page = `${index + 1}`

  const view = document.createElement('div')
  view.className = 'fp-window'
  const clone = doc.cloneNode(true) as HTMLElement
  clone.classList.add('fp-paged')
  // Every page shows the same multicol flow, shifted by whole columns. The
  // geometry must match the one `measurePages` counted with.
  clone.style.transform = `translateX(-${index * box.contentWidthPx}px)`
  view.appendChild(clone)
  page.appendChild(view)

  if (settings.pageNumbers) {
    const number = document.createElement('div')
    number.className = 'fp-page-number'
    number.textContent = `${index + 1} / ${pages}`
    page.appendChild(number)
  }

  return page
}

interface SheetPlan {
  root: HTMLElement
  /// Pages that get a clone. Page numbers still count to `total`.
  rendered: number
  total: number
  sheets: number
}

function planSheets(
  box: PageBox,
  pages: number,
  settings: PageSettings,
  options: SheetOptions
): SheetPlan {
  const root = document.createElement('div')
  root.className = 'fp-sheets'
  root.dataset.layout = settings.layout
  setGeometry(root, box)

  const total = Math.max(1, Math.floor(pages))
  const rendered = Math.min(total, Math.max(1, options.maxPages ?? total))
  return { root, rendered, total, sheets: sheetsFor(rendered, box) }
}

function appendSheet(
  plan: SheetPlan,
  doc: HTMLElement,
  box: PageBox,
  sheet: number,
  settings: PageSettings
): void {
  const element = document.createElement('div')
  element.className = 'fp-sheet'
  for (let slot = 0; slot < box.pagesPerSheet; slot += 1) {
    const index = sheet * box.pagesPerSheet + slot
    const pages = index < plan.rendered ? plan.total : 0
    element.appendChild(buildPage(doc, box, index, pages, settings))
  }
  plan.root.appendChild(element)
}

/// Lay the document out on sheets. The preview and the print share this
/// markup, so what a person sees is what the printer receives.
export function buildSheets(
  doc: HTMLElement,
  box: PageBox,
  pages: number,
  settings: PageSettings,
  options: SheetOptions = {}
): HTMLElement {
  const plan = planSheets(box, pages, settings, options)
  for (let sheet = 0; sheet < plan.sheets; sheet += 1)
    appendSheet(plan, doc, box, sheet, settings)
  return plan.root
}

/// `buildSheets` in chunks with a pause between them. The root is handed
/// back at once and fills in over time, so a caller can show it early.
/// Resolves to the root, or to `null` when the signal aborted the build.
export async function buildSheetsAsync(
  doc: HTMLElement,
  box: PageBox,
  pages: number,
  settings: PageSettings,
  options: SheetOptions = {},
  onRoot?: (root: HTMLElement) => void
): Promise<HTMLElement | null> {
  const plan = planSheets(box, pages, settings, options)
  onRoot?.(plan.root)
  const chunk = Math.max(1, options.chunk ?? DEFAULT_CHUNK)
  for (let sheet = 0; sheet < plan.sheets; sheet += 1) {
    if (sheet > 0 && sheet % chunk === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0))
      if (options.signal?.aborted) return null
    }
    appendSheet(plan, doc, box, sheet, settings)
  }
  return plan.root
}
