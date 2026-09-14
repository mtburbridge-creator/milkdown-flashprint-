import type { Editor } from '@milkdown/kit/core'

import { editorViewCtx, schemaCtx } from '@milkdown/kit/core'
import { DOMSerializer } from '@milkdown/kit/prose/model'
import katex from 'katex'

// Attributes the editor needs and the print document does not.
const EDITOR_ATTRIBUTES = ['contenteditable', 'draggable']

// Classes the editor view adds to its own DOM.
const EDITOR_CLASS_PREFIX = 'ProseMirror'

// List attributes that only drive the editor view.
const LIST_ATTRIBUTES = ['data-label', 'data-list-type', 'data-spread']

function replaceLatexBlocks(root: HTMLElement): void {
  for (const pre of root.querySelectorAll('pre[data-language]')) {
    const language = pre.getAttribute('data-language') ?? ''
    if (language.toLowerCase() !== 'latex') continue

    const block = document.createElement('div')
    block.className = 'fp-math-block'
    block.innerHTML = katex.renderToString(pre.textContent ?? '', {
      displayMode: true,
      throwOnError: false,
    })
    pre.replaceWith(block)
  }
}

function replaceImageBlocks(root: HTMLElement): void {
  for (const node of root.querySelectorAll('img[data-type="image-block"]')) {
    const caption = node.getAttribute('caption') ?? ''
    const ratio = Number(node.getAttribute('ratio') ?? '1')

    const image = document.createElement('img')
    image.setAttribute('src', node.getAttribute('src') ?? '')
    image.setAttribute('alt', caption)
    // A ratio of 1 means full width, so only a smaller one needs a width.
    if (Number.isFinite(ratio) && ratio > 0 && ratio < 1)
      image.setAttribute('style', `width: calc(${ratio} * 100%)`)

    const figure = document.createElement('figure')
    figure.className = 'fp-figure'
    figure.appendChild(image)
    if (caption.length > 0) {
      const figcaption = document.createElement('figcaption')
      figcaption.textContent = caption
      figure.appendChild(figcaption)
    }
    node.replaceWith(figure)
  }
}

function cleanListItems(root: HTMLElement): void {
  for (const item of root.querySelectorAll('li')) {
    const checked = item.getAttribute('data-checked')
    for (const name of LIST_ATTRIBUTES) item.removeAttribute(name)
    if (checked === null) continue

    item.classList.add('fp-task')
    if (checked === 'true') item.classList.add('fp-task-done')

    const checkbox = document.createElement('span')
    checkbox.className = 'fp-checkbox'
    checkbox.setAttribute('aria-hidden', 'true')
    item.prepend(checkbox)
  }
}

function stripElement(el: Element): void {
  for (const name of EDITOR_ATTRIBUTES) el.removeAttribute(name)

  // `classList` is live, so read the names before the loop removes any.
  const names = el.getAttribute('class')?.split(/\s+/) ?? []
  for (const name of names)
    if (name.startsWith(EDITOR_CLASS_PREFIX)) el.classList.remove(name)
}

function stripEditorMarkup(root: HTMLElement): void {
  stripElement(root)
  for (const el of root.querySelectorAll('*')) stripElement(el)
}

function removeTrailingParagraph(root: HTMLElement): void {
  const last = root.lastElementChild
  if (!last || last.tagName !== 'P') return
  if (last.childElementCount > 0 || last.textContent !== '') return
  last.remove()
}

/// Serialize the editor content into a standalone print document.
///
/// The result carries the `fp-doc` class that `print.css` styles. It is not
/// attached to the document.
export function renderPrintDoc(editor: Editor): HTMLElement {
  return editor.action((ctx) => {
    const schema = ctx.get(schemaCtx)
    const view = ctx.get(editorViewCtx)

    const root = document.createElement('div')
    root.className = 'fp-doc'
    root.appendChild(
      DOMSerializer.fromSchema(schema).serializeFragment(view.state.doc.content)
    )

    replaceLatexBlocks(root)
    replaceImageBlocks(root)
    cleanListItems(root)
    stripEditorMarkup(root)
    removeTrailingParagraph(root)

    return root
  })
}
