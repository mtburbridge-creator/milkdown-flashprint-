// Each pass splits every table at most once, then the layout settles
// again. A table that crosses many pages needs one pass per page.
const MAX_PASSES = 200

function isHeaderRow(row: HTMLTableRowElement | undefined): boolean {
  if (!row || row.cells.length === 0) return false
  return [...row.cells].every((cell) => cell.tagName === 'TH')
}

/// Fixes the column widths the table has now, so every piece of it keeps
/// the same columns once its rows are spread over several tables.
function freezeColumns(table: HTMLTableElement): void {
  if (table.dataset.fpFrozen) return
  const widest = [...table.rows].reduce<HTMLTableRowElement | undefined>(
    (best, row) => (!best || row.cells.length > best.cells.length ? row : best),
    undefined
  )
  if (!widest) return

  // Read the first fragment of each cell in one row. A box that runs onto
  // the next page has a bounding box as wide as both pages.
  const widths = [...widest.cells].map(
    (cell) => cell.getClientRects()[0]?.width ?? 0
  )
  const colgroup = document.createElement('colgroup')
  for (const width of widths) {
    const col = document.createElement('col')
    col.style.width = `${width}px`
    colgroup.appendChild(col)
  }
  table.prepend(colgroup)
  table.style.width = `${widths.reduce((sum, width) => sum + width, 0)}px`
  table.style.tableLayout = 'fixed'
  table.dataset.fpFrozen = 'true'
}

/// Moves the rows from `at` on into a new table right after this one. The
/// new table repeats the header row, if the table has one.
function splitAt(table: HTMLTableElement, at: number): void {
  freezeColumns(table)
  const rows = [...table.rows]
  const header = isHeaderRow(rows[0]) ? rows[0] : undefined

  const rest = table.cloneNode(false) as HTMLTableElement
  rest.dataset.fpContinued = 'true'
  const colgroup = table.querySelector(':scope > colgroup')
  if (colgroup) rest.appendChild(colgroup.cloneNode(true))
  const body = document.createElement('tbody')
  if (header) body.appendChild(header.cloneNode(true))
  for (const row of rows.slice(at)) body.appendChild(row)
  rest.appendChild(body)
  table.after(rest)
}

/// Splits every table that runs from one page onto the next into one
/// table per page, each with the header row on top. `root` must be laid
/// out as the paged flow `measurePages` reads, one page per column.
///
/// Chromium does not repeat a table header when a multicol column breaks
/// a table, and every page here is one of those columns.
export function splitTables(root: HTMLElement, columnWidth: number): void {
  if (columnWidth <= 0) return
  const left = root.getBoundingClientRect().left
  const columnOf = (el: Element) =>
    Math.floor((el.getBoundingClientRect().left - left + 1) / columnWidth)

  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    let changed = false
    for (const table of root.querySelectorAll('table')) {
      const rows = [...table.rows]
      // A piece must keep at least one data row under its header.
      const first = isHeaderRow(rows[0]) ? 2 : 1
      for (let index = first; index < rows.length; index += 1) {
        if (columnOf(rows[index]!) <= columnOf(rows[index - 1]!)) continue
        splitAt(table, index)
        changed = true
        break
      }
    }
    if (!changed) return
  }
}
