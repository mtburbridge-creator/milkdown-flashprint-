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
  await page.goto('.')
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
  await page.goto('.')
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
  await page.goto('.')
  const status = await expectPrintMatchesPreview(page)
  expect(status.pages).toBe(status.sheets)
  expect(status.pages % 2).toBe(0)
})

test('preview layout settles after a long document loads', async ({ page }) => {
  await page.addInitScript((md: string) => {
    localStorage.setItem('flashprint:markdown', md)
  }, longMarkdown(14))
  await page.goto('.')
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

test('a stored font size over the cap is clamped and the app still loads', async ({
  page,
}) => {
  await page.addInitScript((md: string) => {
    localStorage.setItem('flashprint:markdown', md)
    localStorage.setItem(
      'flashprint:settings',
      JSON.stringify({ fit: { minFontPx: 10, maxFontPx: 105 } })
    )
  }, longMarkdown(14))
  await page.goto('.')
  const status = await waitForFit(page)
  expect(status.pages).toBeGreaterThan(0)
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('flashprint:settings') ?? '{}')
  )
  expect(stored.fit.maxFontPx).toBe(25)
  // A value in progress is left alone. Only Enter or leaving the field
  // commits and caps it.
  const baseInput = page.locator('input[aria-label="Base font size in pixels"]')
  await baseInput.fill('1')
  await expect(baseInput).toHaveValue('1')
  await baseInput.type('05')
  await expect(baseInput).toHaveValue('105')
  await baseInput.press('Enter')
  await expect(baseInput).toHaveValue('25')
  const minInput = page.locator(
    'input[aria-label="Minimum font size in pixels"]'
  )
  await minInput.fill('15')
  await minInput.blur()
  await expect(minInput).toHaveValue('15')
})

test('an unfinished refit mark resets the fit settings on load', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'flashprint:settings',
      JSON.stringify({ fit: { rounding: 'exact', exactPages: 3 } })
    )
    localStorage.setItem('flashprint:refit-busy', '1')
  })
  await page.goto('.')
  await expect(page.locator('.status-line')).toContainText('never finished')
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('flashprint:settings') ?? '{}')
  )
  expect(stored.fit.rounding).toBe('four')
  expect(
    await page.evaluate(() => localStorage.getItem('flashprint:refit-busy'))
  ).toBeNull()
})

test('a very long document is capped instead of freezing the tab', async ({
  page,
}) => {
  await page.addInitScript((md: string) => {
    localStorage.setItem('flashprint:markdown', md)
    localStorage.setItem(
      'flashprint:settings',
      JSON.stringify({ fit: { rounding: 'none', maxFontPx: 25 } })
    )
  }, longMarkdown(120))
  await page.goto('.')
  const started = Date.now()
  await expect(page.locator('.status-line')).toContainText(
    /only the first \d+/,
    { timeout: 60_000 }
  )
  expect(Date.now() - started).toBeLessThan(60_000)
  const status = await page.locator('.status-line').innerText()
  const shown = Number(/only the first (\d+)/.exec(status)?.[1])
  expect(shown).toBeGreaterThan(0)
  await page.waitForFunction(
    (count: number) =>
      document.querySelectorAll('#fp-print-root .fp-page[data-page]').length ===
      count,
    shown,
    { timeout: 60_000 }
  )
  // The tab must still answer input while the sheets are on screen.
  const clear = page.getByRole('button', { name: 'Clear' })
  await clear.click({ timeout: 5000 })
})

const VIEW_DOC = [
  '# Quarterly report',
  '',
  'This paragraph has **bold text** and a [link](https://example.com).',
  '',
  '> A quoted remark about the numbers.',
  '',
  'A plain paragraph well away from the first one.',
  '',
].join('\n')

async function openWith(page: Page, markdown: string) {
  await page.addInitScript((md: string) => {
    localStorage.setItem('flashprint:markdown', md)
  }, markdown)
  await page.goto('.')
  return waitForFit(page)
}

function viewButton(page: Page, label: string) {
  return page.getByRole('button', { name: label, exact: true })
}

function paragraph(page: Page, text: string) {
  return page.locator('.fp-editor .ProseMirror p', { hasText: text })
}

test('the markdown view round-trips the document unchanged', async ({
  page,
}) => {
  await openWith(page, VIEW_DOC)
  const source = page.locator('textarea.markdown-source')

  await viewButton(page, 'Markdown').click()
  const shown = await source.inputValue()
  expect(shown).toContain('# Quarterly report')
  expect(shown).toContain('**bold text**')
  expect(shown).toContain('[link](https://example.com)')
  expect(shown).toContain('> A quoted remark about the numbers.')

  await viewButton(page, 'Formatted').click()
  await expect(source).toHaveCount(0)
  await viewButton(page, 'Markdown').click()
  expect(await source.inputValue()).toBe(shown)
})

test('an edit in the markdown view updates the page preview', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'flashprint:settings',
      JSON.stringify({ fit: { rounding: 'none' } })
    )
  })
  const before = await openWith(page, VIEW_DOC)

  await viewButton(page, 'Markdown').click()
  await page.locator('textarea.markdown-source').fill(longMarkdown(14))
  await expect
    .poll(
      async () => {
        const status = await page.locator('.status-line').innerText()
        return Number(STATUS.exec(status)?.[1] ?? 0)
      },
      { timeout: 30_000 }
    )
    .toBeGreaterThan(before.pages)
})

test('the chosen view survives a reload', async ({ page }) => {
  await openWith(page, VIEW_DOC)
  await viewButton(page, 'Live').click()
  await expect(viewButton(page, 'Live')).toHaveAttribute('aria-pressed', 'true')

  await page.reload()
  await waitForFit(page)
  await expect(viewButton(page, 'Live')).toHaveAttribute('aria-pressed', 'true')
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('flashprint:settings') ?? '{}')
  )
  expect(stored.editor.view).toBe('live')
})

test('the live view reveals syntax only in the block with the cursor', async ({
  page,
}) => {
  await openWith(page, VIEW_DOC)
  await expect(page.locator('.fp-syntax')).toHaveCount(0)

  await viewButton(page, 'Live').click()
  const withCursor = paragraph(page, 'This paragraph has')
  const elsewhere = paragraph(page, 'A plain paragraph')
  await withCursor.click()
  // Two markers for the bold run, two for the link.
  await expect(withCursor.locator('.fp-syntax')).toHaveCount(4)
  await expect(withCursor).toContainText('**bold text**')
  await expect(withCursor).toContainText('[link](https://example.com)')
  await expect(elsewhere.locator('.fp-syntax')).toHaveCount(0)

  await elsewhere.click()
  await expect(withCursor.locator('.fp-syntax')).toHaveCount(0)

  await viewButton(page, 'Formatted').click()
  await expect(page.locator('.fp-syntax')).toHaveCount(0)
})

test('copying puts markdown on the clipboard and nothing else', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const markdown = [
    '- Breast: `carcinoma of the left breast, grade 2` and **bold**',
    '- Colon: `adenocarcinoma of the sigmoid colon` with *emphasis*',
    '',
    '# A heading',
  ].join('\n')
  await page.addInitScript((md: string) => {
    localStorage.setItem('flashprint:markdown', md)
  }, markdown)
  await page.goto('.')
  await waitForFit(page)

  await page.click('.fp-editor .ProseMirror')
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Control+c')

  const clip = await page.evaluate(async () => {
    const items = await navigator.clipboard.read()
    const types: string[] = []
    let plain = ''
    for (const item of items) {
      types.push(...item.types)
      if (item.types.includes('text/plain'))
        plain = await (await item.getType('text/plain')).text()
    }
    return { types, plain }
  })

  // A target that accepts rich text would prefer `text/html` and derive
  // its own escaped markdown from it, so that flavour must be absent.
  expect(clip.types).toEqual(['text/plain'])
  expect(clip.plain).not.toMatch(/\\[`\-*~[\]]/)
  expect(clip.plain).toContain('`carcinoma of the left breast, grade 2`')
  expect(clip.plain).toContain('**bold**')
  expect(clip.plain).toContain('# A heading')
  expect(clip.plain.endsWith('\n')).toBe(false)
})

test('copying part of a line keeps its markers and adds none', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.addInitScript(() => {
    localStorage.setItem('flashprint:markdown', '- an item with **bold** here')
  })
  await page.goto('.')
  await waitForFit(page)

  await page.evaluate(() => {
    const strong = document.querySelector('.fp-editor .ProseMirror strong')
    if (!strong) throw new Error('no bold text to select')
    const range = document.createRange()
    range.selectNodeContents(strong)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  })
  await page.keyboard.press('Control+c')

  // The list bullet was never selected, so it must not be copied.
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    '**bold**'
  )
})
