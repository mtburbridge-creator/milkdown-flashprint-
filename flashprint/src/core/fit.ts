import type { FitResult, FitSettings, PageBox } from './types'

import { applyCompaction, compactionAt, LADDER_STEPS } from './ladder'
import { measurePages } from './measure'
import { sheetsFor, sidesFor } from './paper'
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

/// Limits for the asynchronous fitter. Each measurement lays out the whole
/// document, so a long document at a large font can take seconds per step.
export interface FitBudget {
  /// `performance.now()` value after which no new measurement starts.
  deadline?: number
  /// Set `aborted` to stop before the next measurement.
  signal?: { aborted: boolean }
}

// How far the fitter walks back down the ladder to look for a smaller level
// that also fits. The page count is a step function of the level. A late
// reflow, for example a web font that arrives mid search, breaks that order.
const BACKTRACK_STEPS = 4

interface SearchOutcome {
  level: number
  pages: number
  reached: boolean
}

/// The ladder search as a generator: it yields a level to measure and
/// receives that level's page count. One algorithm serves the synchronous
/// and the asynchronous fitter.
function* searchLevels(
  targetPages: number
): Generator<number, SearchOutcome, number> {
  let low = 1
  let high = LADDER_STEPS
  let best = -1
  let bestPages = 0
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const pages = yield mid
    if (pages <= targetPages) {
      best = mid
      bestPages = pages
      high = mid - 1
    } else {
      low = mid + 1
    }
  }

  if (best < 0) {
    const pages = yield LADDER_STEPS
    return { level: LADDER_STEPS, pages, reached: false }
  }

  for (let step = 0; step < BACKTRACK_STEPS && best > 0; step += 1) {
    const pages = yield best - 1
    if (pages > targetPages) break
    best -= 1
    bestPages = pages
  }

  return { level: best, pages: bestPages, reached: true }
}

interface FitRun {
  measureAt: (level: number) => number
  finish: (outcome: SearchOutcome, timedOut: boolean) => FitResult
  /// `null` when no search is needed: rounding is off or the natural
  /// count already meets the target.
  search: Generator<number, SearchOutcome, number> | null
  natural: FitResult
}

function startFit(opts: FitOptions): FitRun {
  const { box, doc, fit } = opts
  const count = opts.measure ?? measurePages

  const measureAt = (level: number): number => {
    applyCompaction(doc, compactionAt(level, fit))
    return count(doc, box)
  }

  const naturalPages = measureAt(0)
  const targetPages = pickTarget(naturalPages, fit)

  const finish = (outcome: SearchOutcome, timedOut: boolean): FitResult => {
    const compaction = compactionAt(outcome.level, fit)
    applyCompaction(doc, compaction)
    const sides = sidesFor(outcome.pages, box)
    return {
      pages: outcome.pages,
      sides,
      sheets: sheetsFor(sides),
      naturalPages,
      targetPages,
      reached: outcome.reached,
      level: outcome.level,
      compaction,
      timedOut,
    }
  }

  const natural = finish(
    { level: 0, pages: naturalPages, reached: true },
    false
  )
  const search =
    targetPages === null || naturalPages <= targetPages
      ? null
      : searchLevels(targetPages)

  return { measureAt, finish, search, natural }
}

/// Shrink the document until it lands on the target page count.
export function fitDocument(opts: FitOptions): FitResult {
  const run = startFit(opts)
  if (!run.search) return run.natural

  let step = run.search.next()
  while (!step.done) step = run.search.next(run.measureAt(step.value))
  return run.finish(step.value, false)
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/// `fitDocument` with a pause before every measurement, so the page stays
/// responsive and the budget can stop the search. When the budget runs out
/// the result is the last level measured, flagged `timedOut`.
export async function fitDocumentAsync(
  opts: FitOptions,
  budget: FitBudget = {}
): Promise<FitResult> {
  const run = startFit(opts)
  if (!run.search) return run.natural

  const exhausted = () =>
    budget.signal?.aborted === true ||
    (budget.deadline !== undefined && performance.now() > budget.deadline)

  // A search only starts when the natural count exceeds the target.
  let last: SearchOutcome = {
    level: 0,
    pages: run.natural.pages,
    reached: false,
  }
  let step = run.search.next()
  while (!step.done) {
    await yieldToBrowser()
    if (exhausted()) return run.finish(last, true)
    const level = step.value
    const pages = run.measureAt(level)
    const target = run.natural.targetPages ?? pages
    last = { level, pages, reached: pages <= target }
    step = run.search.next(pages)
  }
  return run.finish(step.value, false)
}
