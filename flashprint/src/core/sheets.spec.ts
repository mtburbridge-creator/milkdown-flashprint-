import { describe, expect, it } from 'vitest'

import type { PageSettings } from './types'

import { resolvePageBox } from './paper'
import { buildSheets, buildSheetsAsync } from './sheets'

const PAGE: PageSettings = {
  paper: 'letter',
  layout: 'two-up',
  marginIn: 0.5,
  pageNumbers: true,
}
const BOX = resolvePageBox(PAGE)

function doc(): HTMLElement {
  const el = document.createElement('div')
  el.className = 'fp-doc'
  el.innerHTML = '<p>text</p>'
  return el
}

describe('buildSheets', () => {
  it('renders one clone per page', () => {
    const root = buildSheets(doc(), BOX, 5, PAGE)
    expect(root.querySelectorAll('.fp-sheet').length).toBe(3)
    expect(root.querySelectorAll('.fp-page[data-page]').length).toBe(5)
    expect(root.querySelectorAll('.fp-page').length).toBe(6)
  })

  it('stops cloning at the page bound but keeps the true total', () => {
    const root = buildSheets(doc(), BOX, 100, PAGE, { maxPages: 8 })
    expect(root.querySelectorAll('.fp-page[data-page]').length).toBe(8)
    expect(root.querySelectorAll('.fp-sheet').length).toBe(4)
    expect(root.querySelector('.fp-page-number')?.textContent).toBe('1 / 100')
  })
})

describe('buildSheetsAsync', () => {
  it('hands the root out first and fills it in chunks', async () => {
    let early: HTMLElement | null = null
    const root = await buildSheetsAsync(
      doc(),
      BOX,
      9,
      PAGE,
      { chunk: 2 },
      (el) => {
        early = el
        expect(el.querySelectorAll('.fp-sheet').length).toBe(0)
      }
    )
    expect(root).toBe(early)
    expect(root?.querySelectorAll('.fp-sheet').length).toBe(5)
  })

  it('returns null when aborted between chunks', async () => {
    const signal = { aborted: false }
    const root = await buildSheetsAsync(
      doc(),
      BOX,
      40,
      PAGE,
      { chunk: 2, signal },
      () => {
        signal.aborted = true
      }
    )
    expect(root).toBeNull()
  })
})
