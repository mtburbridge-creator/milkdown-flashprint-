import type { Node } from '@milkdown/kit/prose/model'

import { defaultValueCtx, Editor, editorViewCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { getMarkdown } from '@milkdown/kit/utils'
import { describe, expect, it } from 'vitest'

import { highlightMark } from './highlight-mark'
import {
  blockHtmlValue,
  innerWhenClosed,
  openWrapper,
  rawHtml,
} from './raw-html'

const TABLE = ['| A | B |', '|---|---|', '| 1 | 2 |'].join('\n')

async function withEditor<T>(
  markdown: string,
  run: (editor: Editor) => T
): Promise<T> {
  const editor = Editor.make()
    .config((ctx) => ctx.set(defaultValueCtx, markdown))
    .use(commonmark)
    .use(gfm)
    .use(highlightMark)
    .use(rawHtml)
  await editor.create()
  try {
    return run(editor)
  } finally {
    await editor.destroy()
  }
}

function docOf(markdown: string): Promise<Node> {
  return withEditor(markdown, (editor) =>
    editor.action((ctx) => ctx.get(editorViewCtx).state.doc)
  )
}

function roundTrip(markdown: string): Promise<string> {
  return withEditor(markdown, (editor) => editor.action(getMarkdown()))
}

function typesIn(doc: Node): string[] {
  const out: string[] = []
  doc.descendants((node) => {
    out.push(node.type.name)
  })
  return out
}

describe('openWrapper', () => {
  it('reads an unknown tag on the first line', () => {
    expect(openWrapper('<mdtable>\n| a |')).toEqual({
      tag: 'mdtable',
      open: '<mdtable>',
      rest: '| a |',
    })
  })

  it('keeps the attributes of the opening tag', () => {
    expect(openWrapper('<note kind="warn">')?.open).toBe('<note kind="warn">')
  })

  it('ignores a real HTML element', () => {
    expect(openWrapper('<div>\ntext')).toBeNull()
    expect(openWrapper('<TABLE>')).toBeNull()
  })

  it('ignores a first line that holds more than a tag', () => {
    expect(openWrapper('<mdtable> trailing')).toBeNull()
    expect(openWrapper('</mdtable>')).toBeNull()
  })
})

describe('innerWhenClosed', () => {
  it('returns the markdown between the tags', () => {
    const wrapper = openWrapper('<mdtable>\n| a |\n</mdtable>')!
    expect(innerWhenClosed(wrapper)).toBe('| a |')
  })

  it('returns null when the closing tag is elsewhere', () => {
    const wrapper = openWrapper('<mdtable>\n| a |')!
    expect(innerWhenClosed(wrapper)).toBeNull()
  })
})

describe('blockHtmlValue', () => {
  it('reads raw HTML inside the paragraph milkdown wraps it in', () => {
    const node = {
      type: 'paragraph',
      children: [{ type: 'html', value: '<x>' }],
    }
    expect(blockHtmlValue(node)).toBe('<x>')
  })

  it('ignores a paragraph with inline HTML among other text', () => {
    const node = {
      type: 'paragraph',
      children: [
        { type: 'text', value: 'a ' },
        { type: 'html', value: '<b>' },
      ],
    }
    expect(blockHtmlValue(node)).toBeNull()
  })
})

describe('rawHtml in the editor', () => {
  it('reads a table wrapped in an unknown tag as a real table', async () => {
    const doc = await docOf(`<mdtable>\n${TABLE}\n</mdtable>`)
    const types = typesIn(doc)
    expect(types).toContain('html_wrapper')
    expect(types).toContain('table')
    expect(types).not.toContain('html')
  })

  it('reads the wrapper when blank lines separate the tags', async () => {
    const doc = await docOf(`<mdtable>\n\n${TABLE}\n\n</mdtable>`)
    expect(doc.childCount).toBe(1)
    expect(doc.firstChild?.type.name).toBe('html_wrapper')
    expect(doc.firstChild?.firstChild?.type.name).toBe('table')
  })

  it('writes the tags back around the markdown', async () => {
    const output = await roundTrip(`<mdtable>\n${TABLE}\n</mdtable>`)
    expect(output.startsWith('<mdtable>\n\n|')).toBe(true)
    expect(output.trimEnd().endsWith('|\n\n</mdtable>')).toBe(true)
  })

  it('reads its own output back to the same markdown', async () => {
    const once = await roundTrip(`<mdtable>\n${TABLE}\n</mdtable>`)
    expect(await roundTrip(once)).toBe(once)
  })

  it('keeps the opening tag with its attributes', async () => {
    const output = await roundTrip('<note kind="warn">\nSome **text**\n</note>')
    expect(output).toContain('<note kind="warn">')
    expect(output).toContain('Some **text**')
    expect(output).toContain('</note>')
  })

  it('applies the other markdown transforms inside a wrapper', async () => {
    const doc = await docOf('<mdtable>\nA ==marked== word\n</mdtable>')
    let highlighted = ''
    doc.descendants((node) => {
      if (node.marks.some((mark) => mark.type.name === 'highlight'))
        highlighted += node.text ?? ''
    })
    expect(highlighted).toBe('marked')
  })

  it('turns other raw HTML into an editable block with its source', async () => {
    const source = '<div class="box">\n<b>kept</b>\n</div>'
    const doc = await docOf(source)
    expect(doc.firstChild?.type.name).toBe('html_block')
    expect(doc.firstChild?.textContent).toBe(source)
    expect((await roundTrip(source)).trimEnd()).toBe(source)
  })

  it('keeps an unclosed wrapper tag editable as source', async () => {
    const doc = await docOf('<mdtable>\n| a |')
    expect(doc.firstChild?.type.name).toBe('html_block')
  })

  it('leaves inline HTML inside a paragraph as it was', async () => {
    const doc = await docOf('Water is H<sub>2</sub>O.')
    expect(typesIn(doc)).not.toContain('html_block')
    expect(doc.firstChild?.type.name).toBe('paragraph')
  })

  it('leaves a document without raw HTML unchanged', async () => {
    const markdown = `# Title\n\nSome *text*.\n\n${TABLE}\n`
    expect(await roundTrip(markdown)).toBe(await roundTrip(markdown))
    expect(typesIn(await docOf(markdown))).not.toContain('html_wrapper')
  })
})
