import type { FitResult, FitSettings, PageBox } from './types'

import { applyCompaction, compactionAt, LADDER_STEPS } from './ladder'
import { measurePages } from './measure'
import { sheetsFor } from './paper'
import { pickTarget } from './target'

/// Counts the pages of a document at its current compaction.
export type PageCounter = (doc: HTMLElement, box: PageBox) => number

export interface FitOptions {
  /// The rendered document. `fitDocument` leaves it at the chosen compaction.
  doc: HTMLElement
  box: PageBox
  fit: FitSettings
  /// Page counter to use in place of `measurePages`. Tests inject a fake one,
  /// because a real count needs a browser layout.
  measure?: PageCounter
}

// How far the fitter walks back down the ladder to look for a smaller level
// that also fits. The page count is a step function of the level. A late
// reflow, for example a web font that arrives mid search, breaks that order.
const BACKTRACK_STEPS = 4

/// Shrink the document until it lands on the target page count.
export function fitDocument(opts: FitOptions): FitResult {
  const { box, doc, fit } = opts
  const count = opts.measure ?? measurePages

  const measureAt = (level: number): number => {
    applyCompaction(doc, compactionAt(level, fit))
    return count(doc, box)
  }

  const naturalPages = measureAt(0)
  const targetPages = pickTarget(naturalPages, fit)

  const finish = (
    level: number,
    pages: number,
    reached: boolean
  ): FitResult => {
    const compaction = compactionAt(level, fit)
    applyCompaction(doc, compaction)
    return {
      pages,
      sheets: sheetsFor(pages, box),
      naturalPages,
      targetPages,
      reached,
      level,
      compaction,
    }
  }

  if (targetPages === null || naturalPages <= targetPages)
    return finish(0, naturalPages, true)

  let low = 1
  let high = LADDER_STEPS
  let best = -1
  let bestPages = 0
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const pages = measureAt(mid)
    if (pages <= targetPages) {
      best = mid
      bestPages = pages
      high = mid - 1
    } else {
      low = mid + 1
    }
  }

  if (best < 0) {
    const pages = measureAt(LADDER_STEPS)
    return finish(LADDER_STEPS, pages, false)
  }

  for (let step = 0; step < BACKTRACK_STEPS && best > 0; step += 1) {
    const pages = measureAt(best - 1)
    if (pages > targetPages) break
    best -= 1
    bestPages = pages
  }

  return finish(best, bestPages, true)
}
