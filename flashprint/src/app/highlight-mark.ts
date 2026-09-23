import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import type { RemarkPluginRaw } from '@milkdown/kit/transformer'

import { markRule } from '@milkdown/kit/prose'
import { toggleMark } from '@milkdown/kit/prose/commands'
import {
  $inputRule,
  $markSchema,
  $remark,
  $useKeymap,
} from '@milkdown/kit/utils'

import './highlight-mark.css'

/// A markdown node as remark sees it, reduced to the fields the highlight
/// split reads and writes.
export interface MdNode {
  type: string
  value?: string
  children?: MdNode[]
  [key: string]: unknown
}

const DELIMITER = '=='

interface Delimiter {
  at: number
  canOpen: boolean
  canClose: boolean
}

function isSpace(char: string): boolean {
  return char === '' || /\s/.test(char)
}

// A neighbor that is not text, such as inline code or a link, counts as a
// character that is not white space. A line break counts as white space.
function edgeChar(node: MdNode | undefined, side: 'first' | 'last'): string {
  if (!node || node.type === 'break') return ''
  if (node.type !== 'text') return 'x'
  const value = node.value ?? ''
  return side === 'first' ? value.slice(0, 1) : value.slice(-1)
}

// A delimiter is exactly two `=`. It opens before a character that is not
// white space and closes after one, so `a == b` stays literal.
function findDelimiters(text: string, before: string, after: string) {
  const found: Delimiter[] = []
  for (let at = text.indexOf(DELIMITER); at >= 0; ) {
    const prev = at > 0 ? text.charAt(at - 1) : before
    const next = at + 2 < text.length ? text.charAt(at + 2) : after
    if (prev !== '=' && next !== '=')
      found.push({ at, canOpen: !isSpace(next), canClose: !isSpace(prev) })
    at = text.indexOf(DELIMITER, at + 1)
  }
  return found
}

function pushText(out: MdNode[], value: string): void {
  if (value.length > 0) out.push({ type: 'text', value })
}

function mergeText(nodes: MdNode[]): MdNode[] {
  const out: MdNode[] = []
  for (const node of nodes) {
    const last = out[out.length - 1]
    if (last?.type === 'text' && node.type === 'text')
      out[out.length - 1] = {
        type: 'text',
        value: `${last.value ?? ''}${node.value ?? ''}`,
      }
    else out.push(node)
  }
  return out
}

function splitChildren(children: MdNode[]): MdNode[] {
  const out: MdNode[] = []
  // The index in `out` of the opening delimiter, kept as text until a
  // closing delimiter turns the run after it into a highlight.
  let openAt = -1

  children.forEach((child, index) => {
    const text = child.type === 'text' ? child.value : undefined
    if (text === undefined) {
      out.push(child)
      return
    }

    const before = edgeChar(children[index - 1], 'last')
    const after = edgeChar(children[index + 1], 'first')
    let cursor = 0
    for (const delimiter of findDelimiters(text, before, after)) {
      const closing = openAt >= 0
      if (closing ? !delimiter.canClose : !delimiter.canOpen) continue

      pushText(out, text.slice(cursor, delimiter.at))
      cursor = delimiter.at + DELIMITER.length
      if (closing) {
        const inner = out.splice(openAt).slice(1)
        out.push({ type: 'highlight', children: mergeText(inner) })
        openAt = -1
      } else {
        openAt = out.length
        out.push({ type: 'text', value: DELIMITER })
      }
    }

    if (cursor === 0) out.push(child)
    else pushText(out, text.slice(cursor))
  })

  return mergeText(out)
}

/// Split every `==text==` run in the tree into a `highlight` node. The
/// value of inline code and code blocks stays literal.
///
/// A highlight can wrap other inline nodes, such as `==a **b**==`. It
/// cannot start inside one inline node and end inside another.
export function splitHighlights(node: MdNode): void {
  if (!node.children) return
  for (const child of node.children) splitHighlights(child)
  node.children = splitChildren(node.children)
}

interface Tracker {
  move: (value: string) => string
  current: () => Record<string, unknown>
}

interface ToMarkdownState {
  createTracker: (info: unknown) => Tracker
  containerPhrasing: (parent: MdNode, info: object) => string
}

// The delimiters are written raw, so remark-stringify never escapes them.
function highlightToMarkdown(
  node: MdNode,
  _parent: unknown,
  state: ToMarkdownState,
  info: unknown
): string {
  const tracker = state.createTracker(info)
  let value = tracker.move(DELIMITER)
  value += tracker.move(
    state.containerPhrasing(node, {
      before: value,
      after: '=',
      ...tracker.current(),
    })
  )
  value += tracker.move(DELIMITER)
  return value
}

highlightToMarkdown.peek = () => '='

const remarkHighlightPlugin: RemarkPluginRaw<undefined> = function () {
  const data = this.data() as unknown as { toMarkdownExtensions?: object[] }
  data.toMarkdownExtensions ??= []
  data.toMarkdownExtensions.push({
    handlers: { highlight: highlightToMarkdown },
  })
  return (tree) => splitHighlights(tree as unknown as MdNode)
}

const remarkHighlight = $remark('remarkHighlight', () => remarkHighlightPlugin)

const highlightSchema = $markSchema('highlight', () => ({
  parseDOM: [{ tag: 'mark' }],
  toDOM: () => ['mark', 0],
  parseMarkdown: {
    match: (node) => node.type === 'highlight',
    runner: (state, node, markType) => {
      state.openMark(markType)
      state.next(node.children)
      state.closeMark(markType)
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'highlight',
    runner: (state, mark) => {
      state.withMark(mark, 'highlight')
    },
  },
}))

const highlightInputRule = $inputRule((ctx) =>
  markRule(
    /(?<!=)==([^=\s](?:[^=]*[^=\s])?)==$/,
    highlightSchema.type(ctx)
  )
)

const highlightKeymap = $useKeymap('flashprintHighlight', {
  ToggleHighlight: {
    shortcuts: 'Mod-Shift-h',
    command: (ctx) => toggleMark(highlightSchema.type(ctx)),
  },
})

/// The `highlight` mark. It renders as `<mark>` and reads and writes
/// `==text==` in markdown. Typing `==text==` applies it, and `Mod-Shift-h`
/// toggles it on the selection.
export const highlightMark: MilkdownPlugin[] = [
  remarkHighlight,
  highlightSchema,
  highlightInputRule,
  highlightKeymap,
].flat()
