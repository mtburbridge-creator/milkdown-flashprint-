import {
  defineComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type PropType,
} from 'vue'

import type { FindState, FindTarget } from './find-replace'

import { segmentClass } from './segmented'
import './find-bar.css'

/// Each search walks the whole document. The delay lets a long document
/// skip the searches for the letters typed in between.
const SEARCH_DELAY_MS = 120

const NO_MATCH: FindState = { count: 0, current: -1 }

function countLabel(query: string, state: FindState): string {
  if (!query) return ''
  if (state.count === 0) return 'No results'
  return `${state.current + 1} of ${state.count}`
}

/// Enter inside an input method editor confirms the composed text. It
/// must not also run a find command.
function isPlainEnter(event: KeyboardEvent): boolean {
  return event.key === 'Enter' && !event.isComposing
}

/// Find and replace over one `FindTarget`. The parent swaps `target`
/// when the view changes, and bumps `focusSignal` to focus the query.
export const FindBar = defineComponent({
  props: {
    target: {
      type: Object as PropType<FindTarget>,
      required: true,
    },
    withReplace: {
      type: Boolean,
      default: false,
    },
    focusSignal: {
      type: Number,
      default: 0,
    },
  },
  emits: ['close'],
  setup(props, { emit }) {
    const query = ref('')
    const replacement = ref('')
    const caseSensitive = ref(false)
    const replaceOpen = ref(props.withReplace)
    const findState = ref<FindState>(NO_MATCH)
    const queryField = ref<HTMLInputElement | null>(null)
    const replaceField = ref<HTMLInputElement | null>(null)
    let searchTimer: ReturnType<typeof setTimeout> | undefined
    let stopWatching: (() => void) | undefined

    function cancelSearch(): boolean {
      if (searchTimer === undefined) return false
      clearTimeout(searchTimer)
      searchTimer = undefined
      return true
    }

    function runSearch(): void {
      cancelSearch()
      findState.value = props.target.search(query.value, caseSensitive.value)
    }

    /// Runs a search that is still waiting for its delay. Returns whether
    /// one was waiting.
    function flushSearch(): boolean {
      if (!cancelSearch()) return false
      runSearch()
      return true
    }

    function watchTarget(target: FindTarget): void {
      stopWatching?.()
      stopWatching = target.watch?.((state) => {
        findState.value = state
      })
    }

    /// A pending search selects the first match. The step waits for the
    /// next press, so the first match is not skipped.
    function step(direction: 1 | -1): void {
      if (flushSearch()) return
      findState.value =
        direction === 1 ? props.target.next() : props.target.previous()
    }

    function replaceOne(): void {
      flushSearch()
      findState.value = props.target.replace(replacement.value)
    }

    function replaceAll(): void {
      flushSearch()
      if (props.target.replaceAll(replacement.value) > 0) runSearch()
    }

    function toggleCase(): void {
      caseSensitive.value = !caseSensitive.value
      runSearch()
    }

    async function toggleReplace(): Promise<void> {
      replaceOpen.value = !replaceOpen.value
      if (!replaceOpen.value) return
      await nextTick()
      replaceField.value?.focus()
    }

    function close(): void {
      cancelSearch()
      props.target.focus()
      props.target.clear()
      emit('close')
    }

    async function focusQuery(): Promise<void> {
      const selected = props.target.selectedText()
      if (selected && !selected.includes('\n') && selected !== query.value) {
        query.value = selected
        runSearch()
      }
      await nextTick()
      queryField.value?.focus()
      queryField.value?.select()
    }

    function onQueryInput(event: Event): void {
      query.value = (event.target as HTMLInputElement).value
      if (!query.value) runSearch()
      else {
        cancelSearch()
        searchTimer = setTimeout(runSearch, SEARCH_DELAY_MS)
      }
    }

    function onQueryKeydown(event: KeyboardEvent): void {
      if (!isPlainEnter(event)) return
      event.preventDefault()
      step(event.shiftKey ? -1 : 1)
    }

    function onReplaceKeydown(event: KeyboardEvent): void {
      if (!isPlainEnter(event)) return
      event.preventDefault()
      replaceOne()
    }

    function onBarKeydown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return
      event.preventDefault()
      close()
    }

    /// The post flush lets the parent write the new text area value
    /// first, so the search reads the text of the new view.
    watch(
      () => props.target,
      (target, previous) => {
        previous.clear()
        watchTarget(target)
        if (query.value) runSearch()
      },
      { flush: 'post' }
    )

    watch(
      () => props.focusSignal,
      () => void focusQuery()
    )

    watch(
      () => props.withReplace,
      (withReplace) => {
        if (withReplace) replaceOpen.value = true
      }
    )

    onMounted(() => {
      watchTarget(props.target)
      void focusQuery()
    })

    onBeforeUnmount(() => {
      cancelSearch()
      stopWatching?.()
      props.target.clear()
    })

    return () => (
      <div
        class="fp-find-bar"
        role="search"
        aria-label="Find and replace"
        onKeydown={onBarKeydown}
      >
        <div class="fp-find-row">
          <input
            ref={queryField}
            type="text"
            class="fp-find-field"
            placeholder="Find"
            aria-label="Find"
            autocomplete="off"
            spellcheck={false}
            value={query.value}
            onInput={onQueryInput}
            onKeydown={onQueryKeydown}
          />
          <span class="fp-find-count" aria-live="polite">
            {countLabel(query.value, findState.value)}
          </span>
          <div class="dock-row dock-segmented fp-find-group">
            <button
              type="button"
              class="dock-segment"
              aria-label="Previous match"
              onClick={() => step(-1)}
            >
              ↑
            </button>
            <button
              type="button"
              class="dock-segment"
              aria-label="Next match"
              onClick={() => step(1)}
            >
              ↓
            </button>
          </div>
          <div class="dock-row dock-segmented fp-find-group">
            <button
              type="button"
              class={segmentClass(caseSensitive.value)}
              aria-label="Match case"
              aria-pressed={caseSensitive.value}
              onClick={toggleCase}
            >
              Aa
            </button>
            <button
              type="button"
              class={segmentClass(replaceOpen.value)}
              aria-label="Toggle replace"
              aria-expanded={replaceOpen.value}
              onClick={() => void toggleReplace()}
            >
              ⇄
            </button>
          </div>
          <button
            type="button"
            class="fp-find-close"
            aria-label="Close"
            onClick={close}
          >
            ✕
          </button>
        </div>
        {replaceOpen.value && (
          <div class="fp-find-row">
            <input
              ref={replaceField}
              type="text"
              class="fp-find-field"
              placeholder="Replace"
              aria-label="Replace"
              autocomplete="off"
              spellcheck={false}
              value={replacement.value}
              onInput={(event: Event) => {
                replacement.value = (event.target as HTMLInputElement).value
              }}
              onKeydown={onReplaceKeydown}
            />
            <div class="dock-row dock-segmented fp-find-group">
              <button
                type="button"
                class="dock-segment"
                aria-label="Replace match"
                onClick={replaceOne}
              >
                Replace
              </button>
              <button
                type="button"
                class="dock-segment"
                aria-label="Replace all matches"
                onClick={replaceAll}
              >
                Replace all
              </button>
            </div>
          </div>
        )}
      </div>
    )
  },
})
