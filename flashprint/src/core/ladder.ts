import type { Compaction } from './types'

/// Number of rungs on the compaction ladder. Level 0 is the most generous
/// setting, `LADDER_STEPS` is the tightest.
export const LADDER_STEPS = 48

/// Fraction of the ladder that tightens spacing before the font shrinks.
const SPACING_PHASE = 0.25

/// The ladder relaxes fragmentation rules from this fraction on.
const RELAX_BREAKS_FROM = 0.5

const LINE_HEIGHT = { start: 1.5, mid: 1.3, end: 1.2 }
const PARAGRAPH_GAP_EM = { start: 0.6, end: 0.2 }
const HEADING_GAP_EM = { start: 1.4, end: 0.7 }
const BLOCK_GAP_EM = { start: 0.8, end: 0.35 }
const HEADING_SCALE = { start: 1, mid: 0.9, end: 0.8 }

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t
}

/// Round hard enough that the two phases agree on their shared endpoint.
/// Without it a float remainder makes a field grow by 1e-17 at the seam.
function round4(value: number): number {
  return Math.round(value * 10000) / 10000
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/// The compaction at one rung of the ladder. Every field is monotone in
/// `level`: it never loosens as the level grows.
export function compactionAt(
  level: number,
  fit: { minFontPx: number; maxFontPx: number }
): Compaction {
  const t = clamp(level, 0, LADDER_STEPS) / LADDER_STEPS
  const spacing = clamp(t / SPACING_PHASE, 0, 1)
  const font = clamp((t - SPACING_PHASE) / (1 - SPACING_PHASE), 0, 1)

  const lineHeight =
    spacing < 1
      ? lerp(LINE_HEIGHT.start, LINE_HEIGHT.mid, spacing)
      : lerp(LINE_HEIGHT.mid, LINE_HEIGHT.end, font)
  const headingScale =
    spacing < 1
      ? lerp(HEADING_SCALE.start, HEADING_SCALE.mid, spacing)
      : lerp(HEADING_SCALE.mid, HEADING_SCALE.end, font)

  return {
    fontPx: clamp(
      Math.round(lerp(fit.maxFontPx, fit.minFontPx, font) * 4) / 4,
      Math.min(fit.minFontPx, fit.maxFontPx),
      Math.max(fit.minFontPx, fit.maxFontPx)
    ),
    lineHeight: round4(lineHeight),
    paragraphGapEm: round4(
      lerp(PARAGRAPH_GAP_EM.start, PARAGRAPH_GAP_EM.end, spacing)
    ),
    headingGapEm: round4(
      lerp(HEADING_GAP_EM.start, HEADING_GAP_EM.end, spacing)
    ),
    blockGapEm: round4(lerp(BLOCK_GAP_EM.start, BLOCK_GAP_EM.end, spacing)),
    headingScale: round4(headingScale),
    relaxBreaks: t >= RELAX_BREAKS_FROM,
  }
}

/// Write a compaction to the element as inline CSS custom properties.
/// `print.css` reads them. The properties must be inline because the
/// measurement and the preview both work on a `cloneNode` of the element.
export function applyCompaction(root: HTMLElement, c: Compaction): void {
  const { style } = root
  style.setProperty('--fp-font-size', `${c.fontPx}px`)
  style.setProperty('--fp-line-height', `${c.lineHeight}`)
  style.setProperty('--fp-paragraph-gap', `${c.paragraphGapEm}em`)
  style.setProperty('--fp-heading-gap', `${c.headingGapEm}em`)
  style.setProperty('--fp-block-gap', `${c.blockGapEm}em`)
  style.setProperty('--fp-heading-scale', `${c.headingScale}`)
  root.dataset.relaxBreaks = c.relaxBreaks ? 'true' : 'false'
}
