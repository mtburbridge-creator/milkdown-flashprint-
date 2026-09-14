import { beforeEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_SETTINGS,
  EXACT_PAGES_MAX,
  FONT_MAX_PX,
  lastRefitUnfinished,
  loadSettings,
  MARGIN_MAX_IN,
  markRefitFinished,
  markRefitStarted,
} from './state'

function store(settings: unknown): void {
  localStorage.setItem('flashprint:settings', JSON.stringify(settings))
}

describe('loadSettings', () => {
  beforeEach(() => localStorage.clear())

  it('caps a stored font size at the maximum', () => {
    store({ fit: { minFontPx: 10, maxFontPx: 105 } })
    expect(loadSettings().fit.maxFontPx).toBe(FONT_MAX_PX)
  })

  it('caps a stored minimum font and keeps the base at or above it', () => {
    store({ fit: { minFontPx: 105, maxFontPx: 16 } })
    const { fit } = loadSettings()
    expect(fit.minFontPx).toBe(FONT_MAX_PX)
    expect(fit.maxFontPx).toBe(FONT_MAX_PX)
  })

  it('caps the exact page count and the margin', () => {
    store({ page: { marginIn: 9 }, fit: { exactPages: 99999 } })
    const settings = loadSettings()
    expect(settings.fit.exactPages).toBe(EXACT_PAGES_MAX)
    expect(settings.page.marginIn).toBe(MARGIN_MAX_IN)
  })

  it('falls back to the defaults for unreadable storage', () => {
    localStorage.setItem('flashprint:settings', '{not json')
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
  })
})

describe('refit mark', () => {
  beforeEach(() => localStorage.clear())

  it('reports an unfinished refit until it is cleared', () => {
    expect(lastRefitUnfinished()).toBe(false)
    markRefitStarted()
    expect(lastRefitUnfinished()).toBe(true)
    markRefitFinished()
    expect(lastRefitUnfinished()).toBe(false)
  })
})
