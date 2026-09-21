import { describe, expect, it } from 'vitest'

import { resolvePageBox, sheetsFor, sidesFor } from './paper'

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

describe('sidesFor', () => {
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

  it('pairs pages on a two-up side and rounds up', () => {
    expect(sidesFor(4, twoUp)).toBe(2)
    expect(sidesFor(5, twoUp)).toBe(3)
  })

  it('gives every page its own side in the single layout', () => {
    expect(sidesFor(5, single)).toBe(5)
  })
})

describe('sheetsFor', () => {
  it('prints two sides on one sheet of paper', () => {
    expect(sheetsFor(4)).toBe(2)
    expect(sheetsFor(1)).toBe(1)
  })

  it('rounds an odd side count up to a whole sheet', () => {
    expect(sheetsFor(5)).toBe(3)
  })
})
