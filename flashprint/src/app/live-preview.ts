import type { Editor } from '@milkdown/kit/core'
import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import type { Mark, Node as ProseNode } from '@milkdown/kit/prose/model'
import type { EditorState } from '@milkdown/kit/prose/state'

import { editorViewCtx } from '@milkdown/kit/core'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { $ctx, $prose } from '@milkdown/kit/utils'

const livePreviewKey = new PluginKey<DecorationSet>('FLASHPRINT_LIVE_PREVIEW')

/// Turns the live preview decorations on and off. `setLivePreview`
/// writes it, so the app never has to recreate the editor.
const livePreviewEnabled = $ctx(false, 'flashprintLivePreviewEnabled')

/// A block marker must sit outside an inline marker that starts at the
/// same position, so `# **a**` does not come out as `**# a**`.
const BLOCK_SIDE = 2
const INLINE_SIDE = 1

interface MarkerPair {
  open: string
  close: string
}

const INLINE_MARKERS: Record<string, MarkerPair> = {
  strong: { open: '**', close: '**' },
  emphasis: { open: '*', close: '*' },
  inlineCode: { open: '`', close: '`' },
  strike_through: { open: '~~', close: '~~' },
}

function markerFor(mark: Mark): MarkerPair | null {
  if (mark.type.name === 'link') {
    const href = String(mark.attrs['href'] ?? '')
    return { open: '[', close: `](${href})` }
  }
  return INLINE_MARKERS[mark.type.name] ?? null
}

/// The markers a block node shows, or `null` for a block that carries
/// no syntax of its own.
///
/// A code block gets none. Crepe renders one through CodeMirror, which
/// replaces the node's DOM and drops every decoration on it, so a fence
/// marker here would never reach the screen.
function markerForBlock(node: ProseNode): MarkerPair | null {
  const { name } = node.type
  if (name === 'heading') {
    const level = Number(node.attrs['level'] ?? 1)
    return { open: `${'#'.repeat(level)} `, close: '' }
  }
  if (name === 'blockquote') return { open: '> ', close: '' }
  return null
}

function syntaxWidget(pos: number, text: string, side: number): Decoration {
  return Decoration.widget(
    pos,
    () => {
      const span = document.createElement('span')
      span.className = 'fp-syntax'
      span.contentEditable = 'false'
      span.textContent = text
      return span
    },
    { side, ignoreSelection: true, marks: [] }
  )
}

/// Position of the first text inside a block. A blockquote holds its
/// text one level down, so the marker has to go inside the paragraph.
function firstTextPos(node: ProseNode, start: number): number {
  let current = node
  let pos = start + 1
  while (!current.isTextblock && current.firstChild) {
    current = current.firstChild
    pos += 1
  }
  return pos
}

function pushBlockMarkers(
  node: ProseNode,
  start: number,
  out: Decoration[]
): void {
  const marker = markerForBlock(node)
  if (!marker) return
  out.push(syntaxWidget(firstTextPos(node, start), marker.open, -BLOCK_SIDE))
  if (marker.close) {
    const end = start + node.nodeSize - 1
    out.push(syntaxWidget(end, marker.close, BLOCK_SIDE))
  }
}

/// Emits an opening marker where a mark starts and a closing marker
/// where it ends. Marks are compared with the previous text node, so a
/// run that spans several text nodes gets one pair of markers.
function pushInlineMarkers(
  node: ProseNode,
  start: number,
  out: Decoration[]
): void {
  const open: Mark[] = []
  let runEnd = start + 1

  function closeDownTo(keep: (mark: Mark) => boolean): void {
    while (open.length > 0) {
      const innermost = open[open.length - 1]!
      if (keep(innermost)) return
      open.pop()
      const marker = markerFor(innermost)
      if (marker) out.push(syntaxWidget(runEnd, marker.close, INLINE_SIDE))
    }
  }

  node.nodesBetween(
    0,
    node.content.size,
    (child, pos) => {
      if (!child.isText) return true
      closeDownTo((mark) => child.marks.some((m) => m.eq(mark)))
      for (const mark of child.marks) {
        if (open.some((m) => m.eq(mark))) continue
        open.push(mark)
        const marker = markerFor(mark)
        if (marker) out.push(syntaxWidget(pos, marker.open, -INLINE_SIDE))
      }
      runEnd = pos + child.nodeSize
      return false
    },
    start + 1
  )

  closeDownTo(() => false)
}

/// Blocks that intersect the selection reveal their syntax. Every other
/// block stays clean.
function buildDecorations(state: EditorState): DecorationSet {
  const { from, to } = state.selection
  const decorations: Decoration[] = []

  state.doc.forEach((node, offset) => {
    if (offset > to || offset + node.nodeSize < from) return
    pushBlockMarkers(node, offset, decorations)
    pushInlineMarkers(node, offset, decorations)
  })

  return DecorationSet.create(state.doc, decorations)
}

const livePreviewPlugin = $prose((ctx) => {
  function build(state: EditorState): DecorationSet {
    if (!ctx.get(livePreviewEnabled.key)) return DecorationSet.empty
    return buildDecorations(state)
  }

  return new Plugin<DecorationSet>({
    key: livePreviewKey,
    state: {
      init: (_config, state) => build(state),
      apply: (tr, value, _oldState, newState) => {
        const forced = tr.getMeta(livePreviewKey) === true
        if (!forced && !tr.docChanged && !tr.selectionSet) return value
        return build(newState)
      },
    },
    props: {
      decorations: (state) => livePreviewKey.getState(state),
    },
  })
})

/// The live preview feature. Install it on the Milkdown editor, then
/// call `setLivePreview` to turn it on.
export const livePreview: MilkdownPlugin[] = [
  livePreviewEnabled,
  livePreviewPlugin,
]

/// Turns the live preview on or off. The empty transaction makes the
/// plugin rebuild its decorations at once.
export function setLivePreview(editor: Editor, enabled: boolean): void {
  editor.action((ctx) => {
    ctx.set(livePreviewEnabled.key, enabled)
    const view = ctx.get(editorViewCtx)
    view.dispatch(view.state.tr.setMeta(livePreviewKey, true))
  })
}
