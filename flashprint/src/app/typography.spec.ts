import type { Node } from '@milkdown/kit/prose/model'
import type { Command, Plugin, Transaction } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'

import { chainCommands } from '@milkdown/kit/prose/commands'
import { history, undo } from '@milkdown/kit/prose/history'
import { inputRules, undoInputRule } from '@milkdown/kit/prose/inputrules'
import { Schema } from '@milkdown/kit/prose/model'
import { EditorState, TextSelection } from '@milkdown/kit/prose/state'
import { describe, expect, it } from 'vitest'

import {
  formatDate,
  formatTime,
  inCode,
  stamp,
  typographyRules,
  undoReplacement,
} from './typography'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block' },
    code_block: { content: 'text*', group: 'block', code: true },
    text: { group: 'inline' },
  },
  marks: {
    inlineCode: { code: true, inclusive: false },
  },
})

// 2026-03-04 09:05 local time. The month argument counts from zero.
const NOW = new Date(2026, 2, 4, 9, 5)

interface FakeView {
  state: EditorState
  composing: boolean
  typingTime: number | null
  dispatch: (tr: Transaction) => void
}

function editor(block: Node): { view: FakeView; rules: Plugin } {
  const rules = inputRules({ rules: typographyRules(() => NOW) })
  const doc = schema.node('doc', null, [block])
  const state = EditorState.create({
    doc,
    selection: TextSelection.atEnd(doc),
    plugins: [history(), rules],
  })
  const view: FakeView = {
    state,
    composing: false,
    typingTime: null,
    dispatch(tr) {
      if (view.typingTime !== null) tr.setTime(view.typingTime)
      view.state = view.state.apply(tr)
    },
  }
  return { view, rules }
}

// Each character goes through the input rules first, as a keypress does.
function type(target: { view: FakeView; rules: Plugin }, text: string) {
  const { view, rules } = target
  const handleTextInput = rules.props.handleTextInput
  for (const char of text) {
    const { from, to } = view.state.selection
    const handled = handleTextInput?.call(
      rules,
      view as unknown as EditorView,
      from,
      to,
      char,
      () => view.state.tr.insertText(char, from, to)
    )
    if (!handled) view.dispatch(view.state.tr.insertText(char, from, to))
  }
}

function run(view: FakeView, command: Command): boolean {
  return command(view.state, view.dispatch)
}

function typed(text: string): string {
  const target = editor(schema.node('paragraph'))
  type(target, text)
  return target.view.state.doc.textContent
}

describe('typography rules', () => {
  it('replaces arrows and the ellipsis', () => {
    expect(typed('a -> b')).toBe('a → b')
    expect(typed('a <- b')).toBe('a ← b')
    expect(typed('a => b')).toBe('a ⇒ b')
    expect(typed('a <-> b')).toBe('a ↔ b')
    expect(typed('wait...')).toBe('wait…')
  })

  it('leaves dashes alone', () => {
    expect(typed('a -- b --- c')).toBe('a -- b --- c')
  })

  it('stamps the date and time and keeps the trailing character', () => {
    expect(typed('on @date ')).toBe('on 2026-03-04 ')
    expect(typed('at @time.')).toBe('at 09:05.')
    expect(typed('(@today)')).toBe('(2026-03-04 09:05)')
  })

  it('does not stamp an email address', () => {
    expect(typed('me@date.')).toBe('me@date.')
  })

  it('does not fire in a code block', () => {
    const target = editor(schema.node('code_block'))
    type(target, 'a -> b...')
    expect(target.view.state.doc.textContent).toBe('a -> b...')
  })

  it('does not fire in inline code', () => {
    const code = schema.marks.inlineCode!.create()
    const target = editor(schema.node('paragraph', null, [schema.text('x')]))
    const { view } = target
    view.dispatch(view.state.tr.setStoredMarks([code]))
    type(target, '->')
    expect(view.state.doc.textContent).toBe('x->')
  })

  it('guards a match whose first character is inline code', () => {
    const code = schema.marks.inlineCode!.create()
    const paragraph = schema.node('paragraph', null, [schema.text('-', [code])])
    const doc = schema.node('doc', null, [paragraph])
    const state = EditorState.create({ doc })
    expect(inCode(state, 1, 2)).toBe(true)
  })

  it('restores the literal text with one backspace', () => {
    const target = editor(schema.node('paragraph'))
    type(target, 'go ->')
    expect(run(target.view, undoInputRule)).toBe(true)
    expect(target.view.state.doc.textContent).toBe('go ->')
  })

  it('never restores the literal text with a plain history undo', () => {
    const target = editor(schema.node('paragraph'))
    type(target, 'go ->')
    expect(run(target.view, undo)).toBe(true)
    expect(target.view.state.doc.textContent).not.toBe('go ->')
  })

  it('restores the literal text with one undo, then undoes the typing', () => {
    const modZ = chainCommands(undoReplacement, undo)
    const target = editor(schema.node('paragraph'))
    // The typing happens long before the undo, past the history group delay.
    target.view.typingTime = 1000
    type(target, 'go ->')
    target.view.typingTime = null

    expect(run(target.view, modZ)).toBe(true)
    expect(target.view.state.doc.textContent).toBe('go ->')
    expect(run(target.view, modZ)).toBe(true)
    expect(target.view.state.doc.textContent).toBe('')
  })

  it('falls through when the last change was not a replacement', () => {
    const target = editor(schema.node('paragraph'))
    type(target, 'go')
    expect(run(target.view, undoReplacement)).toBe(false)
  })
})

describe('time stamps', () => {
  it('pads the date and time', () => {
    expect(formatDate(NOW)).toBe('2026-03-04')
    expect(formatTime(NOW)).toBe('09:05')
  })

  it('picks the stamp for each word', () => {
    const late = new Date(2026, 11, 31, 23, 59)
    expect(stamp('date', late)).toBe('2026-12-31')
    expect(stamp('time', late)).toBe('23:59')
    expect(stamp('today', late)).toBe('2026-12-31 23:59')
  })
})
