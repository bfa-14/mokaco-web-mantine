# MokaCo HRMS — Mantine build (`mokaco-web-mantine`)

The replatform of `mokaco-web` off DevExtreme onto **Mantine 8 + TanStack Table 8 +
react-hook-form + SheetJS**, on the same Vite + React 19 + TypeScript base, against the SAME
backend. Session 1 delivered the scaffold, the full reference layer (auth, API client, i18n en/ar
with RTL, SignalR live, settings), the app chrome, and two reference pages: the **Requests hub**
(cards + TanStack grid) and **New request** (shell + leave form).

## Run it

```bash
npm install
npm run dev        # proxies /api and /hubs to https://localhost:44332 (same as the original)
npm run build      # tsc -b && vite build
```

Place this folder BESIDE the original (e.g. `D:\VSProjects\mokaco-web-mantine`) — never inside it.

## What to read first

- `COVERAGE.md` — route-by-route port status, the drift watermark, conversion conventions, and
  the suggested port order.
- `PARITY.md` — the dual-maintenance rule between the two frontends and the mirror-back log.

## Ground rules for continuing the port

1. One page (or one form body) per step; `tsc -b && vite build` must stay clean after each.
2. Framework-free code (services, types, i18n, auth, live) is COPIED from the original, never
   rewritten — the original stays the source of truth for it until retirement.
3. The original's CSS classes are carried verbatim; new chrome uses Mantine primitives + the
   brand theme in `src/theme.ts`.
4. DevExtreme → Mantine substitutions follow the conventions table in COVERAGE.md; RequestsGrid
   is the reference for grids, LoginPage for simple forms, LeaveRequestBody for request bodies.
5. Update COVERAGE.md (status + watermark) and PARITY.md every session — that is what keeps the
   two apps honest with each other.
