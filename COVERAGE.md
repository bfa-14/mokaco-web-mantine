# COVERAGE — Mantine port vs the original (DevExtreme) app

Baseline: staged live from `D:\VSProjects\mokaco-web` on 2026-08-11, AFTER fix prompts P1–P13.
**Drift watermark: `mtimeMs 1786479628221`** — re-verified at delivery of the full port
(2026-08-12 session): `device_list_dir` showed NO source file newer than the watermark, so the
complete port below is against the current source. Rule (parity D5): at the start of every
conversion session, re-list the original app; any file above the watermark → re-stage, re-sync,
advance the watermark. Changes born HERE are logged in PARITY.md.

## STATUS: PORT COMPLETE — all 28 routes, all 100+ source files

Every file under the original `src/pages` + `src/components` has a target counterpart (verified
by inventory diff: zero missing, zero extras). `NotYetPorted` is retired and deleted.

### How the final jumbo batch was built and verified

The last ~50 page files were ported by 13 parallel workers, each holding CONVENTIONS_PORT.md
(the substitution table + hard rules + reference implementations). Integration verification,
all green:

- `tsc -b --force` — zero errors under the ORIGINAL app's own compiler flags (tsconfig.app.json
  is byte-identical to the source project's).
- `vite build` — clean, 7162 modules, single 1.35 MB chunk (gzip 364 kB).
- Inventory diff source↔target — every source file has a counterpart; none under 60% of its
  source's line count (no silently-stubbed ports).
- Zero `devextreme` imports anywhere (remaining mentions are explanatory comments only).
- i18n audit — all 385 distinct `t()` keys used in the target resolve against en.json + ar.json
  (incl. `_one`/`_other` plural forms); the 2 that don't carry inline `defaultValue` fallbacks.
- Production-bundle render smoke (Playwright vs `vite preview`): /login renders the full branded
  form pixel-correct; a protected deep link redirects to `/login?next=…` exactly like the
  original; ZERO page errors / crash-class console errors while evaluating the entire bundle
  (all pages live in the one chunk, so any module-level break anywhere would have crashed it).
- Fixed during integration: `PageHelp` and `attendanceShared.AnomalyIcon` still carried literal
  `<i class="dx-icon …">` elements (would render empty without DX's icon font) → Tabler icons,
  same classNames; `LanguageSection` now also flips Mantine's `useDirection()` in the same frame
  as a language switch (closes the divergence noted in PARITY.md).

**Honest caveat:** the jumbo batch compiles, bundles, and passes the checks above, but its pages
have NOT been exercised against the real backend. First run should be a click-through of each
area (see PROGRESS.md "smoke route" list); expect the odd behavioral nit rather than crashes.

## Routes — 28/28 ported

| Route | Status |
|---|---|
| /login · /requests · /requests/new (11 bodies) · /requests/:id · /requests/oversight | ✅ |
| / (dashboard — DX charts → stat blocks + CSS bar lists, PORT NOTE inline) | ✅ |
| /workflow/chains · chains/:definitionId (builder) · old-versions · branch-managers · signatures | ✅ |
| /attendance (+ daily, roster, import, unresolved, anomalies, exit-variances, corrections, shifts, devices) | ✅ ×10 |
| /payroll/runs · runs/:id · payslips/:id · advances · adjustments | ✅ ×5 |
| /reports/monthly-attendance · daily-attendance · leave-balance | ✅ ×3 |
| /hr/employees (+ form popup, tabs) · org-chart · employees/:id · employee-accounts · branches · departments · positions · component-types · leave-types · leave-policy | ✅ ×10 |
| /core/currencies · /core/exchange-rates | ✅ ×2 |
| /security/users · roles · role-permissions (+ signature dialog, workflow behaviour) | ✅ ×3 |
| /profile · /settings (language section wires Mantine useDirection) | ✅ ×2 |

## Port-wide notes (aggregated from the workers' PORT NOTES)

- DX DataGrid per-column filter rows → ONE global search TextInput per grid (TanStack
  global-filter), matching the RequestsGrid reference. Column chooser / grouping / fixed
  columns omitted with inline `/* PORT NOTE */`s where the source used them.
- `devextreme/ui/dialog` `confirm()` → promise-backed Mantine Modal (pattern repeated in
  DevicesPage, LeaveTab, DocumentsTab, SalaryComponentsTab, EmployeeFormPopup…).
- DX Chart/PieChart (Dashboard only) → stat blocks + CSS bar lists, no chart lib.
- `DateBox type="datetime"` → native `<input type="datetime-local">`.
- Grid Excel export → SheetJS `json_to_sheet` on the visible rows.
- Icon-only DX buttons → `ActionIcon` + Tabler, with aria-labels added where the source had
  none (logged in PARITY.md as mirror-back candidates).

## Conversion conventions (unchanged — see CONVENTIONS_PORT.md for the full table)

- DX Button/SelectBox/TextBox/TextArea/DateBox → Mantine Button/Select/TextInput/Textarea/native `type="date|time|month|datetime-local"`
- DX DataGrid → TanStack Table + Mantine Table (RequestsGrid is the reference implementation)
- DX ButtonGroup → SegmentedControl · LoadIndicator → Loader · notify → @mantine/notifications
- DX Validator/ValidationGroup → the body-hook `missing` contract, or react-hook-form for
  simple standalone forms (LoginPage is the reference)
- dx-icons → Tabler icons via the string-keyed map in SideNav
- Select values are strings in Mantine — numeric ids cross via `String(id)` / `Number(v)`
- All original CSS classes/files carried verbatim; Mantine theme mirrors the brand tokens
  (`theme.ts` ↔ `index.css` `:root` variables)
