import {
  defineComponent,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
  type PropType,
} from 'vue'

interface SheetRect {
  left: number
  top: number
  width: number
  height: number
}

/// Vertical gap between a sheet's bottom edge and its caption, in
/// screen pixels, applied after scaling.
const CAPTION_OFFSET_PX = 6

/// Width the sheets may occupy: the pane's content box, without its
/// padding. `clientWidth` alone would include the padding and make the
/// scaled sheet overflow sideways.
function availableWidth(pane: HTMLElement): number {
  const style = getComputedStyle(pane)
  return (
    pane.clientWidth -
    parseFloat(style.paddingLeft) -
    parseFloat(style.paddingRight)
  )
}

interface PreviewProps {
  sheets: HTMLElement | null
}

export const Preview = defineComponent({
  props: {
    sheets: {
      type: Object as PropType<HTMLElement | null>,
      default: null,
    },
  },
  setup(props: PreviewProps) {
    const paneRef = ref<HTMLElement | null>(null)
    const mountRef = ref<HTMLElement | null>(null)
    const scale = ref(1)
    const naturalWidth = ref(0)
    const naturalHeight = ref(0)
    const rects = shallowRef<SheetRect[]>([])

    function measure() {
      const mount = mountRef.value
      const pane = paneRef.value
      if (!mount || !pane) return

      const sheetEls = Array.from(
        mount.querySelectorAll<HTMLElement>('.fp-sheet')
      )
      rects.value = sheetEls.map((el) => ({
        left: el.offsetLeft,
        top: el.offsetTop,
        width: el.offsetWidth,
        height: el.offsetHeight,
      }))

      const width = sheetEls[0]?.offsetWidth ?? 0
      naturalWidth.value = width
      naturalHeight.value = mount.scrollHeight

      const next = width > 0 ? Math.min(1, availableWidth(pane) / width) : 1
      // Sub-pixel churn from scrollbar or layout rounding must not feed
      // back into another render.
      if (Math.abs(next - scale.value) > 0.001) scale.value = next
    }

    let resizeObserver: ResizeObserver | undefined
    let mutationObserver: MutationObserver | undefined

    onMounted(() => {
      if (paneRef.value) {
        resizeObserver = new ResizeObserver(measure)
        resizeObserver.observe(paneRef.value)
      }
      if (mountRef.value) {
        mutationObserver = new MutationObserver(measure)
        mutationObserver.observe(mountRef.value, {
          childList: true,
          subtree: true,
        })
      }
      if (props.sheets) mountRef.value?.replaceChildren(props.sheets)
      measure()
    })

    onBeforeUnmount(() => {
      resizeObserver?.disconnect()
      mutationObserver?.disconnect()
    })

    // The sheets element is a detached DOM node built by the core
    // engine. Attaching it directly avoids re-rendering its content
    // through Vue's virtual DOM.
    watch(
      () => props.sheets,
      (sheets) => {
        if (sheets && mountRef.value) mountRef.value.replaceChildren(sheets)
      }
    )

    return () => {
      const total = rects.value.length
      return (
        <div class="preview-pane" ref={paneRef}>
          <div
            class="preview-scale-box"
            style={{
              width: `${naturalWidth.value * scale.value}px`,
              height: `${naturalHeight.value * scale.value}px`,
            }}
          >
            <div
              class="preview-mount"
              ref={mountRef}
              style={{
                transform: `scale(${scale.value})`,
                transformOrigin: 'top left',
              }}
            />
            {rects.value.map((rect, index) => (
              <div
                key={index}
                class="preview-caption"
                style={{
                  left: `${rect.left * scale.value}px`,
                  top: `${(rect.top + rect.height) * scale.value + CAPTION_OFFSET_PX}px`,
                  width: `${rect.width * scale.value}px`,
                }}
              >
                Sheet {index + 1} of {total}
              </div>
            ))}
          </div>
        </div>
      )
    }
  },
})
