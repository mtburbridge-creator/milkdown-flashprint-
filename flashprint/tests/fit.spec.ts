import { expect, test, type Page } from '@playwright/test'

import { countPdfPages } from './pdf'

const STATUS =
  /(\d+) pages? on (\d+) sheets?(?: · font ([\d.]+)px · line ([\d.]+))?/

async function waitForFit(page: Page) {
  await page.waitForSelector('#fp-print-root .fp-sheet', { state: 'attached' })
  await page.waitForFunction(() => document.fonts.status === 'loaded')
  const status = await page.locator('.status-line').innerText()
  const match = STATUS.exec(status)
  expect(match, status).not.toBeNull()
  const [, pages, sheets, font, line] = match!
  return {
    pages: Number(pages),
    sheets: Number(sheets),
    font: font === undefined ? 16 : Number(font),
    line: line === undefined ? 1.5 : Number(line),
    text: status,
  }
}

/// The printed PDF must have one page per rendered sheet, and the last
/// rendered page must still hold document content.
async function expectPrintMatchesPreview(page: Page) {
  const status = await waitForFit(page)
  const sheets = await page.locator('#fp-print-root .fp-sheet').count()
  expect(sheets).toBe(status.sheets)

  const lastPageHasContent = await page.evaluate(() => {
    const root = document.querySelector('#fp-print-root')
    const pageEls = root ? [...root.querySelectorAll('.fp-page')] : []
    const filled = pageEls.filter((el) => el.querySelector('.fp-doc'))
    const last = filled[filled.length - 1]
    const frame = last?.querySelector('.fp-window')
    const doc = last?.querySelector('.fp-doc')
    if (!frame || !doc) return false
    // The print root is hidden on screen. Show it for the measurement.
    const host = root as HTMLElement
    const display = host.style.display
    host.style.display = 'block'
    const w = frame.getBoundingClientRect()
    let visible = false
    for (const el of doc.querySelectorAll('p, li, pre, td, th, h1, h2, h3')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0) continue
      if (r.left >= w.left - 1 && r.right <= w.right + 1) visible = true
    }
    host.style.display = display
    return visible
  })
  expect(lastPageHasContent).toBe(true)

  await page.emulateMedia({ media: 'print' })
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true })
  await page.emulateMedia({ media: 'screen' })
  expect(countPdfPages(pdf)).toBe(sheets)
  return status
}

function longMarkdown(sections: number): string {
  const para =
    'The quick brown fox jumps over the lazy dog while the committee ' +
    'reviews the quarterly figures and decides whether the proposal ' +
    'should move forward without further amendment. '
  const parts: string[] = ['# A long report\n']
  for (let i = 1; i <= sections; i += 1) {
    parts.push(`## Section ${i}\n\n${para.repeat(3)}\n`)
    parts.push(`- point one of section ${i}\n- point two\n- point three\n`)
    parts.push(`${para.repeat(2)}\n`)
    if (i % 3 === 0) {
      parts.push('```ts\n' + 'const x = compute(input)\n'.repeat(8) + '```\n')
    }
    if (i % 4 === 0) {
      parts.push('| Name | Value |\n| --- | --- |\n| a | 1 |\n| b | 2 |\n')
    }
  }
  return parts.join('\n')
}

test('two-up sample document prints one PDF page per sheet', async ({
  page,
}) => {
  await page.goto('/')
  const status = await expectPrintMatchesPreview(page)
  expect(status.font).toBe(16)
})

test('long document is shrunk to one page fewer than natural', async ({
  page,
}) => {
  const markdown = longMarkdown(14)
  await page.addInitScript((md: string) => {
    localStorage.setItem('flashprint:markdown', md)
    localStorage.setItem(
      'flashprint:settings',
      JSON.stringify({ fit: { rounding: 'none' } })
    )
  }, markdown)
  await page.goto('/')
  const natural = await waitForFit(page)
  expect(natural.pages).toBeGreaterThan(4)

  const target = natural.pages - 1
  // Init scripts run again on reload, in the order they were added, so
  // this one overrides the rounding set by the first.
  await page.addInitScript((exact: number) => {
    localStorage.setItem(
      'flashprint:settings',
      JSON.stringify({ fit: { rounding: 'exact', exactPages: exact } })
    )
  }, target)
  await page.reload()
  const status = await expectPrintMatchesPreview(page)
  const stored = await page.evaluate(() =>
    localStorage.getItem('flashprint:settings')
  )
  expect(status.pages, `${status.text} | ${stored}`).toBe(target)
  expect(status.font < 16 || status.line < 1.5).toBe(true)
})

test('single layout prints one page per sheet', async ({ page }) => {
  await page.addInitScript((markdown: string) => {
    localStorage.setItem('flashprint:markdown', markdown)
    localStorage.setItem(
      'flashprint:settings',
      JSON.stringify({
        page: { paper: 'letter', layout: 'single', marginIn: 0.7 },
        fit: { rounding: 'even', minFontPx: 10, maxFontPx: 16 },
      })
    )
  }, longMarkdown(6))
  await page.goto('/')
  const status = await expectPrintMatchesPreview(page)
  expect(status.pages).toBe(status.sheets)
  expect(status.pages % 2).toBe(0)
})

test('preview layout settles after a long document loads', async ({ page }) => {
  await page.addInitScript((md: string) => {
    localStorage.setItem('flashprint:markdown', md)
  }, longMarkdown(14))
  await page.goto('/')
  await waitForFit(page)
  await page.waitForTimeout(800)
  // A scrollbar that toggles as the sheet scale changes would keep
  // rewriting the scale box styles. Once settled, nothing may change.
  const mutations = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const box = document.querySelector('.preview-scale-box')
        const mount = document.querySelector('.preview-mount')
        if (!box || !mount) {
          resolve(-1)
          return
        }
        let count = 0
        const observer = new MutationObserver((records) => {
          count += records.length
        })
        observer.observe(box, { attributes: true })
        observer.observe(mount, { attributes: true })
        setTimeout(() => {
          observer.disconnect()
          resolve(count)
        }, 1500)
      })
  )
  expect(mutations).toBe(0)
  const overflow = await page.evaluate(() => {
    const pane = document.querySelector('.preview-pane') as HTMLElement
    return pane.scrollWidth - pane.clientWidth
  })
  expect(overflow).toBe(0)
})
