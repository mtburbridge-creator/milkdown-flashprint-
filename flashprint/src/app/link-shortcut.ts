import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import type {
  Mark,
  MarkType,
  Node as ProseNode,
} from '@milkdown/kit/prose/model'
import type { Command } from '@milkdown/kit/prose/state'

import { linkTooltipAPI } from '@milkdown/kit/component/link-tooltip'
import { linkSchema } from '@milkdown/kit/preset/commonmark'
import { TextSelection } from '@milkdown/kit/prose/state'
import { $useKeymap } from '@milkdown/kit/utils'

interface LinkRange {
  mark: Mark
  from: number
  to: number
}

// At the edge of a text node, the node after `pos` wins over the node
// before it.
function linkAt(doc: ProseNode, pos: number, type: MarkType): LinkRange | null {
  const $pos = doc.resolve(pos)
  const { parent } = $pos
  const after = $pos.index()
  const candidates = $pos.textOffset > 0 ? [after] : [after, after - 1]

  for (const index of candidates) {
    const mark = parent.maybeChild(index)?.marks.find((m) => m.type === type)
    if (!mark) continue

    let first = index
    let last = index
    while (first > 0 && mark.isInSet(parent.child(first - 1).marks)) first--
    while (
      last < parent.childCount - 1 &&
      mark.isInSet(parent.child(last + 1).marks)
    )
      last++

    let from = $pos.start()
    for (let i = 0; i < first; i++) from += parent.child(i).nodeSize
    let to = from
    for (let i = first; i <= last; i++) to += parent.child(i).nodeSize
    return { mark, from, to }
  }
  return null
}

function linkInRange(
  doc: ProseNode,
  from: number,
  to: number,
  type: MarkType
): LinkRange | null {
  if (from === to) return linkAt(doc, from, type)

  let found: LinkRange | null = null
  doc.nodesBetween(from, to, (node, pos) => {
    if (found) return false
    if (!node.isInline || !type.isInSet(node.marks)) return true
    found = linkAt(doc, Math.max(pos, from), type)
    return false
  })
  return found
}

/// `Mod-k` opens Crepe's link box. It edits the link under the selection
/// or adds a link to a selection that has none. With an empty selection
/// outside a link, the key passes through.
export const linkShortcut: MilkdownPlugin[] = $useKeymap(
  'flashprintLinkShortcut',
  {
    EditLink: {
      shortcuts: 'Mod-k',
      command: (ctx): Command => {
        return (state, dispatch) => {
          const { selection, doc } = state
          if (!(selection instanceof TextSelection)) return false

          const { from, to } = selection
          const link = linkInRange(doc, from, to, linkSchema.type(ctx))
          if (!link && selection.empty) return false
          if (!dispatch) return true

          const api = ctx.get(linkTooltipAPI.key)
          if (link) api.editLink(link.mark, link.from, link.to)
          else api.addLink(from, to)
          return true
        }
      },
    },
  }
)
