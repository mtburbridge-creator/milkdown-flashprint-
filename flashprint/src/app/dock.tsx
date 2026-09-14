import { defineComponent, type VNode } from 'vue'

import type { PaperName, RoundingMode } from '../core/types'
import type { Settings, TouchedFields } from './state'

import { PAPERS } from '../core'
import { applyLayoutSuggestions } from './state'

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
const MARGIN_MIN = 0.2
const MARGIN_MAX = 1.5

function toNumber(event: Event): number {
  return Number((event.target as HTMLInputElement).value)
}

/// Keeps the margin on the step grid. A sum of steps in binary floating
/// point drifts away from the two decimals the label shows.
function roundMargin(inches: number): number {
  return Math.round(inches * 100) / 100
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
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
      props.settings.page.marginIn = clamp(next, MARGIN_MIN, MARGIN_MAX)
    }

    function onRoundingChange(value: RoundingMode) {
      props.touched.add('fit.rounding')
      props.settings.fit.rounding = value
    }

    function onMinFontChange(event: Event) {
      const value = toNumber(event)
      props.settings.fit.minFontPx = value
      if (props.settings.fit.maxFontPx < value) {
        props.settings.fit.maxFontPx = value
      }
    }

    function onMaxFontChange(event: Event) {
      const value = toNumber(event)
      props.settings.fit.maxFontPx = Math.max(
        value,
        props.settings.fit.minFontPx
      )
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
                  max={999}
                  disabled={!exact}
                  value={settings.fit.exactPages}
                  onInput={(event) => {
                    settings.fit.exactPages = toNumber(event)
                  }}
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
                min={6}
                max={16}
                value={settings.fit.minFontPx}
                onInput={onMinFontChange}
              />
              <span class="dock-arrow">→</span>
              <input
                type="number"
                class="dock-number"
                aria-label="Base font size in pixels"
                step={0.5}
                min={10}
                max={24}
                value={settings.fit.maxFontPx}
                onInput={onMaxFontChange}
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
