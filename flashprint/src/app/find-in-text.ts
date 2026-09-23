/// A match as a half-open range of offsets into the searched string.
export interface TextRange {
  from: number
  to: number
}

const REGEXP_SYNTAX = /[.*+?^${}()|[\]\\]/g

/// Builds a function that finds every plain text occurrence of `query`.
/// Matches do not overlap: the search resumes after the end of a match.
///
/// A regular expression compares case in place, so the offsets stay
/// true to the source. `toLowerCase` can change the string length.
export function createTextMatcher(
  query: string,
  caseSensitive: boolean
): (text: string) => TextRange[] {
  if (!query) return () => []
  const pattern = new RegExp(
    query.replace(REGEXP_SYNTAX, '\\$&'),
    caseSensitive ? 'gu' : 'giu'
  )

  return (text) => {
    const matches: TextRange[] = []
    for (const found of text.matchAll(pattern)) {
      matches.push({ from: found.index, to: found.index + found[0].length })
    }
    return matches
  }
}

export function findInText(
  text: string,
  query: string,
  caseSensitive: boolean
): TextRange[] {
  return createTextMatcher(query, caseSensitive)(text)
}

/// Replaces each match, working from the last to the first. Each
/// replacement then leaves the offsets of the earlier matches valid.
export function replaceAllInText(
  text: string,
  matches: readonly TextRange[],
  replacement: string
): string {
  let result = text
  for (let i = matches.length - 1; i >= 0; i--) {
    const { from, to } = matches[i]!
    result = result.slice(0, from) + replacement + result.slice(to)
  }
  return result
}

/// The index of the first match that starts at or after `offset`. The
/// search wraps to the first match, and gives -1 with no match.
export function firstMatchFrom(
  matches: readonly TextRange[],
  offset: number
): number {
  if (matches.length === 0) return -1
  const index = matches.findIndex((match) => match.from >= offset)
  return index === -1 ? 0 : index
}

/// Moves `current` by `step` and wraps around both ends.
export function stepMatch(
  current: number,
  count: number,
  step: 1 | -1
): number {
  if (count === 0) return -1
  if (current < 0) return step === 1 ? 0 : count - 1
  return (current + step + count) % count
}

/// Where `offset` lands after `replaceAllInText`. An offset inside a
/// match moves to the start of its replacement.
export function offsetAfterReplaceAll(
  offset: number,
  matches: readonly TextRange[],
  replacement: string
): number {
  let shift = 0
  for (const { from, to } of matches) {
    if (from >= offset) break
    if (to > offset) return from + shift
    shift += replacement.length - (to - from)
  }
  return offset + shift
}
