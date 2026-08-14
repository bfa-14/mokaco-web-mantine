import { CloseButton, Select, Table, TextInput } from '@mantine/core'
import type { Column, Row, RowData, Table as TanstackTable } from '@tanstack/react-table'

/**
 * The DevExtreme `<FilterRow visible />` this port dropped, rebuilt once for every grid.
 *
 * The original app put a per-column filter strip under the header of effectively every DataGrid,
 * alongside the SearchPanel and the HeaderFilter funnel. The port kept only the search box; this
 * restores the strip, and {@link GridHeaderFilter} restores the funnel. All three AND together,
 * exactly as DevExtreme combined them, because TanStack ANDs `columnFilters` with `globalFilter`
 * and the two column-filter kinds share one value — see {@link GridFilterValue}.
 *
 * Three cell shapes, chosen per column:
 *   · nothing        — the column cannot be filtered (a display/action column, or `meta.noFilter`)
 *   · a Select       — `meta.filterOptions` names a closed set of DISPLAYED labels (status, enum)
 *   · a text box     — everything else, contains-matching
 *
 * Deliberately carries no words of its own — no placeholder, no "All" — so it needs no translation
 * and reads the same in both languages, which is also how DX's own filter row looked.
 */

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** No filter cell and no funnel — for action/button columns built on an accessor. */
    noFilter?: boolean
    /**
     * Keep the filter-row cell but drop the funnel. For columns whose values are free prose
     * (a note, a reason, a description) or unbounded (a timestamp to the minute), where a list
     * of distinct values is one row per row and helps nobody.
     */
    noHeaderFilter?: boolean
    /**
     * Turns the filter cell into a dropdown over this closed set. The strings are what the CELL
     * shows, not what the row stores, so a column whose accessor is a code pairs this with
     * {@link ColumnMeta.filterText}.
     */
    filterOptions?: string[]
    /**
     * The row's DISPLAYED text for this column, when the cell renders something other than the
     * accessor — a date through a formatter, money, a name composed of several fields.
     *
     * The accessor stays raw so sorting stays chronological/numeric; only the MATCH and the
     * funnel's value list move to the rendered text, because a user filtering a date column
     * works from what they can see ("14/07"), not the ISO string underneath it.
     *
     * Takes the raw value AND the row, so a cell built from the accessor alone can name its
     * formatter directly (`filterText: formatDate`) while one composed from several fields
     * still has everything it needs (`filterText: (_v, r) => `${r.first} ${r.last}``).
     */
    filterText?: (value: TValue, row: TData) => string
  }
}

/**
 * ONE value per column, shared by the two filter kinds.
 *
 * A TanStack column holds a single filter value, and DevExtreme's FilterRow and HeaderFilter were
 * two independent filters on the same column that ANDed. Both live here — `text` is the filter
 * row's contribution, `values` the funnel's — so the two can never disagree about what a column
 * is filtered to. Either half absent means that half is not filtering.
 */
export interface GridFilterValue {
  text?: string
  values?: string[]
}

/** What an empty cell is called in the funnel's list — it has to be tickable like any other value. */
export const BLANKS = '(Blanks)'

/**
 * The string a column SHOWS for a row: `meta.filterText` where the cell is formatted, the raw
 * accessor value otherwise, and {@link BLANKS} for anything empty.
 *
 * The single definition of "what this cell says", used by the filter function, the funnel's value
 * list, and the funnel's tick matching — so a value you can see is always a value you can pick.
 */
export function displayText<TData extends RowData>(
  row: Row<TData>,
  column: Column<TData, unknown>,
): string {
  const format = column.columnDef.meta?.filterText
  const raw = row.getValue(column.id)
  const text = format ? format(raw, row.original) : raw == null ? '' : String(raw)
  return text.trim() === '' ? BLANKS : text
}

/** The column a filter function was handed, recovered from the row it is testing. */
function columnOf<TData extends RowData>(
  row: Row<TData>,
  columnId: string,
): Column<TData, unknown> | undefined {
  return row.getAllCells().find((cell) => cell.column.id === columnId)?.column
}

/**
 * THE filter function — every grid's `defaultColumn.filterFn`, and the only one.
 *
 * Both filter kinds resolve the row to the same display string and test it: the funnel by
 * membership, the filter row by case-insensitive contains. Routing every grid and every column
 * through one function is what makes "what the funnel offered" and "what the box matches"
 * provably the same set of strings.
 */
export function gridFilterFn<TData extends RowData>(
  row: Row<TData>,
  columnId: string,
  filterValue: unknown,
): boolean {
  const filter = filterValue as GridFilterValue | undefined
  if (!filter) return true

  const { text, values } = filter
  const hasValues = Array.isArray(values) && values.length > 0
  if (!text && !hasValues) return true

  const column = columnOf(row, columnId)
  if (!column) return true
  const display = displayText(row, column)

  if (hasValues && !values.includes(display)) return false
  if (text && !display.toLowerCase().includes(text.toLowerCase())) return false
  return true
}

/**
 * Merge one half of a column's filter over the other, collapsing to `undefined` once neither half
 * is filtering — a column with an empty value must read as UNFILTERED, or the funnel icon stays
 * lit and TanStack keeps a dead entry in `columnFilters`.
 */
export function nextFilterValue(
  current: GridFilterValue | undefined,
  patch: Partial<GridFilterValue>,
): GridFilterValue | undefined {
  const merged = { ...current, ...patch }
  const text = merged.text ? merged.text : undefined
  const values = merged.values && merged.values.length > 0 ? merged.values : undefined
  return text || values ? { text, values } : undefined
}

/**
 * The distinct rendered labels present in `rows`, sorted — the natural argument for
 * `meta.filterOptions` when the option list is data-driven rather than a fixed enum.
 */
export function optionsFrom<TRow>(rows: TRow[], label: (row: TRow) => string): string[] {
  const seen = new Set<string>()
  for (const row of rows) {
    const value = label(row)
    if (value) seen.add(value)
  }
  return [...seen].sort((a, b) => a.localeCompare(b))
}

/** The accessible name for a filter cell: the column's own header when it is plain text. */
function columnLabel<TData extends RowData>(column: Column<TData, unknown>): string {
  const header = column.columnDef.header
  return typeof header === 'string' ? header : column.id
}

export function GridFilterRow<TData extends RowData>({ table }: { table: TanstackTable<TData> }) {
  return (
    <Table.Tr className="grid-filter-row">
      {table.getVisibleLeafColumns().map((column) => {
        // Display columns have no accessor, so getCanFilter() already excludes them — meta.noFilter
        // is for the accessor-backed columns that nonetheless render buttons.
        if (!column.getCanFilter() || column.columnDef.meta?.noFilter) {
          return <Table.Th key={column.id} />
        }

        const label = columnLabel(column)
        const options = column.columnDef.meta?.filterOptions
        const current = column.getFilterValue() as GridFilterValue | undefined

        if (options) {
          // The dropdown is the funnel restricted to ONE value, and it writes the same `values`
          // channel — so a pick here shows as a tick there, and a multi-tick there leaves this
          // blank rather than lying about which single value is in force.
          const picked = current?.values?.length === 1 ? current.values[0] : null
          return (
            <Table.Th key={column.id}>
              <Select
                size="xs"
                data={options}
                value={picked}
                onChange={(v) =>
                  column.setFilterValue((old: GridFilterValue | undefined) =>
                    nextFilterValue(old, { values: v ? [v] : undefined }),
                  )
                }
                clearable
                aria-label={label}
                title={label}
                comboboxProps={{ withinPortal: true }}
              />
            </Table.Th>
          )
        }

        const text = current?.text ?? ''
        return (
          <Table.Th key={column.id}>
            <TextInput
              size="xs"
              value={text}
              onChange={(e) => {
                const next = e.currentTarget.value
                column.setFilterValue((old: GridFilterValue | undefined) =>
                  nextFilterValue(old, { text: next || undefined }),
                )
              }}
              aria-label={label}
              title={label}
              rightSection={
                text ? (
                  <CloseButton
                    size="xs"
                    aria-label={label}
                    onClick={() =>
                      column.setFilterValue((old: GridFilterValue | undefined) =>
                        nextFilterValue(old, { text: undefined }),
                      )
                    }
                  />
                ) : null
              }
            />
          </Table.Th>
        )
      })}
    </Table.Tr>
  )
}
