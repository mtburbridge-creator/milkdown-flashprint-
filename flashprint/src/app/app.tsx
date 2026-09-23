import { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { replaceAll } from '@milkdown/kit/utils'
import {
  computed,
  defineComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  shallowRef,
  watch,
} from 'vue'

import type { FitResult } from '../core/types'
import type { FindTarget } from './find-replace'
import type { Settings, ViewMode } from './state'

import { resolvePageBox } from '../core'
import { blockMoves } from './block-moves'
import {
  createRefitController,
  FIT_BUDGET_MS,
  type RefitOutcome,
} from './controller'
import { debounce } from './debounce'
import { Dock } from './dock'
import { FindBar } from './find-bar'
import {
  editorFindTarget,
  findReplace,
  textareaFindTarget,
} from './find-replace'
import { highlightMark } from './highlight-mark'
import { linkShortcut } from './link-shortcut'
import { livePreview, setLivePreview } from './live-preview'
import { markdownClipboard } from './markdown-clipboard'
import { updatePageRule } from './page-rule'
import { Preview } from './preview'
import {
  formatShortcut,
  hasModKey,
  IS_MAC,
  ShortcutsPanel,
} from './shortcuts-panel'
import {
  createTouchedFields,
  DEFAULT_SETTINGS,
  lastRefitUnfinished,
  loadMarkdown,
  loadSettings,
  markRefitFinished,
  markRefitStarted,
  nextView,
  SAMPLE_MARKDOWN,
  saveMarkdown,
  saveSettings,
} from './state'
import { typography } from './typography'
import { ViewStrip } from './view-strip'

const MARKDOWN_DEBOUNCE_MS = 250
const SOURCE_DEBOUNCE_MS = 300
const MARKDOWN_FILE_PATTERN = /\.(md|markdown|txt)$/i
const CLIPBOARD_HINT_MS = 4000
const CLIPBOARD_HINT = 'Press Ctrl+V inside the editor'
const STATUS_SEPARATOR = ' · '
const SEGMENT_CLASS = {
  plain: undefined,
  strong: 'status-strong',
  muted: 'status-tail',
} as const
const SAVE_TITLE = `Save as markdown (${formatShortcut(['Mod', 'S'])})`
const MARKDOWN_MIME = 'text/markdown;charset=utf-8'
// Some browsers still read the blob after `click()` returns, so the URL
// must outlive the call.
const REVOKE_DELAY_MS = 10_000
const PRINT_TIPS =
  'In the print dialog choose Landscape (or Portrait for one page per ' +
  'sheet), Margins: None, Scale: 100%, and turn off headers and footers. ' +
  'Page size is set by the app.'

/// Finds or creates the detached root Chromium prints from. It lives
/// outside the Vue tree so a refit can replace its contents without
/// going through reactivity.
function getPrintRoot(): HTMLElement {
  const existing = document.getElementById('fp-print-root')
  if (existing) return existing
  const el = document.createElement('div')
  el.id = 'fp-print-root'
  document.body.appendChild(el)
  return el
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/// The name a download gets: the loaded file's name with a `.md`
/// extension, or a local date stamp when the text was pasted or typed.
function saveFileName(loadedName: string, now: Date): string {
  if (loadedName) return `${loadedName.replace(/\.[^.]*$/, '')}.md`
  const date = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
  return `flashprint-${date}.md`
}

function downloadText(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: MARKDOWN_MIME }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS)
}

function isSlashKey(event: KeyboardEvent): boolean {
  return event.key === '/' || event.code === 'Slash'
}

/// `Ctrl-h` on Windows and Linux, `Cmd-Option-f` on macOS. Option
/// changes `event.key` on macOS, so the code decides there.
function isFindReplaceKey(event: KeyboardEvent): boolean {
  if (event.shiftKey) return false
  if (IS_MAC) return event.altKey && event.code === 'KeyF'
  return !event.altKey && event.key.toLowerCase() === 'h'
}

// CodeMirror binds `Mod-/` to toggle a comment in a code block.
function isInCodeEditor(event: KeyboardEvent): boolean {
  return event.target instanceof Element && !!event.target.closest('.cm-editor')
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

const RECOVERY_NOTICE =
  'The last fit never finished, so the fit settings were reset'

/// One run of status text. `strong` marks the sheet count, the figure
/// that says how much paper the print costs. `muted` dims the type
/// figures, which matter less than the tally.
export interface StatusSegment {
  text: string
  kind: 'plain' | 'strong' | 'muted'
}

/// The paper tally: faces are printed pages, sides are printed sheet
/// faces, and sheets are pieces of paper with both sides used.
function tally(result: FitResult): StatusSegment[] {
  return [
    { text: `${count(result.pages, 'face')} / `, kind: 'plain' },
    { text: `${count(result.sides, 'side')} / `, kind: 'plain' },
    { text: count(result.sheets, 'sheet'), kind: 'strong' },
  ]
}

function plain(text: string): StatusSegment[] {
  return [{ text, kind: 'plain' }]
}

export function formatStatus(
  outcome: RefitOutcome,
  rounding: string
): StatusSegment[] {
  const result = outcome.fit
  const faces = count(result.pages, 'face')
  if (outcome.renderedPages < result.pages) {
    return plain(
      `${faces}; only the first ${outcome.renderedPages} are shown and ` +
        'printed. Shorten the document or lower the font'
    )
  }
  if (result.timedOut) {
    return plain(
      `Fit stopped after ${FIT_BUDGET_MS / 1000} s at ${faces}; ` +
        'shorten the document or lower the font'
    )
  }
  if (!result.reached) {
    return plain(
      `Could not reach ${result.targetPages ?? result.pages} faces at ` +
        `the minimum font size; printing ${faces}`
    )
  }
  if (rounding === 'none') {
    return [...tally(result), { text: ' at default size', kind: 'plain' }]
  }

  const fontPx = result.compaction.fontPx.toFixed(1)
  const lineHeight = result.compaction.lineHeight.toFixed(1)
  return [
    ...tally(result),
    {
      text: `${STATUS_SEPARATOR}font ${fontPx}px${STATUS_SEPARATOR}line ${lineHeight}`,
      kind: 'muted',
    },
  ]
}

/// Settings to start from. When the last refit never finished, the fit
/// settings that drove it are dropped in favour of the defaults, so a
/// reload cannot replay a freeze.
function loadStartSettings(): { settings: Settings; recovered: boolean } {
  const settings = loadSettings()
  const recovered = lastRefitUnfinished()
  if (recovered) {
    markRefitFinished()
    settings.fit = { ...DEFAULT_SETTINGS.fit }
  }
  // Write back at once, so a value the loader capped is gone from storage.
  saveSettings(settings)
  return { settings, recovered }
}

export const App = defineComponent({
  name: 'App',
  setup() {
    const start = loadStartSettings()
    const settings = reactive(start.settings)
    const touched = createTouchedFields()
    const recoveryNotice = ref(start.recovered)

    const editorRootRef = ref<HTMLElement | null>(null)
    const editorSurfaceRef = ref<HTMLElement | null>(null)
    const sourceRef = ref<HTMLTextAreaElement | null>(null)
    const fileInputRef = ref<HTMLInputElement | null>(null)
    const previewSheets = shallowRef<HTMLElement | null>(null)
    const fitResult = shallowRef<RefitOutcome | null>(null)
    const clipboardHint = ref(false)
    const dragActive = ref(false)
    const fileName = ref('')
    const markdownText = ref('')
    const shortcutsOpen = ref(false)
    const findTarget = shallowRef<FindTarget | null>(null)
    const findWithReplace = ref(false)
    const findFocusSignal = ref(0)
    const sourceView = computed(() => settings.editor.view === 'markdown')

    let crepe: Crepe | null = null
    let clipboardHintTimer: ReturnType<typeof setTimeout> | undefined
    let sourcePushTimer: ReturnType<typeof setTimeout> | undefined

    const printRoot = getPrintRoot()

    const controller = createRefitController({
      getEditor: () => crepe?.editor ?? null,
      getSettings: () => settings,
      printRoot,
      onPreviewSheets: (sheets) => {
        previewSheets.value = sheets
      },
      onFit: (outcome) => {
        fitResult.value = outcome
      },
    })

    async function refit() {
      updatePageRule(resolvePageBox(settings.page))
      markRefitStarted()
      try {
        await controller.request()
      } finally {
        markRefitFinished()
      }
    }

    const debouncedMarkdownUpdate = debounce((markdown: string) => {
      saveMarkdown(markdown)
      void refit()
    }, MARKDOWN_DEBOUNCE_MS)

    function cancelSourcePush() {
      if (sourcePushTimer !== undefined) clearTimeout(sourcePushTimer)
      sourcePushTimer = undefined
    }

    function replaceEditorContent(markdown: string) {
      // A push in flight carries older text. Drop it, so it cannot
      // overwrite the markdown that arrives here.
      cancelSourcePush()
      markdownText.value = markdown
      crepe?.editor.action(replaceAll(markdown))
    }

    /// Pushes the text area into the document after a pause in typing.
    /// The text area is never written from `markdownUpdated`, so the
    /// echo of this push cannot move the caret.
    function setSourceText(text: string) {
      markdownText.value = text
      cancelSourcePush()
      sourcePushTimer = setTimeout(() => {
        sourcePushTimer = undefined
        replaceEditorContent(text)
      }, SOURCE_DEBOUNCE_MS)
    }

    function onSourceInput(event: Event) {
      setSourceText((event.target as HTMLTextAreaElement).value)
    }

    function flushSourcePush() {
      if (sourcePushTimer === undefined) return
      replaceEditorContent(markdownText.value)
    }

    /// The markdown on screen. The text area wins in the Markdown view,
    /// because the editor may still wait for its debounced push.
    function currentMarkdown(): string {
      if (sourceView.value) {
        flushSourcePush()
        return markdownText.value
      }
      return crepe?.getMarkdown() ?? markdownText.value
    }

    function saveMarkdownFile() {
      downloadText(currentMarkdown(), saveFileName(fileName.value, new Date()))
    }

    function applyView(view: ViewMode) {
      if (!crepe) return
      setLivePreview(crepe.editor, view === 'live')
      if (view === 'markdown') markdownText.value = crepe.getMarkdown()
    }

    function selectView(view: ViewMode) {
      settings.editor.view = view
    }

    function focusEditingSurface() {
      if (sourceView.value) {
        sourceRef.value?.focus()
        return
      }
      crepe?.editor.action((ctx) => ctx.get(editorViewCtx).focus())
    }

    /// Steps to the next view. A switch hides or removes the focused
    /// surface, so focus follows to the new one when it was there.
    async function cycleView() {
      const active = document.activeElement
      const wasEditing =
        !!active &&
        (active === sourceRef.value ||
          !!editorSurfaceRef.value?.contains(active))
      selectView(nextView(settings.editor.view))
      if (!wasEditing) return
      await nextTick()
      focusEditingSurface()
    }

    function openShortcuts() {
      shortcutsOpen.value = true
    }

    function closeShortcuts() {
      shortcutsOpen.value = false
    }

    /// A find target over the surface of the current view. The text area
    /// exists only after the Markdown view renders.
    function createFindTarget(): FindTarget | null {
      if (!crepe) return null
      if (!sourceView.value) return editorFindTarget(crepe.editor)
      const textarea = sourceRef.value
      return textarea ? textareaFindTarget(textarea, setSourceText) : null
    }

    function openFind(withReplace: boolean) {
      if (withReplace) findWithReplace.value = true
      if (findTarget.value) {
        findFocusSignal.value += 1
        return
      }
      findWithReplace.value = withReplace
      findTarget.value = createFindTarget()
    }

    function closeFind() {
      findTarget.value = null
    }

    /// The action of an app shortcut for a key pressed with `Mod`.
    function shortcutAction(event: KeyboardEvent): (() => void) | null {
      const key = event.key.toLowerCase()
      if (isFindReplaceKey(event)) return () => openFind(true)
      if (event.altKey) return null
      if (isSlashKey(event)) return isInCodeEditor(event) ? null : openShortcuts
      if (event.shiftKey) {
        // Shift turns the key into `>` on many layouts, so match the code.
        return event.code === 'Period' ? () => void cycleView() : null
      }
      if (key === 's') return saveMarkdownFile
      if (key === 'f') return () => openFind(false)
      return null
    }

    // The listener runs in the capture phase. CodeMirror in a code block
    // binds `Mod-f` to its own search, and the app find must win there.
    function onWindowKeydown(event: KeyboardEvent) {
      const mod = hasModKey(event)
      if (shortcutsOpen.value) {
        if (event.key === 'Escape' || (mod && isSlashKey(event))) {
          event.preventDefault()
          closeShortcuts()
        }
        return
      }
      const action = mod ? shortcutAction(event) : null
      if (!action) return
      event.preventDefault()
      event.stopPropagation()
      action()
    }

    async function pasteMarkdown() {
      try {
        const text = await navigator.clipboard.readText()
        fileName.value = ''
        replaceEditorContent(text)
      } catch {
        clipboardHint.value = true
        if (clipboardHintTimer !== undefined) clearTimeout(clipboardHintTimer)
        clipboardHintTimer = setTimeout(() => {
          clipboardHint.value = false
        }, CLIPBOARD_HINT_MS)
      }
    }

    function openFilePicker() {
      fileInputRef.value?.click()
    }

    async function loadMarkdownFile(file: File) {
      const text = await file.text()
      fileName.value = file.name
      replaceEditorContent(text)
    }

    async function onFileInputChange(event: Event) {
      const input = event.target as HTMLInputElement
      const file = input.files?.[0]
      if (file) await loadMarkdownFile(file)
      input.value = ''
    }

    function clearEditor() {
      fileName.value = ''
      replaceEditorContent('')
    }

    async function printDoc() {
      await refit()
      window.print()
    }

    function onDragOver(event: DragEvent) {
      event.preventDefault()
      dragActive.value = true
    }

    function onDragLeave() {
      dragActive.value = false
    }

    function onDrop(event: DragEvent) {
      event.preventDefault()
      dragActive.value = false
      const file = event.dataTransfer?.files[0]
      if (file && MARKDOWN_FILE_PATTERN.test(file.name)) {
        void loadMarkdownFile(file)
      }
    }

    function onFontLoadingDone() {
      void refit()
    }

    onMounted(async () => {
      const saved = loadMarkdown()
      const initialMarkdown = saved && saved.trim() ? saved : SAMPLE_MARKDOWN

      crepe = new Crepe({
        root: editorRootRef.value,
        defaultValue: initialMarkdown,
        features: {
          [Crepe.Feature.TopBar]: false,
        },
      })
      crepe.editor
        .use(markdownClipboard)
        .use(livePreview)
        .use(blockMoves)
        .use(linkShortcut)
        .use(typography)
        .use(highlightMark)
        .use(findReplace)
      crepe.on((api) =>
        api.markdownUpdated((_ctx, markdown) => {
          debouncedMarkdownUpdate(markdown)
        })
      )
      await crepe.create()
      applyView(settings.editor.view)
      window.addEventListener('keydown', onWindowKeydown, true)

      // fitDocument measures against document fonts. Running before
      // they load would size the ladder against fallback metrics.
      await document.fonts.ready
      document.fonts.addEventListener('loadingdone', onFontLoadingDone)
      // A normal unload clears the mark; a frozen tab cannot, and that is
      // what the next load detects.
      window.addEventListener('pagehide', markRefitFinished)

      await refit()
    })

    onBeforeUnmount(() => {
      window.removeEventListener('keydown', onWindowKeydown, true)
      document.fonts.removeEventListener('loadingdone', onFontLoadingDone)
      window.removeEventListener('pagehide', markRefitFinished)
      if (clipboardHintTimer !== undefined) clearTimeout(clipboardHintTimer)
      cancelSourcePush()
      void crepe?.destroy()
    })

    watch(
      settings,
      () => {
        recoveryNotice.value = false
        saveSettings(settings)
      },
      { deep: true }
    )

    // The view mode leaves the document alone, so only the page and fit
    // settings may queue a refit.
    watch(
      () => [settings.page, settings.fit],
      () => {
        void refit()
      },
      { deep: true }
    )

    watch(() => settings.editor.view, applyView)

    // The find bar needs the surface of the new view, and the text area
    // of the Markdown view exists only after the render.
    watch(
      () => settings.editor.view,
      () => {
        if (findTarget.value) findTarget.value = createFindTarget()
      },
      { flush: 'post' }
    )

    const statusSegments = computed<StatusSegment[]>(() => {
      if (clipboardHint.value) return plain(CLIPBOARD_HINT)
      if (recoveryNotice.value) return plain(RECOVERY_NOTICE)
      const result = fitResult.value
      if (!result) return []
      return formatStatus(result, settings.fit.rounding)
    })

    const statusWarning = computed(() => {
      if (recoveryNotice.value) return true
      const outcome = fitResult.value
      if (!outcome) return false
      return (
        !outcome.fit.reached ||
        outcome.fit.timedOut ||
        outcome.renderedPages < outcome.fit.pages
      )
    })

    return () => (
      <div
        class="app-shell"
        onDragover={onDragOver}
        onDragleave={onDragLeave}
        onDrop={onDrop}
      >
        <header class="top-bar">
          <div class="top-bar-title">
            <span class="app-name">FlashPrint</span>
            {fileName.value && <span class="file-name">{fileName.value}</span>}
          </div>
          <div
            class={[
              'status-line',
              statusWarning.value && 'status-warning',
              statusSegments.value.length === 0 && 'is-empty',
            ]}
          >
            <span class="status-dot" />
            {/* The pill is a flex box, so every child is a block. One
                span keeps the whole status on one innerText line. */}
            <span>
              {statusSegments.value.map((segment, index) => (
                <span key={index} class={SEGMENT_CLASS[segment.kind]}>
                  {segment.text}
                </span>
              ))}
            </span>
          </div>
          <div class="top-bar-actions">
            <button type="button" onClick={pasteMarkdown}>
              Paste
            </button>
            <button type="button" onClick={openFilePicker}>
              Open .md
            </button>
            <button type="button" title={SAVE_TITLE} onClick={saveMarkdownFile}>
              Save .md
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,.markdown,.txt"
              class="visually-hidden"
              onChange={onFileInputChange}
            />
            <button type="button" onClick={clearEditor}>
              Clear
            </button>
            <button
              type="button"
              class="primary"
              title={PRINT_TIPS}
              onClick={printDoc}
            >
              Print
            </button>
          </div>
        </header>

        <div class="body-split">
          <div class="editor-pane">
            <ViewStrip
              view={settings.editor.view}
              onSelect={selectView}
              onShowShortcuts={openShortcuts}
            />
            <div class="editor-body">
              <div
                ref={editorSurfaceRef}
                class="editor-surface"
                style={{ display: sourceView.value ? 'none' : '' }}
              >
                <div class="crepe fp-editor" ref={editorRootRef} />
              </div>
              {sourceView.value && (
                <textarea
                  ref={sourceRef}
                  class="markdown-source"
                  aria-label="Markdown source"
                  spellcheck={true}
                  value={markdownText.value}
                  onInput={onSourceInput}
                />
              )}
              {findTarget.value && (
                <FindBar
                  target={findTarget.value}
                  withReplace={findWithReplace.value}
                  focusSignal={findFocusSignal.value}
                  onClose={closeFind}
                />
              )}
            </div>
          </div>
          <div class="preview-pane-wrapper">
            <Preview sheets={previewSheets.value} />
          </div>
        </div>

        <Dock settings={settings} touched={touched} />

        {dragActive.value && (
          <div class="drop-overlay">Drop a .md or .txt file to load it</div>
        )}

        {shortcutsOpen.value && <ShortcutsPanel onClose={closeShortcuts} />}
      </div>
    )
  },
})
