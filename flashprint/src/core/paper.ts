import type { PageBox, PageSettings, PaperName } from './types'

/// CSS pixels per inch. Chromium lays print out at this ratio.
export const DPI = 96

/// Physical size of every paper the app can print on.
export const PAPERS: Record<
  PaperName,
  { widthIn: number; heightIn: number; label: string }
> = {
  letter: { widthIn: 8.5, heightIn: 11, label: 'Letter' },
  a4: { widthIn: 8.27, heightIn: 11.69, label: 'A4' },
  legal: { widthIn: 8.5, heightIn: 14, label: 'Legal' },
}

function round2(px: number): number {
  return Math.round(px * 100) / 100
}

/// Turn page settings into the pixel geometry the fitter and the preview
/// share. A `two-up` sheet is the paper turned landscape and split into two
/// portrait halves.
export function resolvePageBox(settings: PageSettings): PageBox {
  const paper = PAPERS[settings.paper]
  const portraitWidth = paper.widthIn * DPI
  const portraitHeight = paper.heightIn * DPI
  const twoUp = settings.layout === 'two-up'

  const sheetWidthPx = round2(twoUp ? portraitHeight : portraitWidth)
  const sheetHeightPx = round2(twoUp ? portraitWidth : portraitHeight)
  const pagesPerSheet: 1 | 2 = twoUp ? 2 : 1
  const pageWidthPx = round2(sheetWidthPx / pagesPerSheet)
  const pageHeightPx = sheetHeightPx
  const marginPx = round2(settings.marginIn * DPI)

  return {
    sheetWidthPx,
    sheetHeightPx,
    pagesPerSheet,
    pageWidthPx,
    pageHeightPx,
    marginPx,
    contentWidthPx: round2(pageWidthPx - marginPx * 2),
    contentHeightPx: round2(pageHeightPx - marginPx * 2),
  }
}

/// Printed sides a duplex printer puts on one sheet of paper.
export const SIDES_PER_SHEET = 2

/// How many printed sides a page count needs in this layout. One side
/// carries `pagesPerSheet` pages, so a two-up side holds two of them.
export function sidesFor(pages: number, box: PageBox): number {
  return Math.ceil(pages / box.pagesPerSheet)
}

/// How many sheets of paper a side count needs. The app assumes duplex
/// printing, so two sides share one sheet.
export function sheetsFor(sides: number): number {
  return Math.ceil(sides / SIDES_PER_SHEET)
}
