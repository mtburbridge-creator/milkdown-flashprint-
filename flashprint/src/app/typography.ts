import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import type { Mark } from '@milkdown/kit/prose/model'
import type {
  Command,
  EditorState,
  Transaction,
} from '@milkdown/kit/prose/state'

import { InputRule, undoInputRule } from '@milkdown/kit/prose/inputrules'
import { $inputRule, $useKeymap } from '@milkdown/kit/utils'

/// A source of the current time. Tests pass a fixed one.
export type Clock = () => Date

// `←>` is what `<->` looks like after the `<-` rule fires, so it comes
// before the single arrows.
const SYMBOLS: readonly [RegExp, string][] = [
  [/←>$/, '↔'],
  [/->$/, '→'],
  [/<-$/, '←'],
  [/=>$/, '⇒'],
  [/\.\.\.$/, '…'],
]

// An `@` inside a word, as in an email address, does not start a stamp.
const STAMP = /(?<![\w@])@(date|time|today)([\s.,;:!?)\]])$/

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/// The local date as `YYYY-MM-DD`.
export function formatDate(now: Date): string {
  const month = pad(now.getMonth() + 1)
  return `${now.getFullYear()}-${month}-${pad(now.getDate())}`
}

/// The local time as `HH:MM` on a 24 hour clock.
export function formatTime(now: Date): string {
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`
}

/// The text that replaces `@date`, `@time`, or `@today`.
export function stamp(word: string, now: Date): string {
  if (word === 'time') return formatTime(now)
  if (word === 'today') return `${formatDate(now)} ${formatTime(now)}`
  return formatDate(now)
}

function hasCodeMark(marks: readonly Mark[]): boolean {
  return marks.some((mark) => mark.type.spec.code)
}

/// Report whether text typed at `end`, which completes a match that starts
/// at `start`, sits in code. A code block and inline code both count.
export function inCode(state: EditorState, start: number, end: number) {
  const $end = state.doc.resolve(end)
  if ($end.parent.type.spec.code) return true
  if (hasCodeMark(state.storedMarks ?? $end.marks())) return true

  let found = false
  if (start < end)
    state.doc.nodesBetween(start, end, (node) => {
      if (node.isInline && hasCodeMark(node.marks)) found = true
      return !found
    })
  return found
}

function replaceRule(
  pattern: RegExp,
  replace: (match: RegExpMatchArray) => string
): InputRule {
  return new InputRule(pattern, (state, match, start, end) => {
    if (inCode(state, start, end)) return null
    return state.tr.insertText(replace(match), start, end)
  })
}

/// The input rules for symbols and time stamps. They read the time from
/// `clock` when they fire.
export function typographyRules(clock: Clock = () => new Date()): InputRule[] {
  const symbols = SYMBOLS.map(([pattern, symbol]) =>
    replaceRule(pattern, () => symbol)
  )
  const stamps = replaceRule(
    STAMP,
    ([, word = '', trailing = '']) => stamp(word, clock()) + trailing
  )
  return [...symbols, stamps]
}

interface UndoableRule {
  transform: Transaction
}

// `prosemirror-inputrules` keeps the last undoable rule in the state of its
// plugin. `undoInputRule` reads the same field.
function lastRule(state: EditorState): UndoableRule | null {
  for (const plugin of state.plugins) {
    const spec = plugin.spec as { isInputRules?: boolean }
    if (!spec.isInputRules) continue
    const rule = plugin.getState(state) as UndoableRule | null
    if (rule) return rule
  }
  return null
}

/// Undo the input rule that fired last, and restore the literal text. It
/// fails when the last change was not an input rule.
///
/// The transaction takes the time of the rule, so the history adds it to
/// the event of the rule. The next undo then removes the typing. It does
/// not bring the replacement back.
export const undoReplacement: Command = (state, dispatch) => {
  const rule = lastRule(state)
  if (!rule) return false
  const time = rule.transform.time
  return undoInputRule(state, dispatch && ((tr) => dispatch(tr.setTime(time))))
}

// A plain history undo reverts the replacement together with the typed
// character, so it never restores the literal text. This binding runs
// before the history undo. It falls through to the history undo when the
// last change was not an input rule.
const undoKeymap = $useKeymap('flashprintTypography', {
  UndoReplacement: {
    shortcuts: 'Mod-z',
    priority: 100,
    command: () => undoReplacement,
  },
})

/// Typing shortcuts for arrows, the ellipsis, and time stamps. `Mod-z`
/// right after a replacement restores the literal text.
export const typography: MilkdownPlugin[] = [
  ...typographyRules().map((rule) => $inputRule(() => rule)),
  ...undoKeymap,
]
