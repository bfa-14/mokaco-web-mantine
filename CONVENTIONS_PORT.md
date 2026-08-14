# PORTING CONVENTIONS — DevExtreme → Mantine (read this fully before porting anything)

SOURCE app (DevExtreme, read-only): /home/claude/fe/src
TARGET app (Mantine, write here):   /home/claude/conv/mokaco-web-mantine/src

## The job

Re-create each assigned source page in the target with THE SAME shape and behavior, swapping only
the DevExtreme widgets for Mantine/TanStack equivalents. This is a PORT, not a redesign:

- Preserve ALL logic, state, effects, derived values, comments, i18n keys (`t('...')`), CSS
  class names, hints, warnings, empty states, and API calls EXACTLY. Copy them through.
- Services (`../../services/*`), types (`../../types/*`), i18n helpers, `workflowFormat`,
  `attendanceFormat`, `reportShared` etc. already exist in the target verbatim — import them with
  the same paths as the source file does.
- The target's global CSS (index.css + per-area .css files) is already in place — keep using the
  same classNames (`page-head`, `card`, `form-field`, `form-label`, `hint`, `alert alert--error`,
  `form-grid`, `form-actions`, `page-loading`, `empty-hint`, `metric`, `tab-toolbar`, area-specific
  `wf-*`/`att-*` classes...).
- Do NOT add dependencies. package.json already has: @mantine/core, @mantine/hooks,
  @mantine/notifications, @tabler/icons-react, @tanstack/react-table, react-hook-form, xlsx,
  i18next, react-i18next, react-router-dom, @microsoft/signalr.
- Do NOT run npm / tsc / vite. Just write complete, syntactically valid .tsx files.

## Reference implementations in the target — imitate these patterns

- Grid page:            src/pages/workflow/RequestsGrid.tsx  (TanStack Table + Mantine Table:
                        columns via createColumnHelper, sorting, global search TextInput,
                        Pagination + page-size Select, row class, row click)
- Full page w/ filters: src/pages/workflow/RequestsHubPage.tsx
- Modal dialog:         src/pages/workflow/DecidePopup.tsx  (Modal, Select, NumberInput,
                        PasswordInput, notifications)
- Form body:            src/pages/workflow/LeaveRequestBody.tsx
- Simple form + RHF:    src/pages/LoginPage.tsx

## Substitution table

| DevExtreme | Mantine replacement |
|---|---|
| `Button` | `Button` (`variant="filled"` default action, `"default"` outlined, `"subtle"` text; `leftSection={<IconX size={16}/>}` for icons; text goes in children) |
| `Button` icon-only | `ActionIcon` with a Tabler icon |
| `TextBox` | `TextInput` (label prop instead of separate <label> where convenient — keep the original label TEXT and classes when the source used `form-label`) |
| `TextBox mode="password"` | `PasswordInput` |
| `TextArea` | `Textarea` (`minRows={2..3}` for height 64-80) |
| `NumberBox` | `NumberInput` — `onChange={(v) => set(typeof v === 'number' ? v : null)}`; `decimalScale={2}` replaces `format="#0.00"`; keep min/max/step; `readOnly` supported |
| `SelectBox` | `Select` — data is `{value: string, label: string}[]`; NUMERIC ids cross via `String(id)` / `Number(v)`; `searchable` for searchEnabled; `clearable` for showClearButton; `nothingFoundMessage` for noDataText; grouped data = `[{group, items}]` |
| `SelectBox acceptCustomValue` | `Autocomplete` (string value) |
| `TagBox` | `MultiSelect` (string values, map ids with String/Number) |
| `CheckBox` | `Checkbox` (`checked`, `onChange={(e) => e.currentTarget.checked}`, `label`) |
| `Switch` | `Switch` (`checked`, `onChange` currentTarget.checked; `onLabel`/`offLabel` for switchedOn/OffText) |
| `DateBox type="date"` | `<TextInput type="date">` — state holds `'yyyy-MM-dd'` strings directly; keep min/max props |
| `DateBox type="time"` | `<TextInput type="time">` — state holds `'HH:mm'`; append `:00` where the API wants seconds |
| `DateBox displayFormat="yyyy-MM"` (month picker) | `<TextInput type="month">` — state `'yyyy-MM'` |
| `Popup` | `Modal` (`opened`, `onClose`, `title`, `size={<maxWidth>}`, `centered`) |
| `LoadIndicator` / `LoadPanel` | `Loader` (inside the same wrapper divs) |
| `notify(msg, type, ms)` | `notifications.show({ message, color: 'green'|'orange'|'red', autoClose: ms })` from '@mantine/notifications' |
| `DataGrid` | TanStack Table + `Table` from Mantine, per RequestsGrid.tsx. Reproduce the SOURCE grid's features only: its columns (incl. cellRender content), sorting, paging (Pagination + Select page size), SearchPanel → global-filter TextInput, onRowClick, onRowPrepared row classes. Column chooser/grouping/fixed columns: omit with a `/* PORT NOTE: ... */` comment |
| `DataGrid` Export / exportEnabled | a Button that builds a worksheet with `xlsx` (`utils.json_to_sheet` on the visible rows → `writeFile`) |
| `FileUploader` | `FileInput` from @mantine/core (or native `<input type="file">` if multiple/drag needed) |
| `TabPanel` / tab buttons | `Tabs` from @mantine/core, or the source's own button-tab pattern with Mantine Buttons (RequestsHubPage tabButton style) — match whichever the source used |
| dx Chart/PieChart (Dashboard only) | NO chart lib. Recreate as simple stat blocks + CSS bar lists using existing classes; add `/* PORT NOTE: chart simplified */` |
| `dx-icon dx-icon-X` `<i>` elements | Tabler icon components (see the ICONS map in src/layout/SideNav.tsx for name mapping) |
| `Validator`/`RequiredRule` | drop them; the page's own `missing`/guard logic (ported verbatim) is the gate. For standalone simple forms you may use react-hook-form like LoginPage |

## Hard rules

1. One output file per source file, same relative path/name under the target.
2. The file must be COMPLETE and self-consistent TypeScript/TSX — no `...` elisions, no TODO holes.
3. Type-correctness matters: NumberInput onChange gives `number | string`; Select gives
   `string | null`; date inputs give strings. Convert explicitly. Avoid `any`.
4. Keep the source's exported names EXACTLY (default vs named) so App.tsx imports keep working.
5. If a piece has no reasonable Mantine equivalent, approximate the UX and leave a one-line
   `/* PORT NOTE: ... */` explaining the delta. Never silently drop functionality.
6. When done, reply ONLY with: the list of files written, plus at most 8 short lines of PORT NOTES.
