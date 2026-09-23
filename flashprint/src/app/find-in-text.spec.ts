import { describe, expect, it } from 'vitest'

import {
  findInText,
  firstMatchFrom,
  offsetAfterReplaceAll,
  replaceAllInText,
  stepMatch,
} from './find-in-text'

describe('findInText', () => {
  it('returns the range of each match', () => {
    expect(findInText('one two one', 'one', false)).toEqual([
      { from: 0, to: 3 },
      { from: 8, to: 11 },
    ])
  })

  it('ignores case unless asked', () => {
    expect(findInText('Cat cat CAT', 'cat', false)).toHaveLength(3)
    expect(findInText('Cat cat CAT', 'cat', true)).toEqual([{ from: 4, to: 7 }])
  })

  it('finds nothing for an empty query', () => {
    expect(findInText('anything', '', false)).toEqual([])
  })

  it('treats the query as plain text', () => {
    expect(findInText('a.b axb (x)', 'a.b', false)).toEqual([
      { from: 0, to: 3 },
    ])
    expect(findInText('a.b axb (x)', '(x)', false)).toEqual([
      { from: 8, to: 11 },
    ])
  })

  it('does not overlap matches', () => {
    expect(findInText('aaaa', 'aa', false)).toEqual([
      { from: 0, to: 2 },
      { from: 2, to: 4 },
    ])
    expect(findInText('aaa', 'aa', false)).toEqual([{ from: 0, to: 2 }])
  })
})

describe('replaceAllInText', () => {
  it('keeps earlier offsets valid by working from the end', () => {
    const text = 'a-b-c'
    const matches = findInText(text, '-', false)
    expect(replaceAllInText(text, matches, ' and ')).toBe('a and b and c')
  })

  it('deletes the matches for an empty replacement', () => {
    const text = 'x1x2x'
    expect(replaceAllInText(text, findInText(text, 'x', false), '')).toBe('12')
  })
})

describe('offsetAfterReplaceAll', () => {
  const matches = findInText('ab ab ab', 'ab', false)

  it('shifts an offset by the matches before it', () => {
    expect(offsetAfterReplaceAll(6, matches, 'xyz')).toBe(8)
  })

  it('moves an offset inside a match to its start', () => {
    expect(offsetAfterReplaceAll(4, matches, '')).toBe(1)
  })
})

describe('match navigation', () => {
  const matches = findInText('x.x.x', 'x', false)

  it('starts at the first match after the offset and wraps', () => {
    expect(firstMatchFrom(matches, 1)).toBe(1)
    expect(firstMatchFrom(matches, 5)).toBe(0)
    expect(firstMatchFrom([], 0)).toBe(-1)
  })

  it('wraps around both ends', () => {
    expect(stepMatch(2, 3, 1)).toBe(0)
    expect(stepMatch(0, 3, -1)).toBe(2)
    expect(stepMatch(-1, 3, -1)).toBe(2)
    expect(stepMatch(-1, 0, 1)).toBe(-1)
  })
})
