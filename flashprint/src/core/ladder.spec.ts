import { describe, expect, it } from 'vitest'

import type { Compaction } from './types'

import { applyCompaction, compactionAt, LADDER_STEPS } from './ladder'

const FIT = { minFontPx: 9, maxFontPx: 16 }

const levels = Array.from({ length: LADDER_STEPS + 1 }, (_, level) =>
  compactionAt(level, FIT)
)

function at(level: number): Compaction {
  const compaction = levels[level]
  if (!compaction) throw new Error(`no compaction at level ${level}`)
  return compaction
}

describe('compactionAt', () => {
  it('starts generous and ends tight', () => {
    expect(at(0).fontPx).toBe(FIT.maxFontPx)
    expect(at(0).lineHeight).toBe(1.5)
    expect(at(0).relaxBreaks).toBe(false)
    expect(at(LADDER_STEPS).fontPx).toBe(FIT.minFontPx)
    expect(at(LADDER_STEPS).relaxBreaks).toBe(true)
  })

  it('holds the font size while it tightens spacing first', () => {
    const quarter = at(Math.round(LADDER_STEPS * 0.25))
    expect(quarter.fontPx).toBe(FIT.maxFontPx)
    expect(quarter.paragraphGapEm).toBe(0.2)
    expect(quarter.headingGapEm).toBe(0.7)
    expect(quarter.blockGapEm).toBe(0.35)
    expect(quarter.headingScale).toBe(0.9)
  })

  it('never loosens as the level grows', () => {
    for (let level = 1; level <= LADDER_STEPS; level += 1) {
      const previous = at(level - 1)
      const current = at(level)
      expect(current.fontPx).toBeLessThanOrEqual(previous.fontPx)
      expect(current.lineHeight).toBeLessThanOrEqual(previous.lineHeight)
      expect(current.paragraphGapEm).toBeLessThanOrEqual(
        previous.paragraphGapEm
      )
      expect(current.headingGapEm).toBeLessThanOrEqual(previous.headingGapEm)
      expect(current.blockGapEm).toBeLessThanOrEqual(previous.blockGapEm)
      expect(current.headingScale).toBeLessThanOrEqual(previous.headingScale)
    }
  })

  it('clamps a level outside the ladder', () => {
    expect(compactionAt(-5, FIT)).toEqual(at(0))
    expect(compactionAt(LADDER_STEPS + 5, FIT)).toEqual(at(LADDER_STEPS))
  })
})

describe('applyCompaction', () => {
  it('writes every variable inline so a clone carries it', () => {
    const root = document.createElement('div')
    applyCompaction(root, at(LADDER_STEPS))

    const style = root.style
    expect(style.getPropertyValue('--fp-font-size')).toBe('9px')
    expect(style.getPropertyValue('--fp-line-height')).toBe('1.2')
    expect(style.getPropertyValue('--fp-paragraph-gap')).toBe('0.2em')
    expect(style.getPropertyValue('--fp-heading-gap')).toBe('0.7em')
    expect(style.getPropertyValue('--fp-block-gap')).toBe('0.35em')
    expect(style.getPropertyValue('--fp-heading-scale')).toBe('0.8')
    expect(root.dataset.relaxBreaks).toBe('true')

    applyCompaction(root, at(0))
    expect(root.dataset.relaxBreaks).toBe('false')

    const clone = root.cloneNode(true) as HTMLElement
    expect(clone.style.getPropertyValue('--fp-font-size')).toBe('16px')
  })
})
