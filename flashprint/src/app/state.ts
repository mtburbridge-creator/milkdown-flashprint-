import type { FitSettings, PageSettings } from '../core/types'

export { SAMPLE_MARKDOWN } from './sample-markdown'

const SETTINGS_KEY = 'flashprint:settings'
const MARKDOWN_KEY = 'flashprint:markdown'

export interface Settings {
  page: PageSettings
  fit: FitSettings
}

export const DEFAULT_SETTINGS: Settings = {
  page: {
    paper: 'letter',
    layout: 'two-up',
    marginIn: 0.5,
    pageNumbers: true,
  },
  fit: {
    rounding: 'four',
    exactPages: 4,
    minFontPx: 10,
    maxFontPx: 16,
  },
}

/// Field values suggested for `single` layout. Applied only to a field
/// the user has not touched, so a deliberate choice survives a layout
/// switch.
const SINGLE_LAYOUT_SUGGESTIONS = {
  marginIn: 0.7,
  rounding: 'even',
} as const

/// Tracks which settings fields the user has changed, so a layout
/// switch can suggest new defaults without overriding a deliberate
/// choice. Keys match the paths used by `applyLayoutSuggestions`.
export type TouchedFields = Set<'page.marginIn' | 'fit.rounding'>

export function createTouchedFields(): TouchedFields {
  return new Set()
}

/// Applies the `single` layout suggestions to fields the user has not
/// touched. Mutates `settings` in place. No-op for `two-up`.
export function applyLayoutSuggestions(
  settings: Settings,
  touched: TouchedFields
): void {
  if (settings.page.layout !== 'single') return
  if (!touched.has('page.marginIn')) {
    settings.page.marginIn = SINGLE_LAYOUT_SUGGESTIONS.marginIn
  }
  if (!touched.has('fit.rounding')) {
    settings.fit.rounding = SINGLE_LAYOUT_SUGGESTIONS.rounding
  }
}

function isPaperName(value: unknown): value is PageSettings['paper'] {
  return value === 'letter' || value === 'a4' || value === 'legal'
}

function isLayout(value: unknown): value is PageSettings['layout'] {
  return value === 'single' || value === 'two-up'
}

function isRoundingMode(value: unknown): value is FitSettings['rounding'] {
  return (
    value === 'none' ||
    value === 'even' ||
    value === 'four' ||
    value === 'exact'
  )
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/// Validates one field against its default's type and shape. Falls
/// back to the default for a missing, wrongly typed, or invalid value.
function readPageSettings(raw: unknown): PageSettings {
  const defaults = DEFAULT_SETTINGS.page
  if (typeof raw !== 'object' || raw === null) return { ...defaults }
  const source = raw as Record<string, unknown>
  return {
    paper: isPaperName(source['paper']) ? source['paper'] : defaults.paper,
    layout: isLayout(source['layout']) ? source['layout'] : defaults.layout,
    marginIn: isFiniteNumber(source['marginIn'])
      ? source['marginIn']
      : defaults.marginIn,
    pageNumbers:
      typeof source['pageNumbers'] === 'boolean'
        ? source['pageNumbers']
        : defaults.pageNumbers,
  }
}

function readFitSettings(raw: unknown): FitSettings {
  const defaults = DEFAULT_SETTINGS.fit
  if (typeof raw !== 'object' || raw === null) return { ...defaults }
  const source = raw as Record<string, unknown>
  return {
    rounding: isRoundingMode(source['rounding'])
      ? source['rounding']
      : defaults.rounding,
    exactPages: isFiniteNumber(source['exactPages'])
      ? source['exactPages']
      : defaults.exactPages,
    minFontPx: isFiniteNumber(source['minFontPx'])
      ? source['minFontPx']
      : defaults.minFontPx,
    maxFontPx: isFiniteNumber(source['maxFontPx'])
      ? source['maxFontPx']
      : defaults.maxFontPx,
  }
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return structuredClone(DEFAULT_SETTINGS)
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      page: readPageSettings(parsed['page']),
      fit: readFitSettings(parsed['fit']),
    }
  } catch {
    return structuredClone(DEFAULT_SETTINGS)
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // Storage can be full or unavailable in a private tab. Losing the
    // saved settings is a minor inconvenience, not an error to surface.
  }
}

export function loadMarkdown(): string | null {
  try {
    return localStorage.getItem(MARKDOWN_KEY)
  } catch {
    return null
  }
}

export function saveMarkdown(markdown: string): void {
  try {
    localStorage.setItem(MARKDOWN_KEY, markdown)
  } catch {
    // See saveSettings: a failed write here is not worth surfacing.
  }
}
