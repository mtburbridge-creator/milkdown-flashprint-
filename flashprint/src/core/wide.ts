import type { PageBox } from './types'

/// Blocks whose narrowest layout can still be wider than the page. A table
/// cannot wrap a cell below its longest word, and display math never wraps.
const WIDE_BLOCKS = 'table, .fp-math-block'

/// Below this font size a wide block stops shrinking and breaks its words
/// anywhere instead.
export const MIN_WIDE_FONT_PX = 7

// Border widths do not scale with the font, so one pass can land a pixel
// or two short. A few passes settle it.
const PASSES = 3

// Headroom for subpixel rounding between this layout and the page clones.
const SLACK_PX = 0.5

function availableWidth(el: HTMLElement): number {
  const parent = el.parentElement
  if (!parent) return 0
  const style = getComputedStyle(parent)
  return (
    parent.getBoundingClientRect().width -
    parseFloat(style.paddingLeft) -
    parseFloat(style.paddingRight) -
    parseFloat(style.borderLeftWidth) -
    parseFloat(style.borderRightWidth)
  )
}

/// The largest font size, in pixels, at which `el` fits `room`, or `null`
/// when it fits at its own size. `el` is laid out at its narrowest.
function fittingFont(el: HTMLElement, room: number): number | null {
  const natural = parseFloat(getComputedStyle(el).fontSize)
  let font = natural
  for (let pass = 0; pass < PASSES; pass += 1) {
    const width = el.getBoundingClientRect().width
    if (width <= room + SLACK_PX) break
    font = Math.floor(font * (room / width) * 100) / 100
    el.style.setProperty('--fp-wide-font', `${font}px`)
  }
  return font < natural ? font : null
}

/// Caps the font of every table and math block that would otherwise be
/// wider than the page, so nothing spills into the neighbouring page.
///
/// Every page shows a window onto one multicol flow. A block wider than
/// its column paints into the next column, which is the next page, and
/// `measurePages` never sees it. The cap is a pixel size, and the width of
/// a block scales with its font, so one cap holds at every compaction
/// level the fitter tries.
///
/// A block that would need a font under `MIN_WIDE_FONT_PX` keeps that size
/// and is marked `data-fp-squeeze`, which lets it break words anywhere.
export function capWideBlocks(doc: HTMLElement, box: PageBox): void {
  const columnWidth = box.contentWidthPx
  if (columnWidth <= 0) return

  const blocks = [...doc.querySelectorAll<HTMLElement>(WIDE_BLOCKS)]
  for (const block of blocks) {
    block.style.removeProperty('--fp-wide-font')
    delete block.dataset.fpSqueeze
  }
  if (blocks.length === 0) return

  const clone = doc.cloneNode(true) as HTMLElement
  clone.classList.add('fp-narrowest')
  const host = document.createElement('div')
  host.style.cssText =
    'position:absolute;left:0;top:0;visibility:hidden;pointer-events:none;' +
    `width:${columnWidth}px;`
  host.appendChild(clone)
  document.body.appendChild(host)

  try {
    const copies = clone.querySelectorAll<HTMLElement>(WIDE_BLOCKS)
    blocks.forEach((block, index) => {
      const copy = copies[index]
      if (!copy) return
      const font = fittingFont(copy, availableWidth(copy))
      if (font === null) return
      if (font < MIN_WIDE_FONT_PX) {
        block.style.setProperty('--fp-wide-font', `${MIN_WIDE_FONT_PX}px`)
        block.dataset.fpSqueeze = 'true'
        return
      }
      block.style.setProperty('--fp-wide-font', `${font}px`)
    })
  } finally {
    host.remove()
  }
}
