import type { Node } from '@milkdown/kit/prose/model'

import { Schema } from '@milkdown/kit/prose/model'
import { describe, expect, it } from 'vitest'

import { wordAt } from './word-at'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block' },
    image: { inline: true, group: 'inline' },
    text: { group: 'inline' },
  },
})

function paragraph(...content: (Node | string)[]): Node {
  const children = content
    .filter((child) => child !== '')
    .map((child) => (typeof child === 'string' ? schema.text(child) : child))
  return schema.node('doc', null, [schema.node('paragraph', null, children)])
}

// The text of a range, with the caret written as `|` in the source.
function wordText(source: string): string | null {
  const caret = source.indexOf('|')
  const doc = paragraph(source.replace('|', ''))
  // The paragraph content starts at position 1.
  const range = wordAt(doc, caret + 1)
  return range ? doc.textBetween(range.from, range.to) : null
}

describe('wordAt', () => {
  it('takes the word around a caret inside it', () => {
    expect(wordText('one tw|o three')).toBe('two')
  })

  it('takes the word that ends at the caret', () => {
    expect(wordText('one two| three')).toBe('two')
    expect(wordText('one two|')).toBe('two')
  })

  it('finds no word for a caret after a space or at a word start', () => {
    expect(wordText('one |two three')).toBeNull()
    expect(wordText('|one')).toBeNull()
  })

  it('finds no word between spaces or punctuation', () => {
    expect(wordText('one  |  two')).toBeNull()
    expect(wordText('one, |; two')).toBeNull()
    expect(wordText('|')).toBeNull()
  })

  it('keeps letters with accents and digits in the word', () => {
    expect(wordText('a café|2 b')).toBe('café2')
  })

  it('stops at an inline node that is not text', () => {
    const doc = paragraph('ab', schema.node('image'), 'cd')
    // Position 2 sits between `a` and `b`, and position 5 after `c`.
    expect(wordAt(doc, 2)).toEqual({ from: 1, to: 3 })
    expect(wordAt(doc, 5)).toEqual({ from: 4, to: 6 })
  })

  it('finds no word outside inline content', () => {
    expect(wordAt(paragraph('word'), 0)).toBeNull()
  })
})
