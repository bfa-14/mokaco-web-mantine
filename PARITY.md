# PARITY — the dual-maintenance rule (decision D5)

While BOTH frontends exist, no change lands in one without being reflected in the other.

## How it is enforced

- **Old app → this app:** COVERAGE.md carries a drift watermark (`mtimeMs`). Every conversion
  session starts by listing `D:\VSProjects\mokaco-web` over the desktop bridge; any source file
  newer than the watermark changed since the last sync → re-stage it, re-apply the change to the
  ported equivalent, then advance the watermark. (Last check: 2026-08-12 at full-port delivery —
  no drift.)
- **This app → old app:** anything born here (a fix found while porting, a new feature) gets a row
  in the log below, written as a paste-ready prompt for the old app — the same style as the fix
  pack — and is not marked done until the old app has it.

## Mirror-back log (new app → old app)

| # | Date | Change born here | Prompt for the old app | Status |
|---|---|---|---|---|
| 1 | 2026-08-12 | Accessibility: icon-only buttons got `aria-label`s during the port (e.g. TipDistributionBody row-remove, several ActionIcon swaps) — the DX originals had none | "Add aria-label to icon-only Buttons: TipDistributionBody remove-row (`common.remove` w/ defaultValue 'Remove') and audit other icon-only dx Buttons for missing accessible names." | OPEN (low) |

## Known temporary divergences (not parity debts — framework mechanics)

- ~~Language switch: wire the Settings language section through useDirection()~~ **CLOSED** —
  LanguageSection now calls `setDirection(LANGUAGE_DIRECTION[lang])` in the same handler as
  `setLanguage`, so Mantine's direction context flips in the same frame as `document.dir`.
- DX DataGrid per-column filter rows → one global search box per grid (TanStack global filter).
  Same rows findable, different affordance. Deliberate, uniform, documented in COVERAGE.md —
  NOT to be mirrored back.
- Dashboard charts are stat blocks + CSS bars here (no chart lib by design). NOT mirrored back.
