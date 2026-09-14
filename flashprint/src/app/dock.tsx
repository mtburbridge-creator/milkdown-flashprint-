import { defineComponent, type VNode } from 'vue'

import type { PaperName, RoundingMode } from '../core/types'
import type { Settings, TouchedFields } from './state'

import { PAPERS } from '../core'
import {
  applyLayoutSuggestions,
  clamp,
  EXACT_PAGES_MAX,
  FONT_MAX_PX,
  FONT_MIN_PX,
  MARGIN_MAX_IN,
  MARGIN_MIN_IN,
} from './state'

interface DockProps {
  settings: Settings
  touched: TouchedFields
}

interface Segment<T extends string> {
  value: T
  label: string
}

/// One labelled segmented control. `extra` holds a trailing segment
/// that carries its own widget, such as the exact page count.
interface SegmentedField<T extends string> {
  label: string
  segments: Array<Segment<T>>
  selected: T
  onSelect: (value: T) => void
  extra?: VNode
}

const LAYOUT_SEGMENTS: Array<Segment<Settings['page']['layout']>> = [
  { value: 'two-up', label: 'Two-up' },
  { value: 'single', label: 'Single' },
]

const PAPER_SEGMENTS: Array<Segment<PaperName>> = (
  Object.keys(PAPERS) as PaperName[]
).map((name) => ({ value: name, label: PAPERS[name].label }))

const ROUNDING_SEGMENTS: Array<Segment<RoundingMode>> = [
  { value: 'none', label: 'None' },
  { value: 'even', label: 'Even' },
  { value: 'four', label: '×4' },
]

const MARGIN_STEP = 0.05

function toNumber(event: Event): number {
  return Number((event.target as HTMLInputElement).value)
}

/// Writes a capped value back into the input. When the cap leaves the
/// model unchanged, Vue has nothing to re-render and the typed text would
/// stay on screen.
function echo(event: Event, value: number): void {
  const input = event.target as HTMLInputElement
  if (Number(input.value) !== value) input.value = String(value)
}

/// Enter commits a number cell. Leaving the field fires `change` on its
/// own, so a blur is all Enter has to do.
function commitOnEnter(event: KeyboardEvent): void {
  if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
}

/// Keeps the margin on the step grid. A sum of steps in binary floating
/// point drifts away from the two decimals the label shows.
function roundMargin(inches: number): number {
  return Math.round(inches * 100) / 100
}

function segmentClass(selected: boolean): string[] {
  return selected ? ['dock-segment', 'is-selected'] : ['dock-segment']
}

function segmentedField<T extends string>(field: SegmentedField<T>): VNode {
  return (
    <div class="dock-field">
      <div class="dock-label">{field.label}</div>
      <div
        class="dock-row dock-segmented"
        role="group"
        aria-label={field.label}
      >
        {field.segments.map((segment) => (
          <button
            type="button"
            key={segment.value}
            class={segmentClass(segment.value === field.selected)}
            aria-pressed={segment.value === field.selected}
            onClick={() => field.onSelect(segment.value)}
          >
            {segment.label}
          </button>
        ))}
        {field.extra}
      </div>
    </div>
  )
}

export const Dock = defineComponent<DockProps>({
  props: {
    settings: {
      type: Object,
      required: true,
    },
    touched: {
      type: Object,
      required: true,
    },
  },
  setup(props) {
    function onLayoutChange(value: Settings['page']['layout']) {
      props.settings.page.layout = value
      applyLayoutSuggestions(props.settings, props.touched)
    }

    function stepMargin(steps: number) {
      props.touched.add('page.marginIn')
      const next = roundMargin(
        props.settings.page.marginIn + steps * MARGIN_STEP
      )
      props.settings.page.marginIn = clamp(next, MARGIN_MIN_IN, MARGIN_MAX_IN)
    }

    function onRoundingChange(value: RoundingMode) {
      props.touched.add('fit.rounding')
      props.settings.fit.rounding = value
    }

    function onMinFontChange(event: Event) {
      const value = toNumber(event)
      if (!Number.isFinite(value)) return
      props.settings.fit.minFontPx = clamp(value, FONT_MIN_PX, FONT_MAX_PX)
      echo(event, props.settings.fit.minFontPx)
      if (props.settings.fit.maxFontPx < props.settings.fit.minFontPx) {
        props.settings.fit.maxFontPx = props.settings.fit.minFontPx
      }
    }

    function onMaxFontChange(event: Event) {
      const value = toNumber(event)
      if (!Number.isFinite(value)) return
      props.settings.fit.maxFontPx = clamp(
        value,
        props.settings.fit.minFontPx,
        FONT_MAX_PX
      )
      echo(event, props.settings.fit.maxFontPx)
    }

    function onExactPagesChange(event: Event) {
      const value = toNumber(event)
      if (!Number.isFinite(value)) return
      props.settings.fit.exactPages = clamp(
        Math.floor(value),
        1,
        EXACT_PAGES_MAX
      )
      echo(event, props.settings.fit.exactPages)
    }

    return () => {
      const { settings } = props
      const minFontPt = (settings.fit.minFontPx * 0.75).toFixed(1)
      const exact = settings.fit.rounding === 'exact'

      return (
        <div class="dock">
          {segmentedField({
            label: 'Layout',
            segments: LAYOUT_SEGMENTS,
            selected: settings.page.layout,
            onSelect: onLayoutChange,
          })}

          {segmentedField({
            label: 'Paper',
            segments: PAPER_SEGMENTS,
            selected: settings.page.paper,
            onSelect: (value) => {
              settings.page.paper = value
            },
          })}

          <div class="dock-field">
            <div class="dock-label">Margin</div>
            <div class="dock-row">
              <button
                type="button"
                class="dock-step"
                aria-label="Decrease margin"
                onClick={() => stepMargin(-1)}
              >
                −
              </button>
              <div class="dock-value">
                {roundMargin(settings.page.marginIn)} in
              </div>
              <button
                type="button"
                class="dock-step"
                aria-label="Increase margin"
                onClick={() => stepMargin(1)}
              >
                +
              </button>
            </div>
          </div>

          {segmentedField({
            label: 'Round pages to',
            segments: ROUNDING_SEGMENTS,
            selected: settings.fit.rounding,
            onSelect: onRoundingChange,
            extra: (
              <span class={[...segmentClass(exact), 'dock-exact']}>
                <button
                  type="button"
                  class="dock-exact-button"
                  aria-pressed={exact}
                  onClick={() => onRoundingChange('exact')}
                >
                  Exact
                </button>
                <input
                  type="number"
                  class="dock-exact-input"
                  aria-label="Exact page count"
                  min={1}
                  max={EXACT_PAGES_MAX}
                  disabled={!exact}
                  value={settings.fit.exactPages}
                  onChange={onExactPagesChange}
                  onKeydown={commitOnEnter}
                />
              </span>
            ),
          })}

          <div class="dock-field">
            <div class="dock-label">Font px · min / base</div>
            <div class="dock-row">
              <input
                type="number"
                class="dock-number"
                aria-label="Minimum font size in pixels"
                title={`${minFontPt} pt`}
                step={0.5}
                min={FONT_MIN_PX}
                max={FONT_MAX_PX}
                value={settings.fit.minFontPx}
                onChange={onMinFontChange}
                onKeydown={commitOnEnter}
              />
              <span class="dock-arrow">→</span>
              <input
                type="number"
                class="dock-number"
                aria-label="Base font size in pixels"
                step={0.5}
                min={FONT_MIN_PX}
                max={FONT_MAX_PX}
                value={settings.fit.maxFontPx}
                onChange={onMaxFontChange}
                onKeydown={commitOnEnter}
              />
            </div>
          </div>

          <div class="dock-toggle-field">
            <span id="dock-page-numbers">Page numbers</span>
            <button
              type="button"
              class="dock-toggle"
              role="switch"
              aria-checked={settings.page.pageNumbers}
              aria-labelledby="dock-page-numbers"
              onClick={() => {
                settings.page.pageNumbers = !settings.page.pageNumbers
              }}
            >
              <span class="dock-toggle-knob" />
            </button>
          </div>
        </div>
      )
    }
  },
})
