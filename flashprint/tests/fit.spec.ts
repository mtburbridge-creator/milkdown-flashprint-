import { expect, test, type Page } from '@playwright/test'

import { countPdfPages } from './pdf'

async function waitForSheets(page: Page) {
  await page.waitForSelector('#fp-print-root .fp-sheet', { state: 'attached' })
  await page.waitForFunction(() => document.fonts.status === 'loaded')
}

/// The printed PDF must have exactly one page per rendered sheet, and the
/// last rendered page must hold the end of the document.
async function expectPrintMatchesPreview(page: Page) {
  await waitForSheets(page)
  const sheets = await page.locator('#fp-print-root .fp-sheet').count()
  const pages = await page.locator('#fp-print-root .fp-page').count()
  const lastPageHasContent = await page.evaluate(() => {
    const root = document.querySelector('#fp-print-root')
    const pageEls = root ? [...root.querySelectorAll('.fp-page')] : []
    const filled = pageEls.filter((el) => el.querySelector('.fp-doc'))
    const last = filled[filled.length - 1]
    if (!last) return false
    const window = last.querySelector('.fp-window')
    const doc = last.querySelector('.fp-doc')
    if (!window || !doc) return false
    const w = window.getBoundingClientRect()
    let visible = false
    for (const el of doc.querySelectorAll('p, li, pre, td, th, h1, h2, h3')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0) continue
      if (r.left >= w.left - 1 && r.right <= w.right + 1) visible = true
    }
    return visible
  })
  expect(lastPageHasContent).toBe(true)

  await page.emulateMedia({ media: 'print' })
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true })
  await page.emulateMedia({ media: 'screen' })
  expect(countPdfPages(pdf)).toBe(sheets)
  return { sheets, pages }
}

test('two-up sample document prints one PDF page per sheet', async ({
  page,
}) => {
  await page.goto('/')
  const { sheets, pages } = await expectPrintMatchesPreview(page)
  expect(pages).toBe(sheets * 2)
})
