import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import type { Node as ProseNode, ResolvedPos } from '@milkdown/kit/prose/model'
import type {
  Command,
  EditorState,
  Transaction,
} from '@milkdown/kit/prose/state'

import { closeHistory } from '@milkdown/kit/prose/history'
import { Fragment } from '@milkdown/kit/prose/model'
import { Selection } from '@milkdown/kit/prose/state'
import { $useKeymap } from '@milkdown/kit/utils'

/// The direction of a move or a duplicate: `-1` is up, `1` is down.
export type BlockDirection = -1 | 1

const LIST_TYPES = new Set(['bullet_list', 'ordered_list'])

// The base keymap binds `Alt-ArrowUp` and `Alt-ArrowDown` to `joinUp` and
// `joinDown` at the default priority of 50.
const PRIORITY = 100

interface BlockRun {
  parent: ProseNode
  first: number
  last: number
  from: number
  to: number
}

// Depths of the nodes whose children can move, innermost first.
function parentDepths($from: ResolvedPos): number[] {
  const depths: number[] = []
  if (LIST_TYPES.has($from.parent.type.name)) depths.push($from.depth)
  for (let depth = $from.depth; depth > 0; depth -= 1)
    if ($from.node(depth).type.name === 'list_item') depths.push(depth - 1)
  depths.push(0)
  return depths
}

// A position that sits between two children of the parent, as a node
// selection does, counts toward the child after it at the start and the
// child before it at the end.
function blockRun(state: EditorState): BlockRun {
  const { $from, $to } = state.selection
  const depth =
    parentDepths($from).find(
      (d) => $to.depth >= d && $to.start(d) === $from.start(d)
    ) ?? 0

  const parent = $from.node(depth)
  const first = Math.min($from.index(depth), parent.childCount - 1)
  const lastIndex = $to.depth > depth ? $to.index(depth) : $to.index(depth) - 1
  const last = Math.max(first, lastIndex)
  const from = $from.posAtIndex(first, depth)
  const to = $from.posAtIndex(last + 1, depth)
  return { parent, first, last, from, to }
}

function runContent(run: BlockRun): ProseNode[] {
  const nodes: ProseNode[] = []
  for (let index = run.first; index <= run.last; index += 1)
    nodes.push(run.parent.child(index))
  return nodes
}

// The JSON form keeps the selection type, so a text, node, cell, or gap
// cursor selection survives the shift.
function shiftSelection(state: EditorState, tr: Transaction, delta: number) {
  const json = state.selection.toJSON() as Record<string, unknown>
  for (const key of ['anchor', 'head', 'pos']) {
    const value = json[key]
    if (typeof value === 'number') json[key] = value + delta
  }
  return tr.setSelection(Selection.fromJSON(tr.doc, json))
}

function finish(tr: Transaction, dispatch: (tr: Transaction) => void) {
  dispatch(closeHistory(tr).scrollIntoView())
}

/// Swap the current block, or the run of selected blocks, with its
/// sibling in the given direction. A list item moves inside its own list.
/// At the edge the command does nothing and still reports success.
export function moveBlock(direction: BlockDirection): Command {
  return (state, dispatch) => {
    const run = blockRun(state)
    const siblingIndex = direction < 0 ? run.first - 1 : run.last + 1
    const sibling = run.parent.maybeChild(siblingIndex)
    if (!sibling) return true
    if (!dispatch) return true

    const blocks = runContent(run)
    const content = direction < 0 ? [...blocks, sibling] : [sibling, ...blocks]
    const from = direction < 0 ? run.from - sibling.nodeSize : run.from
    const to = direction < 0 ? run.to : run.to + sibling.nodeSize
    const tr = state.tr.replaceWith(from, to, Fragment.from(content))
    shiftSelection(state, tr, direction * sibling.nodeSize)
    finish(tr, dispatch)
    return true
  }
}

/// Insert a copy of the current block, or the run of selected blocks,
/// above or below it. The selection moves into the copy.
export function duplicateBlock(direction: BlockDirection): Command {
  return (state, dispatch) => {
    if (!dispatch) return true

    const run = blockRun(state)
    const at = direction < 0 ? run.from : run.to
    const tr = state.tr.insert(at, Fragment.from(runContent(run)))
    shiftSelection(state, tr, direction < 0 ? 0 : run.to - run.from)
    finish(tr, dispatch)
    return true
  }
}

/// Keys that move and duplicate blocks:
/// - `Alt-ArrowUp` and `Alt-ArrowDown` move the block.
/// - `Alt-Shift-ArrowUp` and `Alt-Shift-ArrowDown` duplicate it.
export const blockMoves: MilkdownPlugin[] = $useKeymap('flashprintBlockMoves', {
  MoveBlockUp: {
    shortcuts: 'Alt-ArrowUp',
    priority: PRIORITY,
    command: () => moveBlock(-1),
  },
  MoveBlockDown: {
    shortcuts: 'Alt-ArrowDown',
    priority: PRIORITY,
    command: () => moveBlock(1),
  },
  DuplicateBlockUp: {
    shortcuts: 'Alt-Shift-ArrowUp',
    priority: PRIORITY,
    command: () => duplicateBlock(-1),
  },
  DuplicateBlockDown: {
    shortcuts: 'Alt-Shift-ArrowDown',
    priority: PRIORITY,
    command: () => duplicateBlock(1),
  },
})
