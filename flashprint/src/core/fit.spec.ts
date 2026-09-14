import { describe, expect, it } from 'vitest'

import type { PageCounter } from './fit'
import type { FitSettings, PageBox, RoundingMode } from './types'

import { fitDocument, fitDocumentAsync } from './fit'
import { compactionAt, LADDER_STEPS } from './ladder'
import { resolvePageBox } from './paper'

const BOX: PageBox = resolvePageBox({
  paper: 'letter',
  layout: 'two-up',
  marginIn: 0.5,
  pageNumbers: false,
})

function settings(rounding: RoundingMode, exactPages = 4): FitSettings {
  return { rounding, exactPages, minFontPx: 9, maxFontPx: 16 }
}

// Read the ladder level back from the variables `applyCompaction` wrote.
// The line height falls strictly across the ladder, so it names one level.
function levelOf(doc: HTMLElement, fit: FitSettings): number {
  const lineHeight = doc.style.getPropertyValue('--fp-line-height')
  for (let level = 0; level <= LADDER_STEPS; level += 1)
    if (`${compactionAt(level, fit).lineHeight}` === lineHeight) return level

  throw new Error(`no ladder level writes line height ${lineHeight}`)
}

// A page counter that answers from the level instead of a browser layout.
function counterFrom(
  fit: FitSettings,
  pagesByLevel: (level: number) => number
): { count: PageCounter; levels: number[] } {
  const levels: number[] = []
  const count: PageCounter = (doc) => {
    const level = levelOf(doc, fit)
    levels.push(level)
    return pagesByLevel(level)
  }
  return { count, levels }
}

describe('fitDocument', () => {
  it('keeps level 0 when the document already meets the target', () => {
    const doc = document.createElement('div')
    const fit = settings('even')
    const { count, levels } = counterFrom(fit, () => 4)

    const result = fitDocument({ doc, box: BOX, fit, measure: count })

    expect(result.level).toBe(0)
    expect(result.naturalPages).toBe(4)
    expect(result.targetPages).toBe(4)
    expect(result.pages).toBe(4)
    expect(result.sheets).toBe(2)
    expect(result.reached).toBe(true)
    expect(levels).toEqual([0])
  })

  it('reports the count and skips the search under none', () => {
    const doc = document.createElement('div')
    const fit = settings('none')
    const { count, levels } = counterFrom(fit, () => 7)

    const result = fitDocument({ doc, box: BOX, fit, measure: count })

    expect(result.targetPages).toBeNull()
    expect(result.level).toBe(0)
    expect(result.pages).toBe(7)
    expect(result.sheets).toBe(4)
    expect(result.reached).toBe(true)
    expect(levels).toEqual([0])
  })

  it('picks the smallest level that reaches the target', () => {
    for (const first of [1, 19, LADDER_STEPS]) {
      const doc = document.createElement('div')
      const fit = settings('even')
      const { count } = counterFrom(fit, (level) => (level >= first ? 4 : 5))

      const result = fitDocument({ doc, box: BOX, fit, measure: count })

      expect(result.naturalPages).toBe(5)
      expect(result.targetPages).toBe(4)
      expect(result.level).toBe(first)
      expect(result.pages).toBe(4)
      expect(result.reached).toBe(true)
    }
  })

  it('leaves the document at the compaction it reports', () => {
    const doc = document.createElement('div')
    const fit = settings('exact', 4)
    const { count } = counterFrom(fit, (level) => (level >= 30 ? 4 : 9))

    const result = fitDocument({ doc, box: BOX, fit, measure: count })

    expect(result.level).toBe(30)
    expect(levelOf(doc, fit)).toBe(30)
    expect(doc.style.getPropertyValue('--fp-font-size')).toBe(
      `${result.compaction.fontPx}px`
    )
  })

  it('gives up at the tightest level when the target is out of reach', () => {
    const doc = document.createElement('div')
    const fit = settings('exact', 2)
    const { count } = counterFrom(fit, () => 9)

    const result = fitDocument({ doc, box: BOX, fit, measure: count })

    expect(result.level).toBe(LADDER_STEPS)
    expect(result.targetPages).toBe(2)
    expect(result.naturalPages).toBe(9)
    expect(result.pages).toBe(9)
    expect(result.reached).toBe(false)
    expect(levelOf(doc, fit)).toBe(LADDER_STEPS)
  })
})

describe('fitDocumentAsync', () => {
  it('matches the synchronous fitter when the budget is generous', async () => {
    const fit = settings('exact', 5)
    const pagesByLevel = (level: number) => (level >= 20 ? 5 : 9)
    const sync = fitDocument({
      doc: document.createElement('div'),
      box: BOX,
      fit,
      measure: counterFrom(fit, pagesByLevel).count,
    })
    const async = await fitDocumentAsync({
      doc: document.createElement('div'),
      box: BOX,
      fit,
      measure: counterFrom(fit, pagesByLevel).count,
    })
    expect(async.level).toBe(sync.level)
    expect(async.timedOut).toBe(false)
  })

  it('stops at the last measured level once the deadline has passed', async () => {
    const fit = settings('exact', 5)
    const { count, levels } = counterFrom(fit, () => 9)
    const result = await fitDocumentAsync(
      { doc: document.createElement('div'), box: BOX, fit, measure: count },
      { deadline: performance.now() - 1 }
    )
    expect(result.timedOut).toBe(true)
    expect(result.reached).toBe(false)
    // Only the natural measurement ran before the deadline check.
    expect(levels).toEqual([0])
  })

  it('stops when the signal aborts', async () => {
    const fit = settings('exact', 5)
    const signal = { aborted: false }
    const { count } = counterFrom(fit, (level) => {
      signal.aborted = true
      return level >= 20 ? 5 : 9
    })
    const result = await fitDocumentAsync(
      { doc: document.createElement('div'), box: BOX, fit, measure: count },
      { signal }
    )
    expect(result.timedOut).toBe(true)
  })
})
