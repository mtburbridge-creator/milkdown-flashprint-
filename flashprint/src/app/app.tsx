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

import { resolvePageBox } from '../core'
import { createRefitController } from './controller'
import { Controls } from './controls'
import { debounce } from './debounce'
import { updatePageRule } from './page-rule'
import { Preview } from './preview'
import {
  createTouchedFields,
  loadMarkdown,
  loadSettings,
  SAMPLE_MARKDOWN,
  saveMarkdown,
  saveSettings,
} from './state'

const MARKDOWN_DEBOUNCE_MS = 250
const MARKDOWN_FILE_PATTERN = /\.(md|markdown|txt)$/i
const CLIPBOARD_HINT_MS = 4000

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

function formatStatus(result: FitResult, rounding: string): string {
  if (rounding === 'none') {
    return `${result.pages} pages on ${result.sheets} sheets at default size`
  }
  if (!result.reached) {
    return (
      `Could not reach ${result.targetPages ?? result.pages} pages at ` +
      `the minimum font size; printing ${result.pages} pages`
    )
  }
  const fontPx = result.compaction.fontPx.toFixed(1)
  const lineHeight = result.compaction.lineHeight.toFixed(1)
  return (
    `${result.pages} pages on ${result.sheets} sheets · font ${fontPx}px ` +
    `· line ${lineHeight}`
  )
}

export const App = defineComponent({
  name: 'App',
  setup() {
    const settings = reactive(loadSettings())
    const touched = createTouchedFields()

    const editorRootRef = ref<HTMLElement | null>(null)
    const fileInputRef = ref<HTMLInputElement | null>(null)
    const previewSheets = shallowRef<HTMLElement | null>(null)
    const fitResult = shallowRef<FitResult | null>(null)
    const clipboardHint = ref(false)
    const dragActive = ref(false)

    let crepe: Crepe | null = null
    let clipboardHintTimer: ReturnType<typeof setTimeout> | undefined

    const printRoot = getPrintRoot()

    const controller = createRefitController({
      getEditor: () => crepe?.editor ?? null,
      getSettings: () => settings,
      printRoot,
      onPreviewSheets: (sheets) => {
        previewSheets.value = sheets
      },
    })

    async function refit() {
      updatePageRule(resolvePageBox(settings.page))
      const result = await controller.request()
      if (result) fitResult.value = result
    }

    const debouncedMarkdownUpdate = debounce((markdown: string) => {
      saveMarkdown(markdown)
      void refit()
    }, MARKDOWN_DEBOUNCE_MS)

    function replaceEditorContent(markdown: string) {
      crepe?.editor.action(replaceAll(markdown))
    }

    async function pasteMarkdown() {
      try {
        const text = await navigator.clipboard.readText()
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
      replaceEditorContent(text)
    }

    async function onFileInputChange(event: Event) {
      const input = event.target as HTMLInputElement
      const file = input.files?.[0]
      if (file) await loadMarkdownFile(file)
      input.value = ''
    }

    function clearEditor() {
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
      crepe.on((api) =>
        api.markdownUpdated((_ctx, markdown) => {
          debouncedMarkdownUpdate(markdown)
        })
      )
      await crepe.create()

      // fitDocument measures against document fonts. Running before
      // they load would size the ladder against fallback metrics.
      await document.fonts.ready
      document.fonts.addEventListener('loadingdone', onFontLoadingDone)

      await refit()
    })

    onBeforeUnmount(() => {
      document.fonts.removeEventListener('loadingdone', onFontLoadingDone)
      if (clipboardHintTimer !== undefined) clearTimeout(clipboardHintTimer)
      void crepe?.destroy()
    })

    watch(
      settings,
      () => {
        saveSettings(settings)
        void refit()
      },
      { deep: true }
    )

    const statusText = computed(() => {
      const result = fitResult.value
      if (!result) return ''
      return formatStatus(result, settings.fit.rounding)
    })

    const statusWarning = computed(() => fitResult.value?.reached === false)

    return () => (
      <div
        class="app-shell"
        onDragover={onDragOver}
        onDragleave={onDragLeave}
        onDrop={onDrop}
      >
        <header class="top-bar">
          <span class="app-name">FlashPrint</span>
          <div class="top-bar-actions">
            <button type="button" onClick={pasteMarkdown}>
              Paste markdown
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
            <button type="button" class="primary" onClick={printDoc}>
              Print
            </button>
          </div>
          <div class={['status-line', statusWarning.value && 'status-warning']}>
            {clipboardHint.value
              ? 'Press Ctrl+V inside the editor'
              : statusText.value}
          </div>
        </header>

        <div class="body-split">
          <div class="editor-pane">
            <div class="crepe fp-editor" ref={editorRootRef} />
          </div>
          <div class="side-pane">
            <div class="controls-panel">
              <Controls settings={settings} touched={touched} />
            </div>
            <div class="preview-pane-wrapper">
              <Preview sheets={previewSheets.value} />
            </div>
          </div>
        </div>

        {dragActive.value && (
          <div class="drop-overlay">Drop a .md or .txt file to load it</div>
        )}
      </div>
    )
  },
})
