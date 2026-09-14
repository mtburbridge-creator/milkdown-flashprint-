import type { PageBox } from '../core/types'

const STYLE_ID = 'fp-page-rule'
const CSS_PX_PER_IN = 96

/// Writes the `@page` rule Chromium reads when printing, sizing the
/// sheet to the box the fitter computed. Creates the style element on
/// first call and updates it in place after that.
export function updatePageRule(box: PageBox): void {
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!style) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.head.appendChild(style)
  }
  const widthIn = box.sheetWidthPx / CSS_PX_PER_IN
  const heightIn = box.sheetHeightPx / CSS_PX_PER_IN
  style.textContent = `@page { size: ${widthIn}in ${heightIn}in; margin: 0; }`
}
