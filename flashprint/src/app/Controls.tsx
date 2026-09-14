import { defineComponent, h } from 'vue'

import type { PaperName, RoundingMode } from '../core/types'
import type { TouchedFields } from './state'

import { PAPERS } from '../core'
import { applyLayoutSuggestions, type Settings } from './state'

interface ControlsProps {
  settings: Settings
  touched: TouchedFields
}

const PAPER_ENTRIES = Object.entries(PAPERS) as Array<
  [PaperName, (typeof PAPERS)[PaperName]]
>

const ROUNDING_OPTIONS: Array<{ value: RoundingMode; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'even', label: 'Even' },
  { value: 'four', label: 'Multiple of 4' },
  { value: 'exact', label: 'Exact' },
]

function toNumber(event: Event): number {
  return Number((event.target as HTMLInputElement).value)
}

export const Controls = defineComponent<ControlsProps>({
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

    function onMarginChange(event: Event) {
      props.touched.add('page.marginIn')
      props.settings.page.marginIn = toNumber(event)
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

      return (
        <form class="controls" onSubmit={(event) => event.preventDefault()}>
          <fieldset class="controls-group">
            <legend>Layout</legend>
            <label class="controls-radio">
              <input
                type="radio"
                name="layout"
                checked={settings.page.layout === 'two-up'}
                onChange={() => onLayoutChange('two-up')}
              />
              Two pages per sheet (landscape)
            </label>
            <label class="controls-radio">
              <input
                type="radio"
                name="layout"
                checked={settings.page.layout === 'single'}
                onChange={() => onLayoutChange('single')}
              />
              One page per sheet (portrait)
            </label>
          </fieldset>

          <label class="controls-field">
            Paper
            <select
              value={settings.page.paper}
              onChange={(event) => {
                settings.page.paper = (event.target as HTMLSelectElement)
                  .value as PaperName
              }}
            >
              {PAPER_ENTRIES.map(([name, paper]) => (
                <option key={name} value={name}>
                  {paper.label}
                </option>
              ))}
            </select>
          </label>

          <label class="controls-field">
            Margin (in)
            <input
              type="number"
              step={0.05}
              min={0.2}
              max={1.5}
              value={settings.page.marginIn}
              onInput={onMarginChange}
            />
          </label>

          <fieldset class="controls-group">
            <legend>Round pages to</legend>
            {ROUNDING_OPTIONS.map((option) => (
              <label class="controls-radio" key={option.value}>
                <input
                  type="radio"
                  name="rounding"
                  checked={settings.fit.rounding === option.value}
                  onChange={() => onRoundingChange(option.value)}
                />
                {option.label}
                {option.value === 'exact' && (
                  <input
                    type="number"
                    class="controls-inline-number"
                    min={1}
                    max={999}
                    disabled={settings.fit.rounding !== 'exact'}
                    value={settings.fit.exactPages}
                    onInput={(event) => {
                      settings.fit.exactPages = toNumber(event)
                    }}
                  />
                )}
              </label>
            ))}
          </fieldset>

          <label class="controls-field">
            Minimum font size (px)
            <input
              type="number"
              step={0.5}
              min={6}
              max={16}
              value={settings.fit.minFontPx}
              onInput={onMinFontChange}
            />
            <span class="controls-hint">{minFontPt} pt</span>
          </label>

          <label class="controls-field">
            Base font size (px)
            <input
              type="number"
              step={0.5}
              min={10}
              max={24}
              value={settings.fit.maxFontPx}
              onInput={onMaxFontChange}
            />
          </label>

          <label class="controls-checkbox">
            <input
              type="checkbox"
              checked={settings.page.pageNumbers}
              onChange={(event) => {
                settings.page.pageNumbers = (
                  event.target as HTMLInputElement
                ).checked
              }}
            />
            Page numbers
          </label>

          <p class="controls-tips">
            In the print dialog choose Landscape (or Portrait for one page
            per sheet), Margins: None, Scale: 100%, and turn off headers
            and footers. Page size is set by the app.
          </p>
        </form>
      )
    }
  },
})
