import type { Node as ProseNode } from '@milkdown/kit/prose/model'

/// A half-open range of document positions.
export interface PosRange {
  from: number
  to: number
}

const WORD_CHAR = /[\p{L}\p{M}\p{N}_]/u
// Each inline node that is not text takes one position and breaks a word.
const LEAF_TEXT = '\uFFFC'

/// The word that contains `pos` or ends at it. A caret after a space or
/// at the start of a word has no word, because the character before it
/// is not a word character.
export function wordAt(doc: ProseNode, pos: number): PosRange | null {
  const $pos = doc.resolve(pos)
  const { parent } = $pos
  if (!parent.inlineContent) return null
  const text = parent.textBetween(0, parent.content.size, undefined, LEAF_TEXT)
  let from = $pos.parentOffset
  let to = from
  if (!WORD_CHAR.test(text.charAt(from - 1))) return null
  while (from > 0 && WORD_CHAR.test(text.charAt(from - 1))) from -= 1
  while (to < text.length && WORD_CHAR.test(text.charAt(to))) to += 1
  const start = $pos.start()
  return { from: start + from, to: start + to }
}
