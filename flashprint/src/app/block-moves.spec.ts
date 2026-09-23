import type { Node } from '@milkdown/kit/prose/model'
import type { Command, Transaction } from '@milkdown/kit/prose/state'

import { undo, history } from '@milkdown/kit/prose/history'
import { Schema } from '@milkdown/kit/prose/model'
import {
  EditorState,
  NodeSelection,
  TextSelection,
} from '@milkdown/kit/prose/state'
import { describe, expect, it } from 'vitest'

import { duplicateBlock, moveBlock } from './block-moves'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block' },
    heading: { content: 'inline*', group: 'block' },
    blockquote: { content: 'block+', group: 'block' },
    code_block: { content: 'text*', group: 'block', code: true },
    bullet_list: { content: 'list_item+', group: 'block' },
    ordered_list: { content: 'list_item+', group: 'block' },
    list_item: { content: 'block+' },
    hr: { group: 'block' },
    table: { content: 'paragraph+', group: 'block' },
    text: { group: 'inline' },
  },
})

function node(name: string, ...content: (Node | string)[]): Node {
  const type = schema.nodes[name]
  if (!type) throw new Error(`missing node type: ${name}`)
  const children = content.map((child) =>
    typeof child === 'string' ? schema.text(child) : child
  )
  return type.create(null, children)
}

const p = (text: string) => node('paragraph', text)
const item = (text: string) => node('list_item', p(text))

// The position where the text `needle` starts.
function posOf(doc: Node, needle: string): number {
  let found = -1
  doc.descendants((child, pos) => {
    if (found >= 0) return false
    if (child.isText && child.text?.includes(needle))
      found = pos + child.text.indexOf(needle)
    return true
  })
  if (found < 0) throw new Error(`missing text: ${needle}`)
  return found
}

function stateAt(doc: Node, anchor: string, head = anchor): EditorState {
  const selection = TextSelection.create(
    doc,
    posOf(doc, anchor),
    posOf(doc, head)
  )
  return EditorState.create({ doc, selection, plugins: [history()] })
}

function run(state: EditorState, command: Command): EditorState {
  let next = state
  const handled = command(state, (tr: Transaction) => {
    next = state.apply(tr)
  })
  expect(handled).toBe(true)
  return next
}

function texts(doc: Node): string[] {
  const out: string[] = []
  doc.forEach((child) => out.push(child.textContent))
  return out
}

describe('moveBlock', () => {
  const doc = node('doc', p('one'), p('two'), p('three'))

  it('swaps the block with the previous one', () => {
    const next = run(stateAt(doc, 'wo'), moveBlock(-1))
    expect(texts(next.doc)).toEqual(['two', 'one', 'three'])
  })

  it('swaps the block with the next one', () => {
    const next = run(stateAt(doc, 'wo'), moveBlock(1))
    expect(texts(next.doc)).toEqual(['one', 'three', 'two'])
  })

  it('keeps the caret at the same place inside the block', () => {
    const next = run(stateAt(doc, 'wo'), moveBlock(-1))
    expect(next.selection.from).toBe(posOf(next.doc, 'wo'))
    expect(next.selection.empty).toBe(true)
  })

  it('does nothing at the edge and still handles the key', () => {
    const top = stateAt(doc, 'ne')
    expect(run(top, moveBlock(-1)).doc.eq(doc)).toBe(true)
    const bottom = stateAt(doc, 'hree')
    expect(run(bottom, moveBlock(1)).doc.eq(doc)).toBe(true)
  })

  it('moves a run of selected blocks as one unit', () => {
    const four = node('doc', p('one'), p('two'), p('three'), p('four'))
    const next = run(stateAt(four, 'wo', 'hree'), moveBlock(-1))
    expect(texts(next.doc)).toEqual(['two', 'three', 'one', 'four'])
    expect(next.selection.from).toBe(posOf(next.doc, 'wo'))
    expect(next.selection.to).toBe(posOf(next.doc, 'hree'))
  })

  it('moves a list item inside its list', () => {
    const listDoc = node(
      'doc',
      p('before'),
      node('bullet_list', item('a1'), item('a2')),
      p('after')
    )
    const up = run(stateAt(listDoc, '2'), moveBlock(-1))
    expect(up.doc.child(1).type.name).toBe('bullet_list')
    expect(texts(up.doc.child(1))).toEqual(['a2', 'a1'])
    expect(up.selection.from).toBe(posOf(up.doc, '2'))

    const edge = run(up, moveBlock(-1))
    expect(edge.doc.eq(up.doc)).toBe(true)
  })

  it('moves a nested list item inside its own list', () => {
    const nested = node(
      'doc',
      node(
        'bullet_list',
        node('list_item', p('outer'), node('bullet_list', item('x'), item('y')))
      )
    )
    const next = run(stateAt(nested, 'y'), moveBlock(-1))
    const inner = next.doc.child(0).child(0).child(1)
    expect(texts(inner)).toEqual(['y', 'x'])
  })

  it('moves the whole top level block from inside a blockquote', () => {
    const quoted = node('doc', p('one'), node('blockquote', p('quote')))
    const next = run(stateAt(quoted, 'uo'), moveBlock(-1))
    expect(next.doc.child(0).type.name).toBe('blockquote')
  })

  it('moves a selected node', () => {
    const withRule = node('doc', p('one'), node('hr'), p('two'))
    const selection = NodeSelection.create(withRule, withRule.child(0).nodeSize)
    const state = EditorState.create({ doc: withRule, selection })
    const next = run(state, moveBlock(-1))
    expect(next.doc.child(0).type.name).toBe('hr')
    expect(next.selection).toBeInstanceOf(NodeSelection)
    expect(next.selection.from).toBe(0)
  })

  it('undoes in one step and keeps the typing before it', () => {
    const start = stateAt(doc, 'wo')
    const typed = start.apply(start.tr.insertText('x'))
    const moved = run(typed, moveBlock(-1))
    const undone = run(moved, undo)
    expect(texts(undone.doc)).toEqual(['one', 'txwo', 'three'])
  })
})

describe('duplicateBlock', () => {
  const doc = node('doc', p('one'), p('two'))

  it('inserts a copy above and selects inside the copy', () => {
    const state = stateAt(doc, 'ne')
    const next = run(state, duplicateBlock(-1))
    expect(texts(next.doc)).toEqual(['one', 'one', 'two'])
    expect(next.selection.from).toBe(state.selection.from)
  })

  it('inserts a copy below and selects inside the copy', () => {
    const state = stateAt(doc, 'ne')
    const next = run(state, duplicateBlock(1))
    expect(texts(next.doc)).toEqual(['one', 'one', 'two'])
    const shift = doc.child(0).nodeSize
    expect(next.selection.from).toBe(state.selection.from + shift)
  })

  it('copies a list item inside its list', () => {
    const listDoc = node('doc', node('ordered_list', item('a1'), item('a2')))
    const next = run(stateAt(listDoc, '1'), duplicateBlock(1))
    expect(next.doc.childCount).toBe(1)
    expect(texts(next.doc.child(0))).toEqual(['a1', 'a1', 'a2'])
  })
})
