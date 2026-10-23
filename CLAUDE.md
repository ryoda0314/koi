@AGENTS.md

# ふたりごよみ

A calendar for a couple: each marks their own free time per day (all / day / night / no), the days both are free come
out in blue, one proposes a day, the other sets it, and the two decide what to do that day (their shared wishes, or three
ideas from GPT-5.2). The look is ことのは's (`../english`): warm paper, navy ink, one accent; no gradients, emoji or
shadows inside the app (the icon is the one picture with gradients); hairlines separate; IBM Plex (Sans, JP, KR for
Hangul names), the wordmark in Shippori Mincho; phone first, from 720 px the tabs become a column on the left.

## Stack

- Next.js 16 (App Router, Turbopack), React 19, CSS modules; `npm run dev` on port 3230. A second dev server (tests)
  runs with `NEXT_DIST_DIR=.next-test` on another port, since `next dev` locks its dist dir.
- Supabase, everything prefixed `koyomi_` (`supabase/migrations/`): a space per couple; devices sign in anonymously
  and join through the invite link (`/join#<token>`, the token after "#" never reaches a server). The data are small
  JSON documents at fixed paths in `koyomi_docs` (`app/members`, `avail/{date}`, `plans/{id}`, `plans/{id}/steps/{id}`,
  `wishes/{id}`), read under RLS and written only through `koyomi_write()` (set / update / merge = deep merge / delete;
  deletes are soft, a plan's steps go with it).
- `src/lib/client/space.ts`: the live copy in the browser (Realtime postgres_changes on the private channel
  `koyomi:{space}`, read everything only once the "Subscribed to PostgreSQL" notice arrives, newest read wins, writes
  shown at once). Presence carries only which of the two this device is (Realtime allows 5 presence changes per 30 s).
- `src/app/api/ai/route.ts`: GPT-5.2 (Responses API, strict JSON schema, `store: false`), with the caller's own
  Supabase token: RLS decides what it may read, `koyomi_ai_turn()` counts the daily limit. Prompts are built on the
  server from stored data (`src/lib/ai/prompts.ts`); the browser picks a task and a few options only.

## The core (pure, tested in `tests/`)

`src/lib/dates.ts`, `avail.ts` (overlap of two marks), `model.ts` (documents → members, plans with steps, wishes; free
days; days waiting on me), `ai/prompts.ts`. Imports between them use `.ts` extensions (Node strips types for tests).

## Conventions

- UI copy in `src/lib/i18n/ja.ts`, plain, from the couple's side. Colors: the accent marks the days both are free
  (and active toggles); the partner's own marks are violet (`--partner`).
- `next/image` icons are `unoptimized` (small fixed PNGs; the optimizer hung in dev here).
- `.env` holds the keys; the service_role key is never used by the app and never goes to Vercel or a NEXT_PUBLIC_ name.
- Commands: `npm test`, `npm run lint`, `npx tsc --noEmit` (`npx next typegen` after adding routes), `npm run build`,
  `npm run db:start` / `db:reset` (local Supabase on ports 573xx).
