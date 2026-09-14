import type { Editor } from '@milkdown/kit/core'

import type { FitResult } from '../core/types'
import type { Settings } from './state'

import {
  buildSheetsAsync,
  fitDocumentAsync,
  renderPrintDoc,
  resolvePageBox,
} from '../core'

/// Longest time the ladder search may spend measuring. Past it, the fitter
/// stops at the last level measured instead of locking the tab.
export const FIT_BUDGET_MS = 4000

/// Pages that get a rendered clone in the preview and the print root.
/// Every page clones the whole document, so the layout cost grows with the
/// square of the page count. Past this bound the document is far outside
/// what the app is for, and the status line says so.
export const MAX_RENDERED_PAGES = 64

/// Upper bound on page clones times pages per clone, the unit the browser
/// actually lays out. It keeps a build to a few seconds on a laptop.
export const LAYOUT_BUDGET_PAGES = 4096

/// Pages worth cloning for a document of `pages` pages.
export function renderedPagesFor(pages: number): number {
  const affordable = Math.floor(LAYOUT_BUDGET_PAGES / Math.max(1, pages))
  return Math.max(1, Math.min(pages, MAX_RENDERED_PAGES, affordable))
}

export interface RefitOutcome {
  fit: FitResult
  /// Pages the sheets actually show. Below `fit.pages` when the bound above
  /// cut the render short.
  renderedPages: number
}

export interface RefitDeps {
  getEditor: () => Editor | null
  getSettings: () => Settings
  /// The raw print root element Chromium prints from. Not part of the
  /// Vue tree, so the controller replaces its contents directly.
  printRoot: HTMLElement
  /// Hands the preview sheets to the caller as soon as the root exists.
  /// The root fills in over time, so the preview shows progress.
  onPreviewSheets: (sheets: HTMLElement) => void
  /// Reports the fit before the sheets are built, so the status can show
  /// the page count while a long build is still running.
  onFit: (outcome: RefitOutcome) => void
}

export interface RefitController {
  /// Runs the fit pipeline and replaces the preview and print root
  /// contents. Resolves to `null` when the editor is not yet created or
  /// when a newer request superseded this one.
  /// Calling this while a run is in progress aborts the running one at
  /// its next pause and starts over with the latest settings and markdown.
  request: () => Promise<RefitOutcome | null>
}

export function createRefitController(deps: RefitDeps): RefitController {
  let active: { aborted: boolean } | null = null

  async function runOnce(signal: {
    aborted: boolean
  }): Promise<RefitOutcome | null> {
    const editor = deps.getEditor()
    if (!editor) return null

    const settings = deps.getSettings()
    const doc = renderPrintDoc(editor)
    const box = resolvePageBox(settings.page)
    const fit = await fitDocumentAsync(
      { doc, box, fit: settings.fit },
      { deadline: performance.now() + FIT_BUDGET_MS, signal }
    )
    if (signal.aborted) return null

    const outcome = { fit, renderedPages: renderedPagesFor(fit.pages) }
    deps.onFit(outcome)

    const sheetOptions = { maxPages: outcome.renderedPages, signal }
    const preview = await buildSheetsAsync(
      doc,
      box,
      fit.pages,
      settings.page,
      sheetOptions,
      deps.onPreviewSheets
    )
    if (!preview) return null

    // The print root gets its own clone so the two trees share no node.
    const printSheets = await buildSheetsAsync(
      doc.cloneNode(true) as HTMLElement,
      box,
      fit.pages,
      settings.page,
      sheetOptions
    )
    if (!printSheets) return null
    deps.printRoot.replaceChildren(printSheets)

    return outcome
  }

  async function request(): Promise<RefitOutcome | null> {
    if (active) active.aborted = true
    const signal = { aborted: false }
    active = signal
    try {
      return await runOnce(signal)
    } finally {
      if (active === signal) active = null
    }
  }

  return { request }
}
