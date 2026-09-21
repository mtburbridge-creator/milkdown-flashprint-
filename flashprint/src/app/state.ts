import type { FitSettings, PageSettings } from '../core/types'

export { SAMPLE_MARKDOWN } from './sample-markdown'

const SETTINGS_KEY = 'flashprint:settings'
const MARKDOWN_KEY = 'flashprint:markdown'
const REFIT_BUSY_KEY = 'flashprint:refit-busy'

/// Hard limits on the fit settings. They apply to typed values and to
/// values read back from storage, so a bad value cannot survive a reload.
/// A large font multiplies the page count, and every page clones the
/// whole document, so an unbounded font can lock the browser tab.
export const FONT_MIN_PX = 6
export const FONT_MAX_PX = 25
export const EXACT_PAGES_MAX = 500
export const MARGIN_MIN_IN = 0.2
export const MARGIN_MAX_IN = 1.5

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/// How the editor pane shows the document. `formatted` is the Crepe
/// WYSIWYG editor, `markdown` is the raw source, and `live` is the
/// formatted text with the syntax of the current block revealed.
export type ViewMode = 'formatted' | 'markdown' | 'live'

export interface EditorSettings {
  view: ViewMode
}

export interface Settings {
  page: PageSettings
  fit: FitSettings
  editor: EditorSettings
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
  editor: {
    view: 'formatted',
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

function isViewMode(value: unknown): value is ViewMode {
  return value === 'formatted' || value === 'markdown' || value === 'live'
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
      ? clamp(source['marginIn'], MARGIN_MIN_IN, MARGIN_MAX_IN)
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
  const minFontPx = isFiniteNumber(source['minFontPx'])
    ? clamp(source['minFontPx'], FONT_MIN_PX, FONT_MAX_PX)
    : defaults.minFontPx
  const maxFontPx = isFiniteNumber(source['maxFontPx'])
    ? clamp(source['maxFontPx'], minFontPx, FONT_MAX_PX)
    : Math.max(defaults.maxFontPx, minFontPx)
  return {
    rounding: isRoundingMode(source['rounding'])
      ? source['rounding']
      : defaults.rounding,
    exactPages: isFiniteNumber(source['exactPages'])
      ? clamp(Math.floor(source['exactPages']), 1, EXACT_PAGES_MAX)
      : defaults.exactPages,
    minFontPx,
    maxFontPx,
  }
}

function readEditorSettings(raw: unknown): EditorSettings {
  const defaults = DEFAULT_SETTINGS.editor
  if (typeof raw !== 'object' || raw === null) return { ...defaults }
  const source = raw as Record<string, unknown>
  return {
    view: isViewMode(source['view']) ? source['view'] : defaults.view,
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
      editor: readEditorSettings(parsed['editor']),
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

/// Marks a refit as running. The mark is cleared when the refit ends or
/// the page unloads normally. A mark that is still there on the next load
/// means the tab froze or was killed mid refit, so the settings that
/// caused it must not be replayed.
export function markRefitStarted(): void {
  try {
    localStorage.setItem(REFIT_BUSY_KEY, String(Date.now()))
  } catch {
    // Without storage there is nothing to replay on the next load.
  }
}

export function markRefitFinished(): void {
  try {
    localStorage.removeItem(REFIT_BUSY_KEY)
  } catch {
    // See markRefitStarted.
  }
}

export function lastRefitUnfinished(): boolean {
  try {
    return localStorage.getItem(REFIT_BUSY_KEY) !== null
  } catch {
    return false
  }
}
