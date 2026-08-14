import { Component, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { flexRender } from '@tanstack/react-table'
import type { Column, Header, RowData, Table as TanstackTable } from '@tanstack/react-table'
import { ActionIcon, Button, Checkbox, Divider, Group, Popover, Stack, TextInput } from '@mantine/core'
import { IconArrowDown, IconArrowUp, IconFilter, IconFilterFilled, IconSearch } from '@tabler/icons-react'
import { BLANKS, displayText, nextFilterValue } from './GridFilterRow'
import type { GridFilterValue } from './GridFilterRow'

/**
 * The DevExtreme `<HeaderFilter visible />` — the funnel in a column header that opens a popup of
 * "Select All" plus one checkbox per distinct value, with OK and Cancel.
 *
 * It shares the column's filter value with the filter row (see {@link GridFilterValue}): the
 * funnel owns `values`, the row owns `text`, and both are tested against the SAME display string,
 * so the list a user ticks from is exactly the set the box would match against.
 *
 * Above 10 distinct values the popup grows a search box. DX called this `allowSearch` and the
 * original did not switch it on — but a 400-name Employee column is unusable without it, and an
 * unusable control is not parity with anything.
 */

/** '(Blanks)' leads; everything else sorts naturally, so "Step 2" precedes "Step 10". */
function compareValues(a: string, b: string): number {
  if (a === b) return 0
  if (a === BLANKS) return -1
  if (b === BLANKS) return 1
  return a.localeCompare(b, undefined, { numeric: true })
}

/** Above this many distinct values the popup offers a search box over the list. */
const SEARCH_THRESHOLD = 10

export function GridHeaderFilter<TData extends RowData>({
  column,
  table,
}: {
  column: Column<TData, unknown>
  table: TanstackTable<TData>
}) {
  const [opened, setOpened] = useState(false)
  /** The popup edits a DRAFT and applies nothing until OK — the DX behaviour, and the reason
   *  ticking six boxes does not re-filter the grid six times. */
  const [draft, setDraft] = useState<string[]>([])
  const [search, setSearch] = useState('')

  const current = column.getFilterValue() as GridFilterValue | undefined
  const selected = current?.values

  const coreRows = table.getCoreRowModel().rows

  /**
   * Every distinct value in the WHOLE dataset, not in the rows currently surviving the filters.
   * DX did the same, and it is what keeps the list from shrinking under the user's cursor as they
   * tick. Memoised because Daily attendance and the roster carry thousands of rows.
   */
  const items = useMemo(() => {
    const seen = new Set<string>()
    for (const row of coreRows) seen.add(displayText(row, column))
    return [...seen].sort(compareValues)
  }, [coreRows, column])

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return items
    return items.filter((item) => item.toLowerCase().includes(needle))
  }, [items, search])

  const active = Array.isArray(selected) && selected.length > 0

  function open() {
    // Seeded from what is in force, INTERSECTED with what still exists — a reload that drops a
    // value must not leave a phantom tick nobody can see or clear. No filter means everything is
    // selected, which is what makes "Select All" read as ticked on a fresh funnel.
    setDraft(selected ? items.filter((item) => selected.includes(item)) : items)
    setSearch('')
    setOpened(true)
  }

  function apply() {
    // ALL ticked and NONE ticked both mean "this column is not filtering". Storing undefined for
    // the empty case is what stops an accidental clear-everything-then-OK blanking the grid.
    const isNoOp = draft.length === items.length || draft.length === 0
    column.setFilterValue((old: GridFilterValue | undefined) =>
      nextFilterValue(old, { values: isNoOp ? undefined : draft }),
    )
    setOpened(false)
  }

  /** Cancel, Escape and click-outside are the same act: close, and let the next open re-seed. */
  function cancel() {
    setOpened(false)
  }

  const allSelected = items.length > 0 && draft.length === items.length
  const someSelected = draft.length > 0 && !allSelected

  const label = typeof column.columnDef.header === 'string' ? column.columnDef.header : column.id

  return (
    <Popover
      opened={opened}
      onChange={(next) => {
        if (!next) cancel()
      }}
      position="bottom-end"
      withArrow
      shadow="md"
      trapFocus
      width={240}
    >
      <Popover.Target>
        <ActionIcon
          variant="subtle"
          size="xs"
          color={active ? 'desert' : 'gray'}
          aria-label={`Filter ${label}`}
          title={`Filter ${label}`}
          onClick={(event) => {
            // The whole header cell toggles the sort; the funnel must not.
            event.stopPropagation()
            if (opened) cancel()
            else open()
          }}
        >
          {active ? <IconFilterFilled size={13} /> : <IconFilter size={13} />}
        </ActionIcon>
      </Popover.Target>

      <Popover.Dropdown p="xs" onClick={(event) => event.stopPropagation()}>
        <Stack gap="xs">
          {/* Select All is PURE STATE — `allSelected`/`someSelected` are derived above and
              Mantine takes `indeterminate` as a prop, so there is no ref and nothing to read off
              the DOM. `checked` is still captured on its own line: see the per-value boxes below
              for why every handler in this file reads the event first and only then updates. */}
          <Checkbox
            size="xs"
            label="Select All"
            checked={allSelected}
            indeterminate={someSelected}
            onChange={(event) => {
              const checked = event.currentTarget.checked
              setDraft(checked ? items : [])
            }}
          />

          <Divider />

          {items.length > SEARCH_THRESHOLD && (
            <TextInput
              size="xs"
              value={search}
              onChange={(event) => {
                const value = event.currentTarget.value
                setSearch(value)
              }}
              leftSection={<IconSearch size={12} />}
              aria-label={`Search ${label} values`}
            />
          )}

          <div className="grid-header-filter-list">
            <Stack gap={4}>
              {visible.map((item) => (
                <Checkbox
                  key={item}
                  size="xs"
                  label={item}
                  checked={draft.includes(item)}
                  // THE crash this file shipped with. A functional updater does not run inside the
                  // handler — React invokes it later, while re-rendering this component — and by
                  // then React has set `event.currentTarget` back to null, so reading `.checked`
                  // in there threw on the first tick and took the whole page with it. Read the
                  // event SYNCHRONOUSLY, on the first line; the updater closes over a plain
                  // boolean. The updater form itself is correct and stays: it is what makes a fast
                  // second tick queue on top of the first instead of overwriting it.
                  onChange={(event) => {
                    const checked = event.currentTarget.checked
                    setDraft((prev) =>
                      checked ? [...prev, item] : prev.filter((value) => value !== item),
                    )
                  }}
                />
              ))}
            </Stack>
          </div>

          <Group justify="flex-end" gap="xs">
            <Button size="compact-xs" variant="default" onClick={cancel}>
              Cancel
            </Button>
            <Button size="compact-xs" variant="filled" onClick={apply}>
              OK
            </Button>
          </Group>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  )
}

/**
 * Containment for the funnel: a crash in it must cost that ONE column its filter, never the page.
 *
 * The funnel renders inside every header cell of every grid, so an exception thrown anywhere in it
 * unmounts the whole route — which is exactly what the `currentTarget` bug above did: one tick and
 * /hr/employees went white. A boundary makes that failure mode structurally impossible, so the next
 * mistake in here is a dead funnel on one column instead of a blank application.
 *
 * WHY IT WRAPS `<GridHeaderFilter>` RATHER THAN THE POPOVER'S CONTENT. React invokes a queued state
 * updater while re-rendering the component that owns the state — the crash's own stack said so, its
 * second frame being GridHeaderFilter's `useState` line, not the dropdown. That throw happens in
 * GridHeaderFilter's render, so no boundary INSIDE the tree it returns can see it; the boundary has
 * to be its parent. Sitting here it also covers the dropdown, which is the narrower placement
 * anyway.
 *
 * Deliberately minimal: no reset, no reporting. A failed funnel stays failed until the grid
 * remounts, which is the honest state — whatever broke will break again on the next render.
 */
class FilterBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      // The funnel's own shape, greyed and inert — the column reads as "filter not available here"
      // rather than as a column that forgot to draw one.
      return (
        <ActionIcon
          variant="subtle"
          size="xs"
          color="gray"
          disabled
          title="Filter unavailable"
          aria-label="Filter unavailable"
        >
          <IconFilter size={13} />
        </ActionIcon>
      )
    }
    return <>{this.props.children}</>
  }
}

/**
 * A grid header cell's contents: the caption, its sort arrow, and the funnel pushed to the
 * trailing edge.
 *
 * Shared rather than repeated because all thirty-odd grids drew the caption and arrows with the
 * same four lines, and the funnel has to sit in the same place in every one of them — a column
 * whose header is laid out differently reads as a different kind of column.
 */
export function GridHeaderContent<TData extends RowData>({
  header,
  table,
}: {
  header: Header<TData, unknown>
  table: TanstackTable<TData>
}) {
  const meta = header.column.columnDef.meta
  const showFunnel =
    header.column.getCanFilter() && !meta?.noFilter && !meta?.noHeaderFilter

  return (
    <span className="grid-header-cell">
      <span className="grid-header-caption">
        {flexRender(header.column.columnDef.header, header.getContext())}
        {header.column.getIsSorted() === 'asc' && <IconArrowUp size={13} />}
        {header.column.getIsSorted() === 'desc' && <IconArrowDown size={13} />}
      </span>
      {showFunnel && (
        <FilterBoundary>
          <GridHeaderFilter column={header.column} table={table} />
        </FilterBoundary>
      )}
    </span>
  )
}
