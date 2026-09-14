import type { FitSettings } from './types'

function largestMultipleAtOrBelow(pages: number, factor: number): number {
  return pages - (pages % factor)
}

/// The page count the fitter aims for. `null` means the document keeps its
/// natural length. The result is never below 1, so a one page document stays
/// one page under every rounding mode. A document shorter than four pages
/// cannot round to a multiple of four, so `four` falls back to `even` there.
export function pickTarget(
  naturalPages: number,
  fit: FitSettings
): number | null {
  const pages = Math.max(1, Math.floor(naturalPages))
  const even = Math.max(1, largestMultipleAtOrBelow(pages, 2))

  switch (fit.rounding) {
    case 'none':
      return null
    case 'exact':
      return Math.max(1, Math.floor(fit.exactPages))
    case 'four':
      return pages >= 4 ? largestMultipleAtOrBelow(pages, 4) : even
    case 'even':
      return even
  }
}
