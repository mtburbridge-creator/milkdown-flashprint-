import { defineComponent, type PropType } from 'vue'

import type { ViewMode } from './state'

import { segmentClass } from './segmented'
import { formatShortcut } from './shortcuts-panel'
import { VIEW_ORDER } from './state'

const VIEW_LABELS: Record<ViewMode, string> = {
  formatted: 'Formatted',
  markdown: 'Markdown',
  live: 'Live',
}

const CYCLE_HINT = `${formatShortcut(['Mod', 'Shift', '.'])} cycles views`
const SHORTCUTS_KEY = formatShortcut(['Mod', '/'])

interface ViewStripProps {
  view: ViewMode
  onSelect: (view: ViewMode) => void
  onShowShortcuts: () => void
}

export const ViewStrip = defineComponent({
  props: {
    view: {
      type: String as PropType<ViewMode>,
      required: true,
    },
    onSelect: {
      type: Function as PropType<(view: ViewMode) => void>,
      required: true,
    },
    onShowShortcuts: {
      type: Function as PropType<() => void>,
      required: true,
    },
  },
  setup(props: ViewStripProps) {
    return () => (
      <div class="view-strip">
        <div class="dock-label">View</div>
        <div class="view-strip-controls">
          <div class="dock-row dock-segmented" role="group" aria-label="View">
            {VIEW_ORDER.map((view) => (
              <button
                type="button"
                key={view}
                class={segmentClass(view === props.view)}
                aria-pressed={view === props.view}
                title={`${VIEW_LABELS[view]} view (${CYCLE_HINT})`}
                onClick={() => props.onSelect(view)}
              >
                {VIEW_LABELS[view]}
              </button>
            ))}
          </div>
          <button
            type="button"
            class="shortcuts-button"
            aria-label="Keyboard shortcuts"
            title={`Keyboard shortcuts (${SHORTCUTS_KEY})`}
            onClick={props.onShowShortcuts}
          >
            ?
          </button>
        </div>
      </div>
    )
  },
})
