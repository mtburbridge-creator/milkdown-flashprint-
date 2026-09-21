import { defineComponent, type PropType } from 'vue'

import type { Segment } from './segmented'
import type { ViewMode } from './state'

import { segmentButtons } from './segmented'

const VIEW_SEGMENTS: Array<Segment<ViewMode>> = [
  { value: 'formatted', label: 'Formatted' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'live', label: 'Live' },
]

interface ViewStripProps {
  view: ViewMode
  onSelect: (view: ViewMode) => void
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
  },
  setup(props: ViewStripProps) {
    return () => (
      <div class="view-strip">
        <div class="dock-label">View</div>
        <div class="dock-row dock-segmented" role="group" aria-label="View">
          {segmentButtons(VIEW_SEGMENTS, props.view, props.onSelect)}
        </div>
      </div>
    )
  },
})
