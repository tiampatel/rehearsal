# CampusFix API and module contract

Owner: Tiam. Constants live in `shared/contract.js`; this file is the behavioural contract.
Anything not stated here must be asked through Catalyst, not assumed.

## Data model

Ticket (all fields always present in responses):

| field | type | notes |
|---|---|---|
| id | integer | autoincrement, starts at 1 |
| title | string | trimmed, 1..120 chars |
| description | string | trimmed, 1..2000 chars |
| category | string | `network` \| `equipment` \| `facilities` |
| priority | string | `low` \| `medium` \| `high` |
| status | string | `open` \| `in_progress` \| `resolved`; new tickets are `open` |
| assignedTo | string \| null | trimmed, 1..80 chars, or `null` when unassigned |
| createdAt | string | ISO 8601 UTC, e.g. `2026-11-15T07:30:00.000Z` |
| updatedAt | string | ISO 8601 UTC; changes on PATCH and when a comment is added |

Comment: `id` (integer), `ticketId` (integer), `body` (string, trimmed, 1..1000), `createdAt` (ISO 8601 UTC).

## Configuration

- `PORT` (default `4318`), host `127.0.0.1`.
- `DB_PATH` (default `data/campusfix.db`, relative to the working directory; `:memory:` allowed).
  The store creates the parent directory. `data/` is git-ignored.

## Routes

All bodies and responses are JSON (`Content-Type: application/json; charset=utf-8`) unless noted.

### GET /health
`200 {"status":"ok"}`

### GET /api/tickets
Query parameters (all optional): `q`, `status`, `priority`, `category`.
`200 {"tickets":[Ticket,...],"total":<number>}` where `total` equals `tickets.length`.
An empty-string parameter means "not provided". An unsupported `status`/`priority`/`category`
value is a `400 validation_error` (see Errors) rather than an empty list. `q` is trimmed, at most 200 chars.

**Ordering (deterministic):** `updatedAt` descending, then `id` descending.

**Search scope (`q`)** (Catalyst decision `contract/search-filters`): `q` is trimmed; when non-empty a ticket
matches if the text is a case-insensitive substring of its `title` OR its `description`. LIKE wildcards
(`%`, `_`, `\`) in `q` are literal. A multi-word `q` is one substring, not tokenised.

**Filter combination** (same decision): `q`, `status`, `priority` and `category` are combined with **AND**.
Absent/empty parameters impose no constraint. `status`/`priority`/`category` each take one exact value.

### GET /api/export/tickets.csv
Downloads the tickets as CSV (Catalyst decision `feature/csv-export`). Accepts the same optional `q`, `status`,
`priority`, `category` parameters as `GET /api/tickets`, with identical semantics (AND-combined, `q` matches title OR
description), identical ordering (`updatedAt` descending, then `id` descending) and the same `400 validation_error`
for an unsupported filter value. Non-GET methods are `405 method_not_allowed` with `Allow: GET`.

`200` with `Content-Type: text/csv; charset=utf-8` and `Content-Disposition: attachment; filename="campusfix-tickets.csv"`.
Columns, in order: `id,title,category,priority,status,assignedTo`. The header row is always present (even for zero
tickets); an unassigned ticket has an empty `assignedTo`. RFC 4180 escaping: fields containing a comma, double quote,
CR or LF are quoted and embedded quotes are doubled. Lines end with CRLF, including the last record.
The serializer is `ticketsToCsv` in `server/csv.js`. The page's "Export CSV" link (`#export-tickets`) points at this
route with the currently active filters.

### POST /api/tickets
Body: `{"title","description","category","priority"}` (all required).
`201 {"ticket":Ticket}` with `status:"open"`, `assignedTo:null`, `createdAt == updatedAt`.
Unknown extra fields are ignored.

### GET /api/tickets/:id
`200 {"ticket":Ticket,"comments":[Comment,...]}`; comments ordered `createdAt` ascending, then `id` ascending.
Non-integer or unknown id: `404 not_found`.

### PATCH /api/tickets/:id
Body may contain any of `status`, `assignedTo`, `priority`; at least one is required.
`assignedTo` is a non-empty string or `null` (unassign). Other fields are ignored.
`200 {"ticket":Ticket}` with `updatedAt` refreshed. Unknown id: `404`. Empty/no recognised field: `400`.

### POST /api/tickets/:id/comments
Body: `{"body"}`. `201 {"comment":Comment}`. Also refreshes the ticket's `updatedAt`.
Unknown id: `404 not_found`. Invalid body: `400 validation_error`.

### GET /api/summary
`200 {"total":n,"open":n,"in_progress":n,"resolved":n}`; `total` is the sum of the other three.
Counts always reflect the whole table, never the current filters.

### Static files
`GET /` serves `public/index.html`. `GET /<file>` serves files under `public/` with the right
content type (`.html .css .js .json .svg .ico`). Path traversal and misses return `404 not_found`
(JSON error shape). Only GET/HEAD are served for static paths.

## Errors

Every error uses one shape: `{"error":{"code":string,"message":string,"fields"?:{<field>:<message>}}}`

| status | code | when |
|---|---|---|
| 400 | `validation_error` | invalid input; `fields` maps field name to a human message |
| 400 | `invalid_json` | body is not valid JSON or not a JSON object |
| 404 | `not_found` | unknown route, unknown/malformed id, static miss |
| 405 | `method_not_allowed` | known route with an unsupported method |
| 500 | `internal_error` | unexpected failure (message is generic, never a stack trace) |

Validation rules: strings are trimmed first; a whitespace-only `title`, `description` or comment `body`
is empty and invalid; enum fields must match exactly (lower case); wrong types are invalid, not coerced.

## Module contracts

### `server/validation.js` (task: validation)
Pure functions, no I/O. Each returns `{ok:true,value}` or `{ok:false,fields}` (never throws on bad input).
- `validateCreateTicket(body)` -> value `{title,description,category,priority}` (trimmed)
- `validatePatchTicket(body)` -> value containing only the recognised provided keys of `status`, `assignedTo`, `priority`
- `validateComment(body)` -> value `{body}` (trimmed)
- `validateListQuery(query)` where `query` is a plain object of strings (or a `URLSearchParams`) ->
  value `{q,status,priority,category}` with empty/absent members as `undefined`

### Store (`server/store.js`, task: store)
`openStore(dbPath = DEFAULT_DB_PATH)` opens/creates the SQLite file with `node:sqlite` (`DatabaseSync`),
creates tables if missing and returns a synchronous object:

| method | returns |
|---|---|
| `createTicket(input, extra?)` | Ticket. `input` = validated create value. `extra` may set `status`, `assignedTo`, `createdAt`, `updatedAt` (used by seeding; defaults: `open`, `null`, now) |
| `getTicket(id)` | Ticket or `null` |
| `listTickets(filters = {})` | `Ticket[]` ordered as above; `filters` = `{q,status,priority,category}` per the search/filter decision above (title OR description, AND-combined) |
| `updateTicket(id, patch)` | updated Ticket or `null` if the id does not exist; `patch` = validated patch value |
| `addComment(ticketId, {body})` | Comment, or `null` if the ticket does not exist; refreshes ticket `updatedAt` |
| `listComments(ticketId)` | `Comment[]` ordered as above (empty array for unknown id) |
| `getSummary()` | `{total,open,in_progress,resolved}` |
| `close()` | closes the database; idempotent |

Store methods use parameterised SQL only. Reopening the same file must return the same data.

### `server/api.js` (task: api)
`createApiHandler(store)` returns `async (req, res) => boolean`. It handles `/health` and `/api/*`
(JSON parsing, validation, store calls, error shape above) and returns `true` when it responded,
`false` for other paths (so `main.js` can fall through to static files).

### App factory (`server/main.js`, task: api)
`createApp({ dbPath = process.env.DB_PATH ?? DEFAULT_DB_PATH, publicDir = <repo>/public, host = '127.0.0.1' } = {})`
returns `{ store, server, start(port = 0) -> Promise<{port,url}>, stop() -> Promise<void> }`.
- `start(0)` binds an ephemeral port, so tests never collide; `url` is `http://127.0.0.1:<port>`.
- `stop()` closes the HTTP server and the store, and is idempotent.
- Running `node server/main.js` (the `npm start` script) calls `createApp()` and `start(Number(process.env.PORT) || 4318)`,
  logs the URL, and closes cleanly on SIGINT/SIGTERM. Importing the module must not start a server.

### Seeding (`scripts/seed.js`, task: seed)
`SEED_TICKETS` holds 24 fictional tickets with unique titles, covering all categories, priorities and statuses
(some assigned, a few with comments). `seed(store)` inserts those whose title is not already present and returns
`{inserted,skipped}`; running it twice inserts nothing the second time. `node scripts/seed.js` opens `DB_PATH`
(default location), seeds, prints the counts and closes the store. Importing the module must not seed.

### Browser client (`public/api.js`, task: client)
`createClient({ baseUrl = '', fetchImpl = fetch } = {})` returns
`{ listTickets(filters), getTicket(id), createTicket(input), updateTicket(id, patch), addComment(id, body), getSummary() }`.
Each returns the parsed success payload (as documented above) and rejects with `ApiError`
(`status`, `code`, `message`, `fields`) for error responses and for network failures (`status` 0, `code` `network_error`).

### Page wiring (`public/index.html`, `public/app.js`, `public/view-model.js`)
`index.html` loads `/styles.css` and `/app.js` (`type="module"`); `app.js` imports `/api.js` and `/view-model.js`
and the shared constants from `/shared/contract.js`. DOM ids are in `DOM_IDS`; the custom event after a mutation
is `EVENTS.ticketsChanged`.

Because `/shared/contract.js` is outside `public/`, the static server maps `GET /shared/*` to the repo's
`shared/` directory (and nothing else outside `public/`).
