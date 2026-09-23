import { expect, test, type Download, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

import { countPdfPages } from './pdf'

const STATUS =
  /(\d+) faces? \/ (\d+) sides? \/ (\d+) sheets?(?: · font ([\d.]+)px · line ([\d.]+))?/

async function waitForFit(page: Page) {
  await page.waitForSelector('#fp-print-root .fp-sheet', { state: 'attached' })
  await page.waitForFunction(() => document.fonts.status === 'loaded')
  const status = await page.locator('.status-line').innerText()
  const match = STATUS.exec(status)
  expect(match, status).not.toBeNull()
  const [, pages, sides, sheets, font, line] = match!
  return {
    pages: Number(pages),
    sides: Number(sides),
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
  // One `.fp-sheet` element is one printed side.
  const sides = await page.locator('#fp-print-root .fp-sheet').count()
  expect(sides).toBe(status.sides)

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
  expect(countPdfPages(pdf)).toBe(sides)
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
  expect(status.pages).toBe(status.sides)
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

test('the status counts faces, sides and sheets with sheets in bold', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'flashprint:settings',
      JSON.stringify({
        page: { layout: 'two-up', paper: 'letter', marginIn: 0.5 },
        fit: { rounding: 'none' },
      })
    )
  })
  await page.goto('.')
  const status = await waitForFit(page)

  // Two pages share a side, and a duplex print puts two sides on a sheet.
  expect(status.sides).toBe(Math.ceil(status.pages / 2))
  expect(status.sheets).toBe(Math.ceil(status.sides / 2))

  const text = await page.locator('.status-line').innerText()
  expect(text).toContain(
    `${status.pages} faces / ${status.sides} sides / ${status.sheets} sheet`
  )

  // The sheet count carries the bold, because it is the paper cost.
  const strong = page.locator('.status-line .status-strong')
  await expect(strong).toHaveText(/^\d+ sheets?$/)
  expect(await strong.evaluate((el) => getComputedStyle(el).fontWeight)).toBe(
    '700'
  )
})

test('the status uses the singular for a one sheet print', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('flashprint:markdown', '# Just a title\n')
    localStorage.setItem(
      'flashprint:settings',
      JSON.stringify({
        page: { layout: 'two-up' },
        fit: { rounding: 'none' },
      })
    )
  })
  await page.goto('.')
  await waitForFit(page)
  expect(await page.locator('.status-line').innerText()).toContain(
    '1 face / 1 side / 1 sheet'
  )
})

async function downloadedText(download: Download): Promise<string> {
  return readFile(await download.path(), 'utf8')
}

/// Shows the Markdown view and returns what it holds, which is the
/// document markdown as the editor serialises it.
async function markdownOnScreen(page: Page): Promise<string> {
  await viewButton(page, 'Markdown').click()
  return page.locator('textarea.markdown-source').inputValue()
}

test('Ctrl+S saves pasted markdown under a dated name', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await openWith(page, '# Old\n')
  await page.evaluate(() =>
    navigator.clipboard.writeText('# Pasted\n\nSome **bold** text.\n')
  )
  await page.getByRole('button', { name: 'Paste' }).click()
  await expect(paragraph(page, 'Some')).toContainText('bold')

  const pending = page.waitForEvent('download')
  await page.keyboard.press('Control+s')
  const download = await pending
  const today = await page.evaluate(() => {
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  })
  expect(download.suggestedFilename()).toBe(`flashprint-${today}.md`)
  const saved = await downloadedText(download)
  expect(saved).toContain('**bold**')
  expect(saved).toBe(await markdownOnScreen(page))
})

test('Ctrl+S names the save after an opened file', async ({ page }) => {
  await openWith(page, VIEW_DOC)
  await page.locator('input[type="file"]').setInputFiles({
    name: 'meeting notes.markdown',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Notes\n\n- first\n- second\n'),
  })
  await expect(page.locator('.file-name')).toHaveText('meeting notes.markdown')
  await expect(page.locator('.fp-editor .ProseMirror h1')).toHaveText('Notes')

  const expected = await markdownOnScreen(page)
  // The text area waits before it pushes an edit. A save straight after
  // typing must still hold the new text.
  const source = page.locator('textarea.markdown-source')
  await source.focus()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('\nA new line.')
  const pending = page.waitForEvent('download')
  await page.keyboard.press('Control+s')
  const download = await pending
  expect(download.suggestedFilename()).toBe('meeting notes.md')
  const saved = await downloadedText(download)
  expect(saved).toBe(await source.inputValue())
  expect(saved).toBe(`${expected}\nA new line.`)
})

test('the Save .md button saves the markdown', async ({ page }) => {
  await openWith(page, VIEW_DOC)
  const button = page.getByRole('button', { name: 'Save .md' })
  await expect(button).toHaveAttribute('title', 'Save as markdown (Ctrl+S)')

  const pending = page.waitForEvent('download')
  await button.click()
  const download = await pending
  expect(download.suggestedFilename()).toMatch(
    /^flashprint-\d{4}-\d{2}-\d{2}\.md$/
  )
  expect(await downloadedText(download)).toBe(await markdownOnScreen(page))
})

test('the markdown view checks spelling', async ({ page }) => {
  await openWith(page, VIEW_DOC)
  await viewButton(page, 'Markdown').click()
  await expect(page.locator('textarea.markdown-source')).toHaveAttribute(
    'spellcheck',
    'true'
  )
})

test('Ctrl+Shift+. cycles the views and the choice survives a reload', async ({
  page,
}) => {
  await openWith(page, VIEW_DOC)
  const pressed = (label: string) =>
    expect(viewButton(page, label)).toHaveAttribute('aria-pressed', 'true')
  await pressed('Formatted')
  await expect(viewButton(page, 'Live')).toHaveAttribute(
    'title',
    /Ctrl\+Shift\+\. cycles views/
  )

  await paragraph(page, 'A plain paragraph').click()
  await page.keyboard.press('Control+Shift+Period')
  await pressed('Markdown')
  const source = page.locator('textarea.markdown-source')
  await expect(source).toBeFocused()
  expect(await source.inputValue()).toContain('# Quarterly report')

  await page.keyboard.press('Control+Shift+Period')
  await pressed('Live')
  await expect(source).toHaveCount(0)
  await expect(page.locator('.fp-editor .ProseMirror')).toBeFocused()

  await page.keyboard.press('Control+Shift+Period')
  await pressed('Formatted')

  await page.keyboard.press('Control+Shift+Period')
  await pressed('Markdown')
  await page.reload()
  await waitForFit(page)
  await pressed('Markdown')
  await expect(source).toBeVisible()
})

test('Ctrl+/ opens the shortcut panel and Escape closes it', async ({
  page,
}) => {
  await openWith(page, VIEW_DOC)
  const editor = page.locator('.fp-editor .ProseMirror')
  await paragraph(page, 'A plain paragraph').click()
  await expect(editor).toBeFocused()

  await page.keyboard.press('Control+/')
  const panel = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await expect(panel).toBeVisible()
  await expect(panel).toHaveAttribute('aria-modal', 'true')
  for (const text of [
    'Save as markdown',
    'Find',
    'Find and replace',
    'Move block up or down',
    'Typing shortcuts',
    '==text==',
    '@today',
  ]) {
    await expect(panel.getByText(text, { exact: true }).first()).toBeVisible()
  }
  await expect(
    panel.locator('.shortcuts-row', { hasText: 'Save as markdown' })
  ).toContainText('CtrlS')
  // The panel swallows app shortcuts while it is open.
  await page.keyboard.press('Control+Shift+Period')
  await expect(viewButton(page, 'Formatted')).toHaveAttribute(
    'aria-pressed',
    'true'
  )

  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  await expect(editor).toBeFocused()

  const help = page.getByRole('button', { name: 'Keyboard shortcuts' })
  await help.click()
  await expect(panel).toBeVisible()
  await page.keyboard.press('Control+/')
  await expect(panel).toHaveCount(0)
  await expect(help).toBeFocused()

  await help.click()
  await page.mouse.click(5, 5)
  await expect(panel).toHaveCount(0)
  await help.click()
  await panel.getByRole('button', { name: 'Close' }).click()
  await expect(panel).toHaveCount(0)
})

const editorRoot = (page: Page) => page.locator('.fp-editor .ProseMirror')

/// Selects the first occurrence of `text` in the editor, or places the
/// caret `caretAt` characters into it.
async function selectInEditor(page: Page, text: string, caretAt?: number) {
  await editorRoot(page).focus()
  await page.evaluate(
    ([needle, caret]) => {
      const root = document.querySelector('.fp-editor .ProseMirror')
      if (!root) throw new Error('no editor')
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = node.textContent?.indexOf(needle) ?? -1
        if (at < 0) continue
        const range = document.createRange()
        range.setStart(node, at + (caret ?? 0))
        range.setEnd(node, caret === null ? at + needle.length : at + caret)
        const selection = window.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
        return
      }
      throw new Error(`no text: ${needle}`)
    },
    [text, caretAt ?? null] as const
  )
  // ProseMirror reads the DOM selection on the next selectionchange.
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(resolve))
  )
}

async function placeCaretAtEnd(page: Page, text: string) {
  await selectInEditor(page, text, text.length)
}

function printedText(page: Page) {
  return page.locator('#fp-print-root').textContent()
}

function occurrences(text: string, word: string): number {
  return text.split(word).length - 1
}

const FIND_DOC = [
  '# Orchard',
  '',
  'The apple is red. An apple a day.',
  '',
  '- apple pie',
  '- see [the fruit](https://apple.example)',
  '',
].join('\n')

const findField = (page: Page) =>
  page.getByRole('textbox', { name: 'Find', exact: true })
const findCount = (page: Page) => page.locator('.fp-find-count')
const findBar = (page: Page) => page.getByRole('search')

test('Ctrl+F finds, steps through and clears the matches', async ({ page }) => {
  await openWith(page, FIND_DOC)
  await page.keyboard.press('Control+f')
  await expect(findField(page)).toBeFocused()
  await page.keyboard.type('apple')
  await expect(findCount(page)).toHaveText('1 of 3')
  await expect(page.locator('.fp-editor .fp-find-match')).toHaveCount(3)

  await page.keyboard.press('Enter')
  await expect(findCount(page)).toHaveText('2 of 3')
  await page.keyboard.press('Shift+Enter')
  await expect(findCount(page)).toHaveText('1 of 3')

  await page.keyboard.press('Escape')
  await expect(findBar(page)).toHaveCount(0)
  await expect(page.locator('.fp-find-match')).toHaveCount(0)
  await expect(editorRoot(page)).toBeFocused()
})

test('Ctrl+H replaces every match and one undo brings them back', async ({
  page,
}) => {
  await openWith(page, FIND_DOC)
  await page.keyboard.press('Control+h')
  await findField(page).fill('apple')
  await expect(findCount(page)).toHaveText('1 of 3')
  await page.getByRole('textbox', { name: 'Replace', exact: true }).fill('pear')
  await page.getByRole('button', { name: 'Replace all matches' }).click()
  await expect(findCount(page)).toHaveText('No results')
  await expect
    .poll(async () => occurrences((await printedText(page)) ?? '', 'pear'))
    .toBe(3)

  const source = page.locator('textarea.markdown-source')
  await viewButton(page, 'Markdown').click()
  const markdown = await source.inputValue()
  expect(occurrences(markdown, 'pear')).toBe(3)
  // The link target is not document text, so it keeps its apple.
  expect(occurrences(markdown, 'apple')).toBe(1)

  await viewButton(page, 'Formatted').click()
  await findField(page).press('Escape')
  await expect(findBar(page)).toHaveCount(0)
  await expect(editorRoot(page)).toBeFocused()
  await page.keyboard.press('Control+z')
  await expect(editorRoot(page)).not.toContainText('pear')
  expect(
    occurrences((await editorRoot(page).textContent()) ?? '', 'apple')
  ).toBe(3)
})

test('find and replace works in the markdown view', async ({ page }) => {
  await openWith(page, FIND_DOC)
  await viewButton(page, 'Markdown').click()
  const source = page.locator('textarea.markdown-source')
  await source.focus()
  await page.keyboard.press('Control+f')
  await page.keyboard.type('apple')
  // The markdown also holds the link target.
  await expect(findCount(page)).toHaveText(/^\d of 4$/)
  await page.keyboard.press('Control+h')
  await page.getByRole('textbox', { name: 'Replace', exact: true }).fill('plum')
  await page.getByRole('button', { name: 'Replace all matches' }).click()

  const value = await source.inputValue()
  expect(occurrences(value, 'plum')).toBe(4)
  expect(value).not.toContain('apple')
  await expect
    .poll(async () => occurrences((await printedText(page)) ?? '', 'plum'))
    .toBe(3)
})

test('the find bar follows the view', async ({ page }) => {
  await openWith(page, FIND_DOC)
  await page.keyboard.press('Control+f')
  await page.keyboard.type('apple')
  await expect(findCount(page)).toHaveText('1 of 3')

  await viewButton(page, 'Markdown').click()
  await expect(findCount(page)).toHaveText(/^\d of 4$/)
  await expect(page.locator('.fp-find-match')).toHaveCount(0)

  await viewButton(page, 'Live').click()
  await expect(findCount(page)).toHaveText(/^\d of 3$/)
  await expect(page.locator('.fp-editor .fp-find-match')).toHaveCount(3)
})

test('a match in a code block counts and keeps the selection', async ({
  page,
}) => {
  await openWith(
    page,
    '# Fruit\n\nThe apple is red.\n\n```js\nconst apple = 1\n```\n\nLast apple.\n'
  )
  await page.keyboard.press('Control+f')
  await page.keyboard.type('apple')
  await expect(findCount(page)).toHaveText('1 of 3')
  // CodeMirror draws the code block and drops the match decoration.
  await expect(page.locator('.fp-editor .fp-find-match')).toHaveCount(2)

  await page.keyboard.press('Enter')
  await expect(findCount(page)).toHaveText('2 of 3')
  await page.keyboard.press('Escape')
  await expect(page.locator('.cm-editor.cm-focused')).toHaveCount(1)
  expect(await page.evaluate(() => String(window.getSelection()))).toBe('apple')
  await page.keyboard.type('pear')
  await expect(page.locator('.cm-content')).toHaveText('const pear = 1')
})

async function paragraphTexts(page: Page): Promise<string[]> {
  return editorRoot(page).locator(':scope > p').allTextContents()
}

test('Alt+ArrowDown moves a block and one undo puts it back', async ({
  page,
}) => {
  await openWith(page, 'First para.\n\nSecond para.\n\nThird para.\n')
  await placeCaretAtEnd(page, 'First')
  await page.keyboard.press('Alt+ArrowDown')
  await expect
    .poll(() => paragraphTexts(page))
    .toEqual(['Second para.', 'First para.', 'Third para.'])
  await page.keyboard.press('Control+z')
  await expect
    .poll(() => paragraphTexts(page))
    .toEqual(['First para.', 'Second para.', 'Third para.'])
})

test('Alt+ArrowUp moves a list item inside its list', async ({ page }) => {
  await openWith(page, '- one\n- two\n- three\n')
  await placeCaretAtEnd(page, 'two')
  await page.keyboard.press('Alt+ArrowUp')
  const items = editorRoot(page).locator('li')
  await expect(items).toHaveText(['two', 'one', 'three'])
  await expect(editorRoot(page).locator('ul')).toHaveCount(1)
})

test('Alt+Shift+ArrowDown duplicates a paragraph', async ({ page }) => {
  await openWith(page, 'First para.\n\nSecond para.\n')
  await placeCaretAtEnd(page, 'First')
  await page.keyboard.press('Alt+Shift+ArrowDown')
  await expect
    .poll(() => paragraphTexts(page))
    .toEqual(['First para.', 'First para.', 'Second para.'])
})

const linkBox = (page: Page) =>
  page.locator('.milkdown-link-edit[data-show="true"]')

test('Ctrl+K opens the link box for a selected word', async ({ page }) => {
  await openWith(page, 'Visit the harbour today.\n')
  await selectInEditor(page, 'harbour')
  await page.keyboard.press('Control+k')
  await expect(linkBox(page)).toBeVisible()
  await expect(linkBox(page).locator('input')).toBeFocused()
})

test('Ctrl+K in a word links that word', async ({ page }) => {
  await openWith(page, 'Visit the harbour today.\n')
  await selectInEditor(page, 'harbour', 3)
  await page.keyboard.press('Control+k')
  await expect(linkBox(page)).toBeVisible()
  await expect(linkBox(page).locator('input')).toBeFocused()
  await page.keyboard.type('https://example.com')
  await page.keyboard.press('Enter')
  await expect(editorRoot(page).locator('a')).toHaveText('harbour')
})

test('Ctrl+K away from a word keeps the focus in the editor', async ({
  page,
}) => {
  await openWith(page, 'Visit the harbour today.\n')
  await selectInEditor(page, 'harbour ', 'harbour '.length)
  await page.keyboard.press('Control+k')
  await expect(editorRoot(page)).toBeFocused()
  await expect(linkBox(page)).toHaveCount(0)
})

test('typing an arrow replaces it and one undo restores it', async ({
  page,
}) => {
  await openWith(page, 'Start\n')
  const line = paragraph(page, 'Start')
  await placeCaretAtEnd(page, 'Start')
  await page.keyboard.type(' a -> b')
  await expect(line).toHaveText('Start a → b')
  await page.keyboard.type(' c ->')
  await expect(line).toHaveText('Start a → b c →')
  await page.keyboard.press('Control+z')
  await expect(line).toHaveText('Start a → b c ->')
})

test('@date turns into the date', async ({ page }) => {
  await openWith(page, 'Due\n')
  await placeCaretAtEnd(page, 'Due')
  await page.keyboard.type(' @date ')
  const today = await page.evaluate(() => {
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  })
  await expect(paragraph(page, 'Due')).toHaveText(
    new RegExp(`^Due ${today}\\s$`)
  )
})

test('an arrow typed in inline code stays literal', async ({ page }) => {
  await openWith(page, 'Some `abc` code\n')
  await selectInEditor(page, 'abc', 2)
  await page.keyboard.type('->')
  await expect(editorRoot(page).locator('code')).toHaveText('ab->c')
})

test('pasted text keeps its arrows', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await openWith(page, 'Start\n')
  await page.evaluate(() => navigator.clipboard.writeText('x -> y => z'))
  await placeCaretAtEnd(page, 'Start')
  await page.keyboard.press('Control+v')
  await expect(paragraph(page, 'Start')).toHaveText('Startx -> y => z')
})

test('==text== highlights, and the highlight survives every output', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await openWith(page, 'Say\n')
  await placeCaretAtEnd(page, 'Say')
  await page.keyboard.type(' ==hi== there')
  const mark = editorRoot(page).locator('mark')
  await expect(mark).toHaveText('hi')

  await expect(page.locator('#fp-print-root mark')).not.toHaveCount(0)
  const background = await page
    .locator('#fp-print-root mark')
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(background).not.toBe('rgba(0, 0, 0, 0)')
  expect(background).not.toBe('transparent')

  await selectInEditor(page, 'hi')
  await page.keyboard.press('Control+c')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    '==hi=='
  )

  await viewButton(page, 'Markdown').click()
  expect(await page.locator('textarea.markdown-source').inputValue()).toContain(
    'Say ==hi== there'
  )
})

test('Ctrl+Shift+H toggles the highlight on a selection', async ({ page }) => {
  await openWith(page, 'Make this bright.\n')
  await selectInEditor(page, 'bright')
  await page.keyboard.press('Control+Shift+h')
  await expect(editorRoot(page).locator('mark')).toHaveText('bright')
  await page.keyboard.press('Control+Shift+h')
  await expect(editorRoot(page).locator('mark')).toHaveCount(0)
})
