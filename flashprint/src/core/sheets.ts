import type { PageBox, PageSettings } from './types'

import { sheetsFor } from './paper'

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

/// Lay the document out on sheets. The preview and the print share this
/// markup, so what a person sees is what the printer receives.
export function buildSheets(
  doc: HTMLElement,
  box: PageBox,
  pages: number,
  settings: PageSettings
): HTMLElement {
  const root = document.createElement('div')
  root.className = 'fp-sheets'
  root.dataset.layout = settings.layout
  setGeometry(root, box)

  const total = Math.max(1, Math.floor(pages))
  const sheets = sheetsFor(total, box)
  for (let sheet = 0; sheet < sheets; sheet += 1) {
    const element = document.createElement('div')
    element.className = 'fp-sheet'
    for (let slot = 0; slot < box.pagesPerSheet; slot += 1) {
      const index = sheet * box.pagesPerSheet + slot
      element.appendChild(buildPage(doc, box, index, total, settings))
    }
    root.appendChild(element)
  }

  return root
}
