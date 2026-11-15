// CampusFix shared contract. Owner: Tiam (root-config / shared-contract owner).
// Server and browser code both import this file, so it must stay free of Node-only APIs.
// Behavioural rules live in API.md; this module holds the constants and the shapes.
// Changes to this file go through Tiam and a Catalyst decision, never a private edit.

// ---- Enumerations --------------------------------------------------------------------------

export const CATEGORIES = Object.freeze(['network', 'equipment', 'facilities']);
export const PRIORITIES = Object.freeze(['low', 'medium', 'high']);
export const STATUSES = Object.freeze(['open', 'in_progress', 'resolved']);

// Suggested technicians for the UI assignee picker. The API accepts any trimmed, non-empty
// string up to LIMITS.assignedTo characters (or null to unassign); this list is a convenience only.
export const TECHNICIANS = Object.freeze([
  'Avery Chen',
  'Jordan Okafor',
  'Priya Raman',
  'Mateo Alvarez',
  'Sam Whitlock',
]);

// ---- Field names ---------------------------------------------------------------------------

export const TICKET_FIELDS = Object.freeze([
  'id',
  'title',
  'description',
  'category',
  'priority',
  'status',
  'assignedTo',
  'createdAt',
  'updatedAt',
]);

export const COMMENT_FIELDS = Object.freeze(['id', 'ticketId', 'body', 'createdAt']);

// Summary response keys (GET /api/summary).
export const SUMMARY_FIELDS = Object.freeze(['total', 'open', 'in_progress', 'resolved']);

// ---- Limits (applied after trimming) -------------------------------------------------------

export const LIMITS = Object.freeze({
  title: 120,
  description: 2000,
  assignedTo: 80,
  commentBody: 1000,
  searchQuery: 200,
});

// ---- Runtime configuration -----------------------------------------------------------------

export const DEFAULT_PORT = 4318;
export const DEFAULT_HOST = '127.0.0.1';
// Relative to the process working directory (the repo root for npm scripts).
// The store creates the parent directory. ':memory:' is also accepted.
export const DEFAULT_DB_PATH = 'data/campusfix.db';
export const ENV = Object.freeze({ port: 'PORT', dbPath: 'DB_PATH' });

// ---- HTTP surface --------------------------------------------------------------------------

export const ROUTES = Object.freeze({
  health: '/health',
  tickets: '/api/tickets',
  ticket: '/api/tickets/:id',
  comments: '/api/tickets/:id/comments',
  summary: '/api/summary',
  exportTicketsCsv: '/api/export/tickets.csv',
});

export const ERROR_CODES = Object.freeze({
  validation: 'validation_error', // 400, includes `fields`
  invalidJson: 'invalid_json', // 400
  notFound: 'not_found', // 404 (unknown route, unknown/malformed id, static miss)
  methodNotAllowed: 'method_not_allowed', // 405
  internal: 'internal_error', // 500
});

// ---- Browser contract (Namit's modules use these; DOM ids are fixed so tests/UI agree) -------

export const DOM_IDS = Object.freeze({
  // summary cards
  summaryTotal: 'summary-total',
  summaryOpen: 'summary-open',
  summaryInProgress: 'summary-in-progress',
  summaryResolved: 'summary-resolved',
  // filters
  searchInput: 'search-input',
  filterStatus: 'filter-status',
  filterPriority: 'filter-priority',
  filterCategory: 'filter-category',
  clearFilters: 'clear-filters',
  exportTickets: 'export-tickets', // <a download> to the CSV export for the current filters
  // list
  ticketList: 'ticket-list',
  ticketCount: 'ticket-count',
  listState: 'list-state', // loading / empty / error message region (aria-live)
  // create form
  createForm: 'create-form',
  createTitle: 'create-title',
  createDescription: 'create-description',
  createCategory: 'create-category',
  createPriority: 'create-priority',
  createError: 'create-error',
  // detail panel
  detailPanel: 'detail-panel',
  detailTitle: 'detail-title',
  detailDescription: 'detail-description',
  detailStatus: 'detail-status', // <select> of STATUSES
  detailAssignee: 'detail-assignee', // <select> of TECHNICIANS plus an unassigned option
  detailError: 'detail-error',
  commentList: 'comment-list',
  commentForm: 'comment-form',
  commentBody: 'comment-body',
  commentError: 'comment-error',
});

// Custom DOM event dispatched on `document` by public/app.js after any successful mutation.
export const EVENTS = Object.freeze({ ticketsChanged: 'campusfix:tickets-changed' });

// ---- Module signatures (documentation as data; implementations live in the owning tasks) ----
// Kept as plain strings so there is nothing to keep in sync at runtime; API.md is the prose version.

export const MODULES = Object.freeze({
  'server/store.js':
    'export function openStore(dbPath: string = DEFAULT_DB_PATH): Store  // see API.md "Store"',
  'server/validation.js':
    'export validateCreateTicket(body), validatePatchTicket(body), validateComment(body), validateListQuery(query)  // each returns {ok:true,value}|{ok:false,fields}',
  'server/api.js':
    'export function createApiHandler(store): (req, res) => Promise<boolean>  // true when it handled /health or /api/*',
  'server/main.js':
    'export function createApp(options?): App  // see API.md "App factory"; running the file starts the server',
  'scripts/seed.js':
    'export const SEED_TICKETS; export function seed(store): {inserted, skipped}; running the file seeds DB_PATH',
  'public/api.js':
    'export function createClient({ baseUrl = "", fetchImpl = fetch } = {}): Client; export class ApiError',
});
