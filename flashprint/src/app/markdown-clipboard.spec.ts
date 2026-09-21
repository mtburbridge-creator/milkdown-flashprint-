import type { Node } from '@milkdown/kit/prose/model'

import { Fragment, Schema, Slice } from '@milkdown/kit/prose/model'
import { describe, expect, it, vi } from 'vitest'

import {
  inlineContentOf,
  isUnmarkedText,
  sliceToMarkdown,
  trimOneTrailingNewline,
} from './markdown-clipboard'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block' },
    heading: { content: 'inline*', group: 'block' },
    text: { group: 'inline' },
  },
  marks: {
    strong: {},
  },
})

const { doc, heading, paragraph } = schema.nodes

function sliceOf(...nodes: Node[]): Slice {
  return new Slice(Fragment.from(nodes), 0, 0)
}

function text(value: string, marked = false): Node {
  const strong = schema.marks.strong
  if (!marked || !strong) return schema.text(value)

  return schema.text(value, [strong.create()])
}

function node(name: 'paragraph' | 'heading', ...content: Node[]): Node {
  const type = name === 'paragraph' ? paragraph : heading
  if (!type) throw new Error(`missing node type: ${name}`)

  return type.create(undefined, content)
}

function serializerOf(markdown: string) {
  return vi.fn((_: Node) => markdown)
}

describe('isUnmarkedText', () => {
  it('accepts a single text node', () => {
    expect(isUnmarkedText({ type: 'text', text: 'hello' })).toBe(true)
  })

  it('accepts a block that wraps a single text node', () => {
    const block = { type: 'paragraph', content: [{ type: 'text' }] }
    expect(isUnmarkedText(block)).toBe(true)
  })

  it('rejects a block with several children', () => {
    const block = {
      type: 'paragraph',
      content: [{ type: 'text' }, { type: 'text', marks: [] }],
    }
    expect(isUnmarkedText(block)).toBe(false)
  })

  it('rejects several blocks', () => {
    expect(isUnmarkedText([{ type: 'paragraph' }, { type: 'heading' }])).toBe(
      false
    )
  })

  it('rejects missing content', () => {
    expect(isUnmarkedText(null)).toBe(false)
    expect(isUnmarkedText(undefined)).toBe(false)
  })
  it('rejects a single text node that carries a mark', () => {
    expect(
      isUnmarkedText({
        type: 'text',
        text: 'hello',
        marks: [{ type: 'strong' }],
      })
    ).toBe(false)
  })

  it('accepts a text node whose mark list is empty', () => {
    expect(isUnmarkedText({ type: 'text', text: 'hello', marks: [] })).toBe(
      true
    )
  })
})

describe('trimOneTrailingNewline', () => {
  it('removes one trailing newline', () => {
    expect(trimOneTrailingNewline('a heading\n')).toBe('a heading')
  })

  it('keeps the second trailing newline', () => {
    expect(trimOneTrailingNewline('a heading\n\n')).toBe('a heading\n')
  })

  it('keeps text that ends without a newline', () => {
    expect(trimOneTrailingNewline('a heading')).toBe('a heading')
  })
})

describe('sliceToMarkdown', () => {
  it('reads a pure text slice without the serializer', () => {
    const serializer = serializerOf('unused')
    const slice = sliceOf(text('plain words'))

    expect(sliceToMarkdown(slice, schema, serializer)).toBe('plain words')
    expect(serializer).not.toHaveBeenCalled()
  })

  it('serializes a block that mixes marked and plain text', () => {
    const serializer = serializerOf('**bold** and plain\n')
    const slice = sliceOf(node('paragraph', text('bold', true), text(' and')))

    expect(sliceToMarkdown(slice, schema, serializer)).toBe(
      '**bold** and plain'
    )
    expect(serializer).toHaveBeenCalledOnce()
    const [serialized] = serializer.mock.calls[0] ?? []
    expect(serialized?.type).toBe(doc)
  })

  it('serializes a slice that spans several blocks', () => {
    const serializer = serializerOf('* an item\n\n# A heading\n')
    const slice = sliceOf(
      node('paragraph', text('an item')),
      node('heading', text('A heading'))
    )

    expect(sliceToMarkdown(slice, schema, serializer)).toBe(
      '* an item\n\n# A heading'
    )
  })

  it('keeps the blank lines inside the markdown', () => {
    const serializer = serializerOf('first\n\n\nlast\n')
    const slice = sliceOf(
      node('paragraph', text('first')),
      node('paragraph', text('last'))
    )

    expect(sliceToMarkdown(slice, schema, serializer)).toBe('first\n\n\nlast')
  })

  it('reads a block with one text run as plain text', () => {
    const serializer = serializerOf('unused')
    const slice = sliceOf(node('paragraph', text('one line')))

    expect(sliceToMarkdown(slice, schema, serializer)).toBe('one line')
    expect(serializer).not.toHaveBeenCalled()
  })

  describe('sliceToMarkdown keeps marks on a single run', () => {
    it('serializes a fully bold paragraph instead of copying bare text', () => {
      const serializer = serializerOf('**bold run**\n')
      const slice = sliceOf(node('paragraph', text('bold run', true)))

      expect(sliceToMarkdown(slice, schema, serializer)).toBe('**bold run**')
      expect(serializer).toHaveBeenCalledOnce()
    })
  })
})

describe('inlineContentOf', () => {
  it('ignores a slice with closed ends', () => {
    const slice = sliceOf(node('paragraph', text('plain')))
    expect(inlineContentOf(slice)).toBeNull()
  })

  it('unwraps the blocks around an inline selection', () => {
    const inner = node('paragraph', text('bold run', true))
    const slice = new Slice(Fragment.from(inner), 1, 1)
    const inline = inlineContentOf(slice)
    expect(inline?.childCount).toBe(1)
    expect(inline?.child(0).text).toBe('bold run')
  })

  it('ignores a selection that spans whole blocks', () => {
    const slice = new Slice(
      Fragment.from([
        node('paragraph', text('one')),
        node('paragraph', text('two')),
      ]),
      1,
      1
    )
    expect(inlineContentOf(slice)).toBeNull()
  })
})

describe('sliceToMarkdown on a partial inline selection', () => {
  it('drops the wrappers so no unselected marker appears', () => {
    const serializer = vi.fn((n: Node) => `${n.textContent}!\n`)
    const inner = node('paragraph', text('bold run', true))
    const slice = new Slice(Fragment.from(inner), 1, 1)

    expect(sliceToMarkdown(slice, schema, serializer)).toBe('bold run!')
    const served = serializer.mock.calls[0]?.[0]
    expect(served?.childCount).toBe(1)
    expect(served?.child(0).type.name).toBe('paragraph')
  })
})
