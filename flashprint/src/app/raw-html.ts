import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import type { RemarkPluginRaw } from '@milkdown/kit/transformer'

import { $nodeSchema, $remark } from '@milkdown/kit/utils'

import './raw-html.css'

/// A markdown node as remark sees it, reduced to the fields this file
/// reads and writes.
export interface RawNode {
  type: string
  value?: string
  tag?: string
  open?: string
  children?: RawNode[]
}

/// Parses markdown into block nodes with every remark transform applied.
export type ParseBlocks = (markdown: string) => RawNode[]

// Element names HTML defines. A tag outside this list, such as
// `<mdtable>`, is a label someone put around markdown, not markup to keep
// as raw HTML.
const HTML_ELEMENTS = new Set(
  (
    'a abbr address area article aside audio b base bdi bdo big blockquote ' +
    'body br button canvas caption center cite code col colgroup data ' +
    'datalist dd del details dfn dialog div dl dt em embed fieldset ' +
    'figcaption figure font footer form h1 h2 h3 h4 h5 h6 head header ' +
    'hgroup hr html i iframe img input ins kbd label legend li link main ' +
    'map mark math menu meta meter nav noscript object ol optgroup option ' +
    'output p param picture pre progress q rp rt ruby s samp script search ' +
    'section select slot small source span strike strong style sub summary ' +
    'sup svg table tbody td template textarea tfoot th thead time title tr ' +
    'track tt u ul var video wbr'
  ).split(' ')
)

const OPEN_TAG = /^<([A-Za-z][\w-]*)(?:\s[^<>]*)?>$/

// Nodes whose children are blocks. Raw HTML directly inside one of them
// is a block of its own.
const FLOW_CONTAINERS = new Set([
  'root',
  'blockquote',
  'listItem',
  'footnoteDefinition',
  'htmlWrapper',
])

interface OpenWrapper {
  tag: string
  open: string
  /// Everything after the opening tag's line, in the same HTML block.
  rest: string
}

/// The value of a raw HTML block, or `null` for any other node.
/// Milkdown wraps each raw HTML block in a paragraph before this file
/// sees the tree, so both shapes count.
export function blockHtmlValue(node: RawNode): string | null {
  if (node.type === 'html') return node.value ?? ''
  const only = node.children?.length === 1 ? node.children[0] : undefined
  if (node.type === 'paragraph' && only?.type === 'html')
    return only.value ?? ''
  return null
}

/// Reads an opening wrapper tag from the first line of a raw HTML block.
/// Returns `null` when that line is not a lone opening tag, or when the
/// tag names a real HTML element.
export function openWrapper(value: string): OpenWrapper | null {
  const lineEnd = value.indexOf('\n')
  const first = (lineEnd < 0 ? value : value.slice(0, lineEnd)).trim()
  const match = OPEN_TAG.exec(first)
  const tag = match?.[1]
  if (!tag || HTML_ELEMENTS.has(tag.toLowerCase())) return null
  return {
    tag,
    open: first,
    rest: lineEnd < 0 ? '' : value.slice(lineEnd + 1),
  }
}

/// The markdown between the tags when the closing tag ends the same raw
/// HTML block, or `null` when it does not.
export function innerWhenClosed(wrapper: OpenWrapper): string | null {
  const closer = `</${wrapper.tag}>`
  const rest = wrapper.rest.trimEnd()
  if (rest === closer) return ''
  if (!rest.endsWith(`\n${closer}`)) return null
  return rest.slice(0, rest.length - closer.length - 1)
}

function findCloser(siblings: RawNode[], from: number, tag: string): number {
  const closer = `</${tag}>`
  for (let index = from; index < siblings.length; index += 1) {
    const value = blockHtmlValue(siblings[index]!)
    if (value !== null && value.trim() === closer) return index
  }
  return -1
}

function wrapperNode(wrapper: OpenWrapper, children: RawNode[]): RawNode {
  return { type: 'htmlWrapper', tag: wrapper.tag, open: wrapper.open, children }
}

// A lone `<br>` stays with milkdown, which reads it as a line break.
const LINE_BREAK = /^<br\s*\/?>$/i

function liftChildren(children: RawNode[], parse: ParseBlocks): RawNode[] {
  const out: RawNode[] = []
  for (let index = 0; index < children.length; index += 1) {
    const node = children[index]!
    const value = blockHtmlValue(node)
    if (value === null || LINE_BREAK.test(value.trim())) {
      liftRawHtml(node, parse)
      out.push(node)
      continue
    }

    const wrapper = openWrapper(value)
    if (wrapper) {
      const inner = innerWhenClosed(wrapper)
      if (inner !== null) {
        out.push(wrapperNode(wrapper, parse(inner)))
        continue
      }
      const end = findCloser(children, index + 1, wrapper.tag)
      if (end >= 0) {
        const head = wrapper.rest.trim() ? parse(wrapper.rest) : []
        const body = liftChildren(children.slice(index + 1, end), parse)
        out.push(wrapperNode(wrapper, [...head, ...body]))
        index = end
        continue
      }
    }

    out.push({ type: 'htmlBlock', value })
  }
  return out
}

/// Rewrites raw HTML blocks in place so the editor can edit them. A block
/// wrapped in an unknown tag becomes a `htmlWrapper` holding the parsed
/// markdown inside it. Every other raw HTML block becomes a `htmlBlock`
/// that keeps its source text. Inline HTML inside a paragraph is left
/// alone.
export function liftRawHtml(node: RawNode, parse: ParseBlocks): void {
  if (!node.children) return
  if (node.type === 'list') {
    for (const item of node.children) liftRawHtml(item, parse)
    return
  }
  if (FLOW_CONTAINERS.has(node.type))
    node.children = liftChildren(node.children, parse)
}

interface ToMarkdownState {
  containerFlow: (parent: RawNode, info: unknown) => string
}

// Blank lines around the content make each tag its own raw HTML block, so
// the markdown between them stays markdown for any reader, this one
// included.
function wrapperToMarkdown(
  node: RawNode,
  _parent: unknown,
  state: ToMarkdownState,
  info: unknown
): string {
  const inner = state.containerFlow(node, info)
  return `${node.open}\n\n${inner}\n\n</${node.tag}>`
}

const remarkRawHtmlPlugin: RemarkPluginRaw<undefined> = function () {
  const data = this.data() as unknown as { toMarkdownExtensions?: object[] }
  data.toMarkdownExtensions ??= []
  data.toMarkdownExtensions.push({
    handlers: { htmlWrapper: wrapperToMarkdown },
  })

  // The same processor parses the inside of a wrapper, so a table or a
  // highlight in there reads exactly as it would anywhere else. The source
  // goes along with the tree, because a transform reads its characters.
  const parse: ParseBlocks = (markdown) => {
    const tree = this.runSync(this.parse(markdown), markdown)
    return (tree as unknown as RawNode).children ?? []
  }
  return (tree) => liftRawHtml(tree as unknown as RawNode, parse)
}

const remarkRawHtml = $remark('remarkRawHtml', () => remarkRawHtmlPlugin)

const htmlWrapperSchema = $nodeSchema('html_wrapper', () => ({
  group: 'block',
  content: 'block+',
  attrs: {
    tag: { default: 'div', validate: 'string' },
    open: { default: '<div>', validate: 'string' },
  },
  parseDOM: [
    {
      tag: 'div[data-type="html-wrapper"]',
      getAttrs: (dom) => ({
        tag: (dom as HTMLElement).dataset['tag'] ?? 'div',
        open: (dom as HTMLElement).dataset['open'] ?? '<div>',
      }),
    },
  ],
  toDOM: (node) => [
    'div',
    {
      'data-type': 'html-wrapper',
      'data-tag': node.attrs['tag'],
      'data-open': node.attrs['open'],
    },
    0,
  ],
  parseMarkdown: {
    match: (node) => node.type === 'htmlWrapper',
    runner: (state, node, type) => {
      state.openNode(type, { tag: node['tag'], open: node['open'] })
      state.next(node.children)
      state.closeNode()
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'html_wrapper',
    runner: (state, node) => {
      state.openNode('htmlWrapper', undefined, {
        tag: node.attrs['tag'],
        open: node.attrs['open'],
      })
      state.next(node.content)
      state.closeNode()
    },
  },
}))

const htmlBlockSchema = $nodeSchema('html_block', () => ({
  group: 'block',
  content: 'text*',
  marks: '',
  code: true,
  defining: true,
  parseDOM: [
    {
      tag: 'pre[data-type="html-block"]',
      preserveWhitespace: 'full',
      // Ahead of the code block's plain `pre` rule.
      priority: 60,
    },
  ],
  toDOM: () => ['pre', { 'data-type': 'html-block' }, ['code', 0]],
  parseMarkdown: {
    match: (node) => node.type === 'htmlBlock',
    runner: (state, node, type) => {
      state.openNode(type)
      const value = node['value']
      if (typeof value === 'string' && value) state.addText(value)
      state.closeNode()
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'html_block',
    runner: (state, node) => {
      state.addNode('html', undefined, node.textContent)
    },
  },
}))

/// Makes raw HTML in a pasted document editable. Markdown wrapped in an
/// unknown tag such as `<mdtable>` reads as ordinary markdown inside a
/// labelled container, and the tags are written back out. Any other raw
/// HTML block becomes editable source text.
export const rawHtml: MilkdownPlugin[] = [
  remarkRawHtml,
  htmlWrapperSchema,
  htmlBlockSchema,
].flat()
