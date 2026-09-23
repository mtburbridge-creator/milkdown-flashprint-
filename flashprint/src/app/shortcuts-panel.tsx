import {
  defineComponent,
  onBeforeUnmount,
  onMounted,
  ref,
  type PropType,
  type VNode,
} from 'vue'

/// One key of a shortcut. `Mod` is Cmd on macOS and Ctrl elsewhere.
/// `Alt`, `Shift` and `Ctrl` get their platform symbol. Any other key
/// shows as written.
export type Key = string

function detectMac(): boolean {
  const nav = navigator as Navigator & {
    userAgentData?: { platform: string }
  }
  return /mac|iphone|ipad/i.test(nav.userAgentData?.platform ?? nav.platform)
}

export const IS_MAC = detectMac()

const MAC_KEY_LABELS: Record<Key, string> = {
  Mod: '⌘',
  Alt: '⌥',
  Shift: '⇧',
  Ctrl: '⌃',
}

const OTHER_KEY_LABELS: Record<Key, string> = {
  Mod: 'Ctrl',
  Alt: 'Alt',
  Shift: 'Shift',
  Ctrl: 'Ctrl',
}

function keyLabel(key: Key): string {
  return (IS_MAC ? MAC_KEY_LABELS : OTHER_KEY_LABELS)[key] ?? key
}

/// Formats a shortcut for a tooltip, for example `Ctrl+Shift+.` or `⌘⇧.`.
export function formatShortcut(keys: Key[]): string {
  return keys.map(keyLabel).join(IS_MAC ? '' : '+')
}

/// Tells whether the platform command modifier is down and the other
/// one is not, so Ctrl on macOS never passes for Cmd.
export function hasModKey(event: KeyboardEvent): boolean {
  return IS_MAC
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey
}

interface KeyRow {
  action: string
  /// Alternative key combinations, shown with a slash between them.
  combos: Key[][]
}

interface KeyGroup {
  title: string
  rows: KeyRow[]
}

interface TypingRow {
  typed: string[]
  result: string
  highlight?: boolean
}

const FORMATTING: KeyGroup = {
  title: 'Formatting',
  rows: [
    { action: 'Bold', combos: [['Mod', 'B']] },
    { action: 'Italic', combos: [['Mod', 'I']] },
    { action: 'Inline code', combos: [['Mod', 'E']] },
    { action: 'Strikethrough', combos: [['Mod', 'Alt', 'X']] },
    { action: 'Highlight', combos: [['Mod', 'Shift', 'H']] },
    { action: 'Link', combos: [['Mod', 'K']] },
  ],
}

const BLOCKS: KeyGroup = {
  title: 'Blocks',
  rows: [
    { action: 'Paragraph', combos: [['Mod', 'Alt', '0']] },
    { action: 'Heading 1 to 6', combos: [['Mod', 'Alt', '1–6']] },
    { action: 'Bullet list', combos: [['Mod', 'Alt', '8']] },
    { action: 'Numbered list', combos: [['Mod', 'Alt', '7']] },
    { action: 'Code block', combos: [['Mod', 'Alt', 'C']] },
    { action: 'Quote', combos: [['Mod', 'Shift', 'B']] },
    {
      action: 'Indent or outdent a list item',
      combos: [['Tab'], ['Shift', 'Tab']],
    },
    {
      action: 'Move block up or down',
      combos: [
        ['Alt', '↑'],
        ['Alt', '↓'],
      ],
    },
    {
      action: 'Duplicate block',
      combos: [
        ['Alt', 'Shift', '↑'],
        ['Alt', 'Shift', '↓'],
      ],
    },
  ],
}

const FIND: KeyGroup = {
  title: 'Find',
  rows: [
    { action: 'Find', combos: [['Mod', 'F']] },
    {
      action: 'Find and replace',
      combos: [IS_MAC ? ['Mod', 'Alt', 'F'] : ['Ctrl', 'H']],
    },
    { action: 'Next match', combos: [['Enter']] },
    { action: 'Previous match', combos: [['Shift', 'Enter']] },
    { action: 'Close', combos: [['Esc']] },
  ],
}

const APP: KeyGroup = {
  title: 'App',
  rows: [
    { action: 'Save as markdown', combos: [['Mod', 'S']] },
    { action: 'Cycle views', combos: [['Mod', 'Shift', '.']] },
    { action: 'Keyboard shortcuts', combos: [['Mod', '/']] },
    { action: 'Undo', combos: [['Mod', 'Z']] },
    { action: 'Redo', combos: [['Mod', 'Shift', 'Z']] },
  ],
}

const TYPING: TypingRow[] = [
  { typed: ['->'], result: '→' },
  { typed: ['<-'], result: '←' },
  { typed: ['=>'], result: '⇒' },
  { typed: ['<->'], result: '↔' },
  { typed: ['...'], result: '…' },
  { typed: ['==text=='], result: 'highlighted', highlight: true },
  {
    typed: ['@date', '@time', '@today'],
    result: 'the current date, time, or both',
  },
]

const TITLE_ID = 'fp-shortcuts-title'

function renderCombos(combos: Key[][]): VNode[] {
  return combos.flatMap((combo, index) => {
    const keys = (
      <span class="shortcuts-combo">
        {combo.map((key) => (
          <kbd>{keyLabel(key)}</kbd>
        ))}
      </span>
    )
    return index === 0 ? [keys] : [<span class="shortcuts-or">/</span>, keys]
  })
}

function renderGroup(group: KeyGroup): VNode {
  return (
    <section class="shortcuts-group">
      <h3>{group.title}</h3>
      <dl>
        {group.rows.map((row) => (
          <div class="shortcuts-row" key={row.action}>
            <dt>{row.action}</dt>
            <dd>{renderCombos(row.combos)}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function renderTyping(): VNode {
  return (
    <section class="shortcuts-group">
      <h3>Typing shortcuts</h3>
      <dl class="shortcuts-typing">
        {TYPING.map((row) => (
          <div class="shortcuts-row" key={row.typed.join(' ')}>
            <dt class="shortcuts-typed">
              {row.typed.map((text) => (
                <kbd>{text}</kbd>
              ))}
            </dt>
            <dd class="shortcuts-result">
              <span class="shortcuts-or">→</span>
              {row.highlight ? <mark>{row.result}</mark> : row.result}
            </dd>
          </div>
        ))}
      </dl>
      <p class="shortcuts-note">
        Typing shortcuts apply to what you type in the Formatted and Live views,
        never to pasted text or code.
      </p>
    </section>
  )
}

interface ShortcutsPanelProps {
  onClose: () => void
}

/// The modal list of keyboard shortcuts. The app closes it on Escape
/// and on `Mod-/` from its window key handler.
export const ShortcutsPanel = defineComponent({
  props: {
    onClose: {
      type: Function as PropType<() => void>,
      required: true,
    },
  },
  setup(props: ShortcutsPanelProps) {
    const panelRef = ref<HTMLElement | null>(null)
    const closeRef = ref<HTMLButtonElement | null>(null)
    let returnFocus: HTMLElement | null = null

    onMounted(() => {
      const active = document.activeElement
      returnFocus = active instanceof HTMLElement ? active : null
      panelRef.value?.focus()
    })

    onBeforeUnmount(() => {
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true })
    })

    // The close button is the only control, so Tab keeps focus on it.
    function keepFocusInside(event: KeyboardEvent) {
      if (event.key !== 'Tab') return
      event.preventDefault()
      closeRef.value?.focus()
    }

    function onBackdropClick(event: MouseEvent) {
      if (event.target === event.currentTarget) props.onClose()
    }

    return () => (
      <div class="shortcuts-backdrop" onClick={onBackdropClick}>
        <div
          ref={panelRef}
          class="shortcuts-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby={TITLE_ID}
          tabindex={-1}
          onKeydown={keepFocusInside}
        >
          <header class="shortcuts-header">
            <h2 id={TITLE_ID}>Keyboard shortcuts</h2>
            <button
              ref={closeRef}
              type="button"
              class="shortcuts-close"
              aria-label="Close"
              title="Close (Esc)"
              onClick={props.onClose}
            >
              ×
            </button>
          </header>
          <div class="shortcuts-columns">
            <div class="shortcuts-column">
              {renderGroup(FORMATTING)}
              {renderGroup(BLOCKS)}
            </div>
            <div class="shortcuts-column">
              {renderGroup(FIND)}
              {renderGroup(APP)}
              {renderTyping()}
            </div>
          </div>
          <footer class="shortcuts-footer">
            <p>
              In the Markdown view, formatting, block and typing shortcuts do
              not apply; find, save, views and this panel do.
            </p>
            {IS_MAC && (
              <p>
                Option-↑ and Option-↓ move blocks here instead of jumping to
                paragraph edges.
              </p>
            )}
          </footer>
        </div>
      </div>
    )
  },
})
