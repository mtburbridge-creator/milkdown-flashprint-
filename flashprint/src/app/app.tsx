import { Crepe } from '@milkdown/crepe'
import { replaceAll } from '@milkdown/kit/utils'
import {
  computed,
  defineComponent,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  shallowRef,
  watch,
} from 'vue'

import type { FitResult } from '../core/types'
import type { Settings, ViewMode } from './state'

import { resolvePageBox } from '../core'
import {
  createRefitController,
  FIT_BUDGET_MS,
  type RefitOutcome,
} from './controller'
import { debounce } from './debounce'
import { Dock } from './dock'
import { livePreview, setLivePreview } from './live-preview'
import { markdownClipboard } from './markdown-clipboard'
import { updatePageRule } from './page-rule'
import { Preview } from './preview'
import {
  createTouchedFields,
  DEFAULT_SETTINGS,
  lastRefitUnfinished,
  loadMarkdown,
  loadSettings,
  markRefitFinished,
  markRefitStarted,
  SAMPLE_MARKDOWN,
  saveMarkdown,
  saveSettings,
} from './state'
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
    const fileInputRef = ref<HTMLInputElement | null>(null)
    const previewSheets = shallowRef<HTMLElement | null>(null)
    const fitResult = shallowRef<RefitOutcome | null>(null)
    const clipboardHint = ref(false)
    const dragActive = ref(false)
    const fileName = ref('')
    const markdownText = ref('')
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
    function onSourceInput(event: Event) {
      const text = (event.target as HTMLTextAreaElement).value
      markdownText.value = text
      cancelSourcePush()
      sourcePushTimer = setTimeout(() => {
        sourcePushTimer = undefined
        replaceEditorContent(text)
      }, SOURCE_DEBOUNCE_MS)
    }

    function applyView(view: ViewMode) {
      if (!crepe) return
      setLivePreview(crepe.editor, view === 'live')
      if (view === 'markdown') markdownText.value = crepe.getMarkdown()
    }

    function selectView(view: ViewMode) {
      settings.editor.view = view
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
      crepe.editor.use(markdownClipboard)
      crepe.editor.use(livePreview)
      crepe.on((api) =>
        api.markdownUpdated((_ctx, markdown) => {
          debouncedMarkdownUpdate(markdown)
        })
      )
      await crepe.create()
      applyView(settings.editor.view)

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
            <ViewStrip view={settings.editor.view} onSelect={selectView} />
            <div
              class="editor-surface"
              style={{ display: sourceView.value ? 'none' : '' }}
            >
              <div class="crepe fp-editor" ref={editorRootRef} />
            </div>
            {sourceView.value && (
              <textarea
                class="markdown-source"
                aria-label="Markdown source"
                spellcheck={false}
                value={markdownText.value}
                onInput={onSourceInput}
              />
            )}
          </div>
          <div class="preview-pane-wrapper">
            <Preview sheets={previewSheets.value} />
          </div>
        </div>

        <Dock settings={settings} touched={touched} />

        {dragActive.value && (
          <div class="drop-overlay">Drop a .md or .txt file to load it</div>
        )}
      </div>
    )
  },
})
