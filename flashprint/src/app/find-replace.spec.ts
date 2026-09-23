import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { Transaction } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'

import { history, undo } from '@milkdown/kit/prose/history'
import { Schema } from '@milkdown/kit/prose/model'
import { EditorState } from '@milkdown/kit/prose/state'
import { describe, expect, it } from 'vitest'

import { findInDoc, findPlugin, viewFindTarget } from './find-replace'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*' },
    heading: {
      group: 'block',
      content: 'inline*',
      attrs: { level: { default: 1 } },
    },
    code_block: { group: 'block', content: 'text*', marks: '', code: true },
    text: { group: 'inline' },
  },
  marks: { strong: {} },
})

type Inline = string | ProseNode

function inline(content: Inline[]): ProseNode[] {
  return content.map((item) =>
    typeof item === 'string' ? schema.text(item) : item
  )
}

const p = (...content: Inline[]) =>
  schema.node('paragraph', null, inline(content))
const h = (...content: Inline[]) =>
  schema.node('heading', null, inline(content))
const code = (text: string) =>
  schema.node('code_block', null, [schema.text(text)])
const strong = (text: string) => schema.text(text, [schema.mark('strong')])
const doc = (...blocks: ProseNode[]) => schema.node('doc', null, blocks)

/// A stand-in for EditorView. It applies each transaction and counts
/// them.
function createView(content: ProseNode) {
  const view = {
    state: EditorState.create({
      doc: content,
      plugins: [findPlugin, history()],
    }),
    transactions: 0,
    dispatch(tr: Transaction) {
      view.state = view.state.apply(tr)
      view.transactions += 1
    },
    focus() {},
  }
  const target = viewFindTarget(
    () => view as unknown as EditorView,
    () => {}
  )
  return { view, target }
}

describe('findInDoc', () => {
  it('maps block offsets to document positions', () => {
    const content = doc(p('hello world'), h('world'), code('world()'))
    const matches = findInDoc(content, 'world', false)
    expect(matches).toEqual([
      { from: 7, to: 12 },
      { from: 14, to: 19 },
      { from: 21, to: 26 },
    ])
    for (const { from, to } of matches) {
      expect(content.textBetween(from, to)).toBe('world')
    }
  })

  it('never lets a match span two blocks', () => {
    const content = doc(p('foo'), p('bar'))
    expect(findInDoc(content, 'foobar', false)).toEqual([])
    expect(findInDoc(content, 'foo', false)).toHaveLength(1)
  })

  it('matches across marks inside one block', () => {
    const content = doc(p('fo', strong('ob'), 'ar'))
    expect(findInDoc(content, 'foobar', false)).toEqual([{ from: 1, to: 7 }])
  })
})

describe('viewFindTarget', () => {
  it('selects the first match and wraps around both ends', () => {
    const { view, target } = createView(doc(p('a b a'), p('a')))
    expect(target.search('a', false)).toEqual({ count: 3, current: 0 })
    expect(view.state.selection.from).toBe(1)
    expect(target.next()).toEqual({ count: 3, current: 1 })
    expect(target.next()).toEqual({ count: 3, current: 2 })
    expect(view.state.selection.from).toBe(8)
    expect(target.next()).toEqual({ count: 3, current: 0 })
    expect(target.previous()).toEqual({ count: 3, current: 2 })
  })

  it('respects case sensitivity', () => {
    const { target } = createView(doc(p('Cat cat')))
    expect(target.search('cat', false).count).toBe(2)
    expect(target.search('cat', true)).toEqual({ count: 1, current: 0 })
  })

  it('replaces all matches in one transaction and keeps marks', () => {
    const original = doc(p(strong('cat'), ' and cat'), code('cat()'))
    const { view, target } = createView(original)
    target.search('cat', false)
    const before = view.transactions

    expect(target.replaceAll('dog')).toBe(3)
    expect(view.transactions).toBe(before + 1)

    const result = view.state.doc
    expect(result.textContent).toBe('dog and dogdog()')
    const first = result.firstChild!.firstChild!
    expect(first.text).toBe('dog')
    expect(first.marks.map((mark) => mark.type.name)).toEqual(['strong'])
    expect(target.search('cat', false).count).toBe(0)

    undo(view.state, (tr) => view.dispatch(tr))
    expect(view.state.doc.eq(original)).toBe(true)
  })

  it('replaces the active match and moves to the next one', () => {
    const { view, target } = createView(doc(p('x x x')))
    target.search('x', false)
    target.next()
    expect(target.replace('yy')).toEqual({ count: 2, current: 1 })
    expect(view.state.doc.textContent).toBe('x yy x')
    expect(view.state.selection.from).toBe(6)
  })

  it('does not replace the replacement again when it holds the query', () => {
    const { view, target } = createView(doc(p('a b a')))
    target.search('a', false)
    expect(target.replace('aa')).toEqual({ count: 3, current: 2 })
    expect(view.state.doc.textContent).toBe('aa b a')
  })

  it('deletes matches for an empty replacement', () => {
    const { view, target } = createView(doc(p('a-b-c')))
    target.search('-', false)
    expect(target.replaceAll('')).toBe(2)
    expect(view.state.doc.textContent).toBe('abc')
  })

  it('searches again after an edit', () => {
    const { view, target } = createView(doc(p('cat')))
    target.search('cat', false)
    view.dispatch(view.state.tr.insertText(' cat', 4))
    expect(findPlugin.getState(view.state)?.matches).toHaveLength(2)
    expect(target.next()).toEqual({ count: 2, current: 1 })
  })

  it('forgets the query on clear', () => {
    const { view, target } = createView(doc(p('cat')))
    target.search('cat', false)
    target.clear()
    expect(findPlugin.getState(view.state)?.matches).toEqual([])
    view.dispatch(view.state.tr.insertText('cat', 1))
    expect(findPlugin.getState(view.state)?.matches).toEqual([])
  })
})
