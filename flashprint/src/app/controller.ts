import type { Editor } from '@milkdown/kit/core'

import type { FitResult } from '../core/types'
import type { Settings } from './state'

import {
  buildSheets,
  fitDocument,
  renderPrintDoc,
  resolvePageBox,
} from '../core'

export interface RefitTargets {
  /// Container that shows the scaled preview sheets on screen.
  preview: HTMLElement
  /// Container Chromium prints from. Holds unscaled sheets.
  printRoot: HTMLElement
}

export interface RefitDeps {
  getEditor: () => Editor | null
  getSettings: () => Settings
  targets: RefitTargets
}

export interface RefitController {
  /// Runs the fit pipeline and replaces the preview and print root
  /// contents. Returns `null` when the editor is not yet created.
  /// Calling this while a run is in progress queues one more run so
  /// the result reflects the latest settings and markdown.
  request: () => Promise<FitResult | null>
}

export function createRefitController(deps: RefitDeps): RefitController {
  let running = false
  let pending = false
  let current: Promise<FitResult | null> | null = null

  function runOnce(): FitResult | null {
    const editor = deps.getEditor()
    if (!editor) return null

    const settings = deps.getSettings()
    const doc = renderPrintDoc(editor)
    const box = resolvePageBox(settings.page)
    const result = fitDocument({ doc, box, fit: settings.fit })

    // buildSheets may consume the document it is given, so the print
    // root gets a clone rather than sharing a node with the preview.
    const previewSheets = buildSheets(doc, box, result.pages, settings.page)
    const printSheets = buildSheets(
      doc.cloneNode(true) as HTMLElement,
      box,
      result.pages,
      settings.page
    )
    deps.targets.preview.replaceChildren(previewSheets)
    deps.targets.printRoot.replaceChildren(printSheets)

    return result
  }

  async function loop(): Promise<FitResult | null> {
    running = true
    let result: FitResult | null = null
    do {
      pending = false
      result = runOnce()
    } while (pending)
    running = false
    return result
  }

  function request(): Promise<FitResult | null> {
    if (running) {
      pending = true
      return current ?? Promise.resolve(null)
    }
    current = loop()
    return current
  }

  return { request }
}
