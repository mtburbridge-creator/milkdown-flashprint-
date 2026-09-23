import type { Node } from '@milkdown/kit/prose/model'

import { defaultValueCtx, Editor, editorViewCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { DOMParser, DOMSerializer } from '@milkdown/kit/prose/model'
import { getMarkdown } from '@milkdown/kit/utils'
import { describe, expect, it } from 'vitest'

import type { MdNode } from './highlight-mark'

import { highlightMark, splitHighlights } from './highlight-mark'

const text = (value: string): MdNode => ({ type: 'text', value })

function split(...children: MdNode[]): MdNode[] {
  const paragraph: MdNode = { type: 'paragraph', children }
  splitHighlights(paragraph)
  return paragraph.children ?? []
}

describe('splitHighlights', () => {
  it('leaves plain text alone', () => {
    const plain = text('no marks here')
    expect(split(plain)).toEqual([plain])
  })

  it('splits one highlight', () => {
    expect(split(text('a ==b c== d'))).toEqual([
      text('a '),
      { type: 'highlight', children: [text('b c')] },
      text(' d'),
    ])
  })

  it('splits two highlights', () => {
    expect(split(text('==a== and ==b=='))).toEqual([
      { type: 'highlight', children: [text('a')] },
      text(' and '),
      { type: 'highlight', children: [text('b')] },
    ])
  })

  it('keeps an unmatched delimiter literal', () => {
    expect(split(text('a ==b c'))).toEqual([text('a ==b c')])
    expect(split(text('x==y'))).toEqual([text('x==y')])
  })

  it('keeps a delimiter next to white space or another = literal', () => {
    expect(split(text('a == b == c'))).toEqual([text('a == b == c')])
    expect(split(text('a === b === c'))).toEqual([text('a === b === c')])
    expect(split(text('====='))).toEqual([text('=====')])
  })

  it('keeps delimiters inside inline code literal', () => {
    const code: MdNode = { type: 'inlineCode', value: '==a==' }
    expect(split(text('see '), code)).toEqual([text('see '), code])
  })

  it('wraps other inline nodes', () => {
    const strong: MdNode = { type: 'strong', children: [text('b')] }
    expect(split(text('==a '), strong, text('=='))).toEqual([
      { type: 'highlight', children: [text('a '), strong] },
    ])
  })

  it('splits inside a nested node', () => {
    expect(split({ type: 'strong', children: [text('==a==')] })).toEqual([
      {
        type: 'strong',
        children: [{ type: 'highlight', children: [text('a')] }],
      },
    ])
  })
})

async function withEditor<T>(
  markdown: string,
  run: (editor: Editor) => T
): Promise<T> {
  const editor = Editor.make()
    .config((ctx) => ctx.set(defaultValueCtx, markdown))
    .use(commonmark)
    .use(highlightMark)
  await editor.create()
  try {
    return run(editor)
  } finally {
    await editor.destroy()
  }
}

function roundTrip(markdown: string): Promise<string> {
  return withEditor(markdown, (editor) => editor.action(getMarkdown()))
}

function highlightedText(doc: Node): string[] {
  const out: string[] = []
  doc.descendants((node) => {
    if (node.marks.some((mark) => mark.type.name === 'highlight'))
      out.push(node.text ?? '')
  })
  return out
}

describe('highlight markdown', () => {
  it('parses ==text== into the mark', async () => {
    const marked = await withEditor('a ==b== c', (editor) =>
      editor.action((ctx) => highlightedText(ctx.get(editorViewCtx).state.doc))
    )
    expect(marked).toEqual(['b'])
  })

  it('writes the mark back as ==text== without escapes', async () => {
    expect(await roundTrip('a ==b c== d\n')).toBe('a ==b c== d\n')
    expect(await roundTrip('==start== of a line\n')).toBe(
      '==start== of a line\n'
    )
    expect(await roundTrip('# ==Title==\n')).toBe('# ==Title==\n')
    expect(await roundTrip('==a **b**==\n')).toBe('==a **b**==\n')
    expect(await roundTrip('**==a==** x\n')).toBe('**==a==** x\n')
    expect(await roundTrip('* ==item== one\n')).toBe('* ==item== one\n')
    expect(await roundTrip('mid==word==s\n')).toBe('mid==word==s\n')
  })

  it('keeps a document with no highlight byte for byte', async () => {
    const markdown = [
      '# Title',
      '',
      'x = y and a == b, a === b, x==y',
      '',
      '`code ==with== equals`',
      '',
      '```',
      '==not a highlight==',
      '```',
      '',
    ].join('\n')
    expect(await roundTrip(markdown)).toBe(markdown)
  })

  it('renders <mark> and parses it back', async () => {
    const html = await withEditor('a ==b== c', (editor) =>
      editor.action((ctx) => {
        const { doc, schema } = ctx.get(editorViewCtx).state
        const root = document.createElement('div')
        root.append(
          DOMSerializer.fromSchema(schema).serializeFragment(doc.content)
        )
        const parsed = DOMParser.fromSchema(schema).parse(root)
        expect(highlightedText(parsed)).toEqual(['b'])
        return root.innerHTML
      })
    )
    expect(html).toContain('<mark>b</mark>')
  })
})
