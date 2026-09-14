import { describe, expect, it } from 'vitest'

import type { FitSettings, RoundingMode } from './types'

import { pickTarget } from './target'

function settings(rounding: RoundingMode, exactPages = 8): FitSettings {
  return { rounding, exactPages, minFontPx: 9, maxFontPx: 16 }
}

describe('pickTarget', () => {
  it('reports the natural count under none', () => {
    expect(pickTarget(7, settings('none'))).toBeNull()
  })

  it('rounds down to an even count but never below one', () => {
    const even = settings('even')
    expect(pickTarget(1, even)).toBe(1)
    expect(pickTarget(3, even)).toBe(2)
    expect(pickTarget(4, even)).toBe(4)
  })

  it('rounds down to a multiple of four and falls back to even', () => {
    const four = settings('four')
    expect(pickTarget(5, four)).toBe(4)
    expect(pickTarget(8, four)).toBe(8)
    expect(pickTarget(3, four)).toBe(2)
    expect(pickTarget(1, four)).toBe(1)
  })

  it('takes the requested count under exact', () => {
    expect(pickTarget(20, settings('exact', 6))).toBe(6)
    expect(pickTarget(2, settings('exact', 6.9))).toBe(6)
    expect(pickTarget(2, settings('exact', 0))).toBe(1)
  })
})
