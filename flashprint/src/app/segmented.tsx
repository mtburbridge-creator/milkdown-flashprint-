import type { VNode } from 'vue'

/// One choice in a segmented control.
export interface Segment<T extends string> {
  value: T
  label: string
}

export function segmentClass(selected: boolean): string[] {
  return selected ? ['dock-segment', 'is-selected'] : ['dock-segment']
}

/// Builds the buttons of a segmented control. The caller wraps them in
/// a `dock-row dock-segmented` element that carries the group label.
export function segmentButtons<T extends string>(
  segments: Array<Segment<T>>,
  selected: T,
  onSelect: (value: T) => void
): VNode[] {
  return segments.map((segment) => (
    <button
      type="button"
      key={segment.value}
      class={segmentClass(segment.value === selected)}
      aria-pressed={segment.value === selected}
      onClick={() => onSelect(segment.value)}
    >
      {segment.label}
    </button>
  ))
}
