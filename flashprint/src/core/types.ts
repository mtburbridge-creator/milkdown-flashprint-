/// Paper sizes the app can print on. Dimensions live in `paper.ts`.
export type PaperName = 'letter' | 'a4' | 'legal'

/// `single` prints one page per sheet, portrait.
/// `two-up` prints two half-size pages side by side on a landscape sheet.
export type Layout = 'single' | 'two-up'

export interface PageSettings {
  paper: PaperName
  layout: Layout
  /// Margin on every side of a page, in inches.
  marginIn: number
  /// Print a small "n / total" footer inside the bottom margin.
  pageNumbers: boolean
}

/// Every length is in CSS pixels at 96 dpi, the unit Chromium prints at.
export interface PageBox {
  /// The physical sheet the printer receives.
  sheetWidthPx: number
  sheetHeightPx: number
  pagesPerSheet: 1 | 2
  /// One logical page on that sheet, margins included.
  pageWidthPx: number
  pageHeightPx: number
  marginPx: number
  /// The area the document flows into.
  contentWidthPx: number
  contentHeightPx: number
}

/// How the fitter rounds the page count.
/// `none` keeps the default size and only reports the count.
/// `even` shrinks to the largest even count at or below the natural count.
/// `four` does the same with a multiple of four.
/// `exact` shrinks to `exactPages`.
export type RoundingMode = 'none' | 'even' | 'four' | 'exact'

export interface FitSettings {
  rounding: RoundingMode
  exactPages: number
  /// The fitter never sets the body font below this size.
  minFontPx: number
  /// The body font size at level 0, before any compaction.
  maxFontPx: number
}

/// One point on the compaction ladder. `applyCompaction` maps these to
/// CSS variables that `print.css` reads.
export interface Compaction {
  fontPx: number
  lineHeight: number
  /// Vertical gap between paragraphs, in em of the body font.
  paragraphGapEm: number
  /// Space above a heading, in em of the body font.
  headingGapEm: number
  /// Space around code blocks, tables, quotes and figures, in em.
  blockGapEm: number
  /// Multiplier on every heading size. 1 keeps the default scale.
  headingScale: number
  /// When true, a tall code block or table may split across pages.
  relaxBreaks: boolean
}

export interface FitResult {
  /// Page count at the chosen compaction.
  pages: number
  sheets: number
  /// Page count at level 0, before compaction.
  naturalPages: number
  /// The count the fitter aimed for. `null` when rounding is `none`.
  targetPages: number | null
  /// False when even the tightest level exceeds the target.
  reached: boolean
  /// Ladder position, 0 to `LADDER_STEPS`.
  level: number
  compaction: Compaction
}
