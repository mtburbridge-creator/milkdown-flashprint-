import type { Editor } from '@milkdown/kit/core'
import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { Transaction } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'

import { editorViewCtx } from '@milkdown/kit/core'
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

import type { TextRange } from './find-in-text'

import {
  createTextMatcher,
  findInText,
  firstMatchFrom,
  offsetAfterReplaceAll,
  replaceAllInText,
  stepMatch,
} from './find-in-text'

/// `current` is the 0-based index of the active match, or -1 with no match.
export interface FindState {
  count: number
  current: number
}

export type FindListener = (state: FindState) => void

/// One document that the find bar can search. The editor and the
/// markdown text area each provide one.
export interface FindTarget {
  search(query: string, caseSensitive: boolean): FindState
  next(): FindState
  previous(): FindState
  /// Replaces the active match, then moves to the next one.
  replace(replacement: string): FindState
  /// Returns how many matches were replaced.
  replaceAll(replacement: string): number
  /// Removes every highlight and forgets the query.
  clear(): void
  /// The current selection's text, used to prefill the query.
  selectedText(): string
  /// Returns focus to the document, keeping the active match selected.
  focus(): void
  /// Calls `listener` when an edit in the document changes the matches.
  /// Returns a function that stops the calls.
  subscribe?(listener: FindListener): () => void
}

interface FindPluginState {
  query: string
  caseSensitive: boolean
  /// Document ranges, in document order.
  matches: TextRange[]
  current: number
  decorations: DecorationSet
}

const findKey = new PluginKey<FindPluginState>('FLASHPRINT_FIND_REPLACE')

const NO_FIND: FindPluginState = {
  query: '',
  caseSensitive: false,
  matches: [],
  current: -1,
  decorations: DecorationSet.empty,
}

/// Stands in for each inline node that is not text, such as an image.
/// A block string then has one character for each position, so an
/// offset maps to a document position by a plain addition.
const OBJECT_CHAR = String.fromCodePoint(0xfffc)

function blockText(block: ProseNode): string {
  let text = ''
  block.forEach((child) => {
    text += child.isText
      ? (child.text ?? '')
      : OBJECT_CHAR.repeat(child.nodeSize)
  })
  return text
}

/// Finds every match in `doc`. A match stays inside one textblock, so it
/// never spans two paragraphs. Code blocks are textblocks too.
export function findInDoc(
  doc: ProseNode,
  query: string,
  caseSensitive: boolean
): TextRange[] {
  const matches: TextRange[] = []
  if (!query) return matches
  const matcher = createTextMatcher(query, caseSensitive)

  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    const start = pos + 1
    for (const { from, to } of matcher(blockText(node))) {
      matches.push({ from: start + from, to: start + to })
    }
    return false
  })
  return matches
}

/// Crepe renders a code block through CodeMirror, which drops these
/// decorations. A match there gets the selection but no highlight.
function decorate(
  doc: ProseNode,
  matches: readonly TextRange[],
  current: number
): DecorationSet {
  return DecorationSet.create(
    doc,
    matches.map((match, index) =>
      Decoration.inline(match.from, match.to, {
        class:
          index === current ? 'fp-find-match fp-find-current' : 'fp-find-match',
      })
    )
  )
}

/// The search state for `doc`. The active match is the first one that
/// starts at or after `anchor`.
function createFindState(
  doc: ProseNode,
  query: string,
  caseSensitive: boolean,
  anchor: number
): FindPluginState {
  if (!query) return NO_FIND
  const matches = findInDoc(doc, query, caseSensitive)
  const current = firstMatchFrom(matches, anchor)
  return {
    query,
    caseSensitive,
    matches,
    current,
    decorations: decorate(doc, matches, current),
  }
}

/// Replaces each match in `tr`, from the last to the first, so the
/// earlier positions stay valid. The replacement takes the marks of the
/// first character it replaces. An empty replacement deletes the match.
export function replaceMatches(
  tr: Transaction,
  matches: readonly TextRange[],
  replacement: string
): Transaction {
  const { schema } = tr.doc.type
  for (let i = matches.length - 1; i >= 0; i--) {
    const { from, to } = matches[i]!
    if (!replacement) {
      tr.delete(from, to)
      continue
    }
    const marks = tr.doc.resolve(from).nodeAfter?.marks
    tr.replaceWith(from, to, schema.text(replacement, marks))
  }
  return tr
}

function summarize(state: FindPluginState): FindState {
  return { count: state.matches.length, current: state.current }
}

const findListeners = new WeakMap<EditorView, Set<FindListener>>()

/// The ProseMirror plugin that holds the matches and their decorations.
/// A transaction sets a new state through the plugin meta. An edit
/// without that meta runs the last search again on the new document.
export const findPlugin = new Plugin<FindPluginState>({
  key: findKey,
  state: {
    init: () => NO_FIND,
    apply: (tr, value) => {
      const next = tr.getMeta(findKey) as FindPluginState | undefined
      if (next) return next
      if (!tr.docChanged || !value.query) return value
      const active = value.matches[value.current]
      const anchor = active ? tr.mapping.map(active.from) : tr.selection.from
      return createFindState(tr.doc, value.query, value.caseSensitive, anchor)
    },
  },
  props: {
    decorations: (state) => findKey.getState(state)?.decorations,
  },
  view: () => ({
    update: (view, prevState) => {
      const next = findKey.getState(view.state)
      if (!next || next === findKey.getState(prevState)) return
      for (const listener of findListeners.get(view) ?? []) {
        listener(summarize(next))
      }
    },
  }),
})

/// Installed with crepe.editor.use(findReplace) before crepe.create().
export const findReplace: MilkdownPlugin = $prose(() => findPlugin)

/// The nearest ancestor that scrolls vertically.
function scrollParent(node: HTMLElement): HTMLElement | null {
  for (let el = node.parentElement; el; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el)
    const scrolls = overflowY === 'auto' || overflowY === 'scroll'
    if (scrolls && el.scrollHeight > el.clientHeight) return el
  }
  return document.scrollingElement as HTMLElement | null
}

/// Centers a line in `scroller` when any part of it is out of view.
/// `top` is measured from the top of the visible area.
function centerIfHidden(scroller: Element, top: number, height: number) {
  if (top >= 0 && top + height <= scroller.clientHeight) return
  scroller.scrollTop += top - (scroller.clientHeight - height) / 2
}

/// ProseMirror scrolls to the selection only when the DOM selection is
/// inside the editor. The query field holds the focus, so the find bar
/// has to scroll on its own.
function revealPos(view: EditorView, pos: number): void {
  const scroller = scrollParent(view.dom)
  if (!scroller) return
  const rect = view.coordsAtPos(pos)
  const box = scroller.getBoundingClientRect()
  const visibleTop = scroller === document.scrollingElement ? 0 : box.top
  centerIfHidden(scroller, rect.top - visibleTop, rect.bottom - rect.top)
}

/// A find target over a ProseMirror view. `reveal` scrolls a position
/// into view, and tests replace it because a DOM without layout has no
/// coordinates.
export function viewFindTarget(
  getView: () => EditorView,
  reveal: (view: EditorView, pos: number) => void = revealPos
): FindTarget {
  function stateOf(view: EditorView): FindPluginState {
    return findKey.getState(view.state) ?? NO_FIND
  }

  /// Dispatches `tr` with the find state `next`. With `select`, it also
  /// selects the active match. The selection change does not take the
  /// focus, because ProseMirror writes the DOM selection only when the
  /// editor has the focus.
  function commit(
    view: EditorView,
    tr: Transaction,
    next: FindPluginState,
    select: boolean
  ): FindState {
    const match = select ? next.matches[next.current] : undefined
    if (match) {
      tr.setSelection(TextSelection.create(tr.doc, match.from, match.to))
    }
    view.dispatch(tr.setMeta(findKey, next))
    if (match) reveal(view, match.from)
    return summarize(next)
  }

  function move(step: 1 | -1): FindState {
    const view = getView()
    const state = stateOf(view)
    const current = stepMatch(state.current, state.matches.length, step)
    const next = {
      ...state,
      current,
      decorations: decorate(view.state.doc, state.matches, current),
    }
    return commit(view, view.state.tr, next, true)
  }

  return {
    search(query, caseSensitive) {
      const view = getView()
      const { doc, selection } = view.state
      const next = createFindState(doc, query, caseSensitive, selection.from)
      return commit(view, view.state.tr, next, true)
    },
    next: () => move(1),
    previous: () => move(-1),
    replace(replacement) {
      const view = getView()
      const state = stateOf(view)
      const match = state.matches[state.current]
      if (!match) return summarize(state)
      const tr = replaceMatches(view.state.tr, [match], replacement)
      const next = createFindState(
        tr.doc,
        state.query,
        state.caseSensitive,
        match.from + replacement.length
      )
      return commit(view, tr, next, true)
    },
    replaceAll(replacement) {
      const view = getView()
      const state = stateOf(view)
      const count = state.matches.length
      if (count === 0) return 0
      const tr = replaceMatches(view.state.tr, state.matches, replacement)
      const next = createFindState(
        tr.doc,
        state.query,
        state.caseSensitive,
        tr.selection.from
      )
      commit(view, tr, next, false)
      return count
    },
    clear() {
      const view = getView()
      if (view.isDestroyed || stateOf(view) === NO_FIND) return
      view.dispatch(view.state.tr.setMeta(findKey, NO_FIND))
    },
    selectedText() {
      const { doc, selection } = getView().state
      return doc.textBetween(selection.from, selection.to, '\n')
    },
    focus() {
      getView().focus()
    },
    subscribe(listener) {
      const view = getView()
      const listeners = findListeners.get(view) ?? new Set<FindListener>()
      findListeners.set(view, listeners)
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

export function editorFindTarget(editor: Editor): FindTarget {
  return viewFindTarget(() => editor.action((ctx) => ctx.get(editorViewCtx)))
}

const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b)

/// Text area styles that decide where a line wraps.
const MIRRORED_STYLES = [
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'letter-spacing',
  'line-height',
  'padding-left',
  'padding-right',
  'padding-top',
  'tab-size',
  'text-transform',
  'word-spacing',
]

/// A text area has no API for the position of an offset. A hidden copy
/// with the same width and font wraps the text the same way, so a
/// marker at the offset gives its line.
function revealTextOffset(textarea: HTMLTextAreaElement, offset: number) {
  const style = getComputedStyle(textarea)
  const mirror = document.createElement('div')
  for (const name of MIRRORED_STYLES) {
    mirror.style.setProperty(name, style.getPropertyValue(name))
  }
  Object.assign(mirror.style, {
    position: 'absolute',
    top: '0',
    left: '-9999px',
    visibility: 'hidden',
    width: `${textarea.clientWidth}px`,
    boxSizing: 'border-box',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
  })
  mirror.textContent = textarea.value.slice(0, offset)
  const marker = document.createElement('span')
  marker.textContent = ZERO_WIDTH_SPACE
  mirror.append(marker)
  document.body.append(mirror)
  const top = marker.offsetTop
  const height = marker.offsetHeight
  mirror.remove()
  centerIfHidden(textarea, top - textarea.scrollTop, height)
}

/// `onChange` receives the new full text after a replace, because setting
/// `textarea.value` from script fires no input event.
export function textareaFindTarget(
  textarea: HTMLTextAreaElement,
  onChange: (value: string) => void
): FindTarget {
  let query = ''
  let caseSensitive = false
  let matches: TextRange[] = []
  let current = -1
  const listeners = new Set<FindListener>()

  function summary(): FindState {
    return { count: matches.length, current }
  }

  function rescan(anchor: number): void {
    matches = findInText(textarea.value, query, caseSensitive)
    current = firstMatchFrom(matches, anchor)
  }

  /// Selects the active match without focusing the text area. The
  /// selection shows once the text area takes the focus again.
  function show(): FindState {
    const match = matches[current]
    if (match) {
      textarea.setSelectionRange(match.from, match.to)
      revealTextOffset(textarea, match.from)
    }
    return summary()
  }

  function write(value: string, caret: number): void {
    const { scrollTop } = textarea
    textarea.value = value
    textarea.scrollTop = scrollTop
    textarea.setSelectionRange(caret, caret)
    onChange(value)
  }

  function onInput(): void {
    if (!query) return
    rescan(textarea.selectionStart)
    for (const listener of listeners) listener(summary())
  }

  function move(step: 1 | -1): FindState {
    current = stepMatch(current, matches.length, step)
    return show()
  }

  return {
    search(nextQuery, nextCaseSensitive) {
      query = nextQuery
      caseSensitive = nextCaseSensitive
      rescan(textarea.selectionStart)
      return show()
    },
    next: () => move(1),
    previous: () => move(-1),
    replace(replacement) {
      const match = matches[current]
      if (!match) return summary()
      const { value } = textarea
      const caret = match.from + replacement.length
      write(
        value.slice(0, match.from) + replacement + value.slice(match.to),
        caret
      )
      rescan(caret)
      return show()
    },
    replaceAll(replacement) {
      const count = matches.length
      if (count === 0) return 0
      const caret = offsetAfterReplaceAll(
        textarea.selectionStart,
        matches,
        replacement
      )
      write(replaceAllInText(textarea.value, matches, replacement), caret)
      rescan(caret)
      return count
    },
    clear() {
      query = ''
      matches = []
      current = -1
    },
    selectedText() {
      const { value, selectionStart, selectionEnd } = textarea
      return value.slice(selectionStart, selectionEnd)
    },
    focus() {
      textarea.focus({ preventScroll: true })
    },
    subscribe(listener) {
      if (listeners.size === 0) textarea.addEventListener('input', onInput)
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
          textarea.removeEventListener('input', onInput)
        }
      }
    },
  }
}
