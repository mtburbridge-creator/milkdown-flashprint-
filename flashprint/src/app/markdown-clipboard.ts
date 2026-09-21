import type { Ctx, MilkdownPlugin } from '@milkdown/kit/ctx'
import type { Fragment, Schema, Slice } from '@milkdown/kit/prose/model'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { Serializer } from '@milkdown/kit/transformer'

import { schemaCtx, serializerCtx } from '@milkdown/kit/core'
import { Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { $prose } from '@milkdown/kit/utils'

type UnknownRecord = Record<string, unknown>

/// Report whether the content holds one text node that carries no mark.
/// Such a selection copies as it reads. Running it through the serializer
/// would add markdown escapes to characters the person typed as text.
/// Marked text takes the serializer instead, so bold stays bold.
export function isUnmarkedText(
  content: UnknownRecord | UnknownRecord[] | undefined | null
): boolean {
  if (!content) return false
  if (Array.isArray(content)) {
    if (content.length > 1) return false
    return isUnmarkedText(content[0])
  }

  const child = content.content
  if (child) return isUnmarkedText(child as UnknownRecord[])

  if (content.type !== 'text') return false

  const marks = content.marks
  return !Array.isArray(marks) || marks.length === 0
}

/// Remove one newline from the end of the text.
/// The markdown serializer ends a document with a newline. A paste in the
/// middle of a sentence must not get that extra blank line.
export function trimOneTrailingNewline(text: string): string {
  return text.endsWith('\n') ? text.slice(0, -1) : text
}

function serializeAsDocument(
  content: Fragment,
  schema: Schema,
  serializer: Serializer
): string {
  const doc = schema.topNodeType.createAndFill(undefined, content)
  if (!doc) return ''

  return serializer(doc)
}

/// Turn a selected slice into markdown.
export function sliceToMarkdown(
  slice: Slice,
  schema: Schema,
  serializer: Serializer
): string {
  const { content } = slice
  const markdown = isUnmarkedText(content.toJSON())
    ? content.textBetween(0, content.size, '\n\n')
    : serializeAsDocument(content, schema, serializer)

  return trimOneTrailingNewline(markdown)
}

function writeMarkdownToClipboard(
  ctx: Ctx,
  view: EditorView,
  event: ClipboardEvent
): boolean {
  const { clipboardData } = event
  if (!clipboardData || view.state.selection.empty) return false

  const markdown = sliceToMarkdown(
    view.state.selection.content(),
    ctx.get(schemaCtx),
    ctx.get(serializerCtx)
  )

  event.preventDefault()
  clipboardData.clearData()
  // An application that accepts rich text prefers `text/html` and derives
  // its own markdown from it. That derived markdown carries escapes and
  // hard breaks. The clipboard holds `text/plain` alone, so every target
  // gets the clean markdown.
  clipboardData.setData('text/plain', markdown)
  return true
}

const key = new PluginKey('FLASHPRINT_MARKDOWN_CLIPBOARD')

/// A milkdown plugin that puts markdown alone on the clipboard.
/// Install it after the Crepe plugins with `editor.use(markdownClipboard)`.
export const markdownClipboard: MilkdownPlugin = $prose((ctx) => {
  return new Plugin({
    key,
    props: {
      handleDOMEvents: {
        copy: (view, event) => writeMarkdownToClipboard(ctx, view, event),
        cut: (view, event) => {
          const editable = view.props.editable?.(view.state) ?? true
          if (!editable) return false
          if (!writeMarkdownToClipboard(ctx, view, event)) return false

          view.dispatch(view.state.tr.deleteSelection())
          return true
        },
      },
    },
  })
})
