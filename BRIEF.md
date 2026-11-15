# CampusFix implementation brief

## Product

A maintenance helpdesk for a fictional university. The demo must show a real persisted app, not a static mockup.

User flows:
- Create a ticket with title, description, category and priority.
- Search tickets; combine status, priority and category filters.
- Open a ticket detail panel, assign a technician, change its status and add a comment.
- See total/open/in-progress/resolved counts update after changes.
- Reload and restart the server without losing tickets/comments.
- Seed 24 fictional issues spanning categories/priorities/statuses without duplicating them on repeated seeding.

Use Node >=22.13, ES modules, built-in node:http and node:sqlite; browser-native HTML/CSS/JS;
node:test and assert for tests. Avoid application dependencies. A modest complete app is the goal:
no authentication, file uploads, external APIs, deployment or additional product scope.

## Shared contracts (Tiam lead establishes these before workers start)

Tiam owns root package/config files and shared/contract.js plus API.md. Publish the contracts through
Catalyst, then commit/push the scaffold before Namit starts editing.

Agree at least:
- ticket fields: id, title, description, category, priority, status, assignedTo, createdAt, updatedAt;
- categories: network, equipment, facilities; priorities: low, medium, high;
- statuses: open, in_progress, resolved;
- comment fields: id, ticketId, body, createdAt;
- routes: GET/POST /api/tickets, GET/PATCH /api/tickets/:id,
  POST /api/tickets/:id/comments, GET /api/summary, GET /health;
- JSON response shapes, validation/error shapes, sorting and filter/query semantics;
- store function signatures, app factory exports, and DOM IDs/events used by the UI;
- DB_PATH and PORT environment variables (default local data directory and localhost port 4318);
- server/app factory usable with a temporary DB and ephemeral port in automated tests.

Leave no incompatible private assumptions. Namit must ask Tiam through Catalyst whether search matches
title only or title plus description, and whether multiple filters combine with AND or OR.
Agree and publish that actual decision before implementing search behavior/tests.
This deliberately exercises cross-laptop clarification; do not claim it was an unprompted discovery.

## Initial shared queue

Tiam lead posts these once. Use participant-name assignees, exclusive paths and the exact dependencies.
Workers may pick eligible tasks belonging to their participant; leads handle Git (see CLAUDE.md).

| ID | Assignee | Exclusive implementation/test paths | Dependencies |
|---|---|---|---|
| store | Tiam | server/store.js, test/store.test.js | none |
| validation | Tiam | server/validation.js, test/validation.test.js | none |
| api | Tiam | server/api.js, server/main.js, test/api.test.js | store, validation |
| seed | Tiam | scripts/seed.js, test/seed.test.js | store |
| layout | Namit | public/index.html, public/styles.css | none |
| client | Namit | public/api.js, test/client.test.js | none |
| interactions | Namit | public/app.js, public/view-model.js, test/view-model.test.js | layout, client |
| acceptance | Namit | test/acceptance.test.js | api, seed, interactions |

The first four ready tasks make genuine parallel work possible on both Macs.
If integration needs a change outside a worker's paths, agree ownership through Catalyst first.
Do not permit an unclaimed fifth worker or both leads to change the same root file.

## Acceptance

Tests must assert actual behavior; no skipped/TODO tests, empty suites, fabricated evidence or swallowed errors.
Use temporary databases and clean up only owned test resources. Test:
- valid creation and validation failures, including whitespace-only title and unsupported enum values;
- lookup/update/comment behavior and missing IDs;
- agreed search/filter combination and deterministic ordering;
- summary correctness after status changes;
- persistence by reopening the database;
- repeated seeding is idempotent;
- frontend request/response/error handling and pure view-model transformations;
- API-to-store integration and successful static asset serving;
- final end-to-end HTTP sequence: create -> find -> assign -> change status -> comment -> reload/query -> counts.

Use npm test, npm run seed and npm start. Tiam's scaffold creates these scripts without implementing
the application features. Acceptance starts a real app with a temporary DB; do not depend on someone's
already-running development server.

Visual target: a tidy responsive dashboard with summary cards, filters, ticket list, create form and
detail/comments panel; clear priority/status badges, keyboard focus and readable error/empty/loading states.
Use system fonts and CSS shapes/text instead of downloading assets.

## Final interactive check (both Macs)

1. Run npm run seed and npm start; open http://localhost:4318.
2. Create "Projector broken in Lab 204".
3. Find it using search and filters.
4. Assign it, change its status and add a comment.
5. Verify summary changes; reload, then restart the server and verify persistence.
6. Compare the final Git commit and passing test results on both machines.

A running web page alone is not a pass. Save actual test output and the source commit.
The databases on the two Macs are independent; the application is not a real-time multiuser service.
