import { describe, expect, it } from 'vitest'

import { resolvePageBox, sheetsFor } from './paper'

describe('resolvePageBox', () => {
  it('splits a landscape letter sheet into two portrait pages', () => {
    const box = resolvePageBox({
      paper: 'letter',
      layout: 'two-up',
      marginIn: 0.5,
      pageNumbers: false,
    })

    expect(box.sheetWidthPx).toBe(1056)
    expect(box.sheetHeightPx).toBe(816)
    expect(box.pagesPerSheet).toBe(2)
    expect(box.pageWidthPx).toBe(528)
    expect(box.pageHeightPx).toBe(816)
    expect(box.marginPx).toBe(48)
    expect(box.contentWidthPx).toBe(432)
    expect(box.contentHeightPx).toBe(720)
  })

  it('keeps the sheet portrait in the single layout', () => {
    const box = resolvePageBox({
      paper: 'letter',
      layout: 'single',
      marginIn: 0.7,
      pageNumbers: true,
    })

    expect(box.pagesPerSheet).toBe(1)
    expect(box.pageWidthPx).toBe(816)
    expect(box.pageHeightPx).toBe(1056)
    expect(box.marginPx).toBe(67.2)
    expect(box.contentWidthPx).toBe(681.6)
    expect(box.contentHeightPx).toBe(921.6)
  })
})

describe('sheetsFor', () => {
  const twoUp = resolvePageBox({
    paper: 'a4',
    layout: 'two-up',
    marginIn: 0.5,
    pageNumbers: false,
  })
  const single = resolvePageBox({
    paper: 'a4',
    layout: 'single',
    marginIn: 0.5,
    pageNumbers: false,
  })

  it('pairs pages on a two-up sheet and rounds up', () => {
    expect(sheetsFor(4, twoUp)).toBe(2)
    expect(sheetsFor(5, twoUp)).toBe(3)
  })

  it('gives every page its own single sheet', () => {
    expect(sheetsFor(5, single)).toBe(5)
  })
})
