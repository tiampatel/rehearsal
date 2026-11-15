// CampusFix view-model: pure, DOM-free transformations used by public/app.js.
// Search/filter semantics are decided by the server (API.md); this module only
// forwards non-empty values.

export const STATUS_LABELS = Object.freeze({
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
});
export const PRIORITY_LABELS = Object.freeze({ low: 'Low', medium: 'Medium', high: 'High' });
export const CATEGORY_LABELS = Object.freeze({
  network: 'Network',
  equipment: 'Equipment',
  facilities: 'Facilities',
});

const label = (map, key) => (Object.hasOwn(map, key) ? map[key] : String(key ?? ''));
export const statusLabel = (s) => label(STATUS_LABELS, s);
export const priorityLabel = (p) => label(PRIORITY_LABELS, p);
export const categoryLabel = (c) => label(CATEGORY_LABELS, c);

/** Raw filter control values -> query filters with empty/blank values omitted. */
export function filtersToQuery(raw = {}) {
  const out = {};
  for (const key of ['q', 'status', 'priority', 'category']) {
    const v = raw?.[key];
    if (v === undefined || v === null) continue;
    const t = String(v).trim();
    if (t !== '') out[key] = t;
  }
  return out;
}

export function hasActiveFilters(raw) {
  return Object.keys(filtersToQuery(raw)).length > 0;
}

/** Summary response -> card descriptors keyed by the summary DOM id order. */
export function summaryCards(summary) {
  const s = summary ?? {};
  const n = (v) => (Number.isFinite(v) ? v : 0);
  return [
    { key: 'total', label: 'Total', value: n(s.total), text: String(n(s.total)) },
    { key: 'open', label: 'Open', value: n(s.open), text: String(n(s.open)) },
    { key: 'in_progress', label: 'In progress', value: n(s.in_progress), text: String(n(s.in_progress)) },
    { key: 'resolved', label: 'Resolved', value: n(s.resolved), text: String(n(s.resolved)) },
  ];
}

/** Deterministic, timezone-independent date text: "2026-11-15 07:30 UTC". */
export function formatDate(iso) {
  if (typeof iso !== 'string') return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;
}

export function ticketCountText(n) {
  return n === 1 ? '1 ticket' : `${n} tickets`;
}

/** Ticket -> row/badge descriptor (class names match public/styles.css badge modifiers). */
export function ticketRow(ticket, selectedId = null) {
  return {
    id: ticket.id,
    title: ticket.title,
    category: ticket.category,
    categoryLabel: categoryLabel(ticket.category),
    priority: ticket.priority,
    priorityLabel: priorityLabel(ticket.priority),
    priorityClass: `badge badge--priority-${ticket.priority}`,
    status: ticket.status,
    statusLabel: statusLabel(ticket.status),
    statusClass: `badge badge--status-${ticket.status}`,
    assignee: ticket.assignedTo ?? null,
    assigneeText: ticket.assignedTo ? `Assigned to ${ticket.assignedTo}` : 'Unassigned',
    updatedText: formatDate(ticket.updatedAt),
    selected: selectedId !== null && ticket.id === selectedId,
    ariaLabel: `#${ticket.id} ${ticket.title}, ${priorityLabel(ticket.priority)} priority, ${statusLabel(ticket.status)}`,
  };
}

/** List region state: {kind:'loading'|'error'|'empty'|'ready', message}. */
export function listState({ loading = false, error = null, count = 0, filtersActive = false } = {}) {
  if (loading) return { kind: 'loading', message: 'Loading tickets...' };
  if (error) return { kind: 'error', message: errorMessage(error).message };
  if (count === 0) {
    return {
      kind: 'empty',
      message: filtersActive
        ? 'No tickets match the current search and filters.'
        : 'No tickets yet. Create the first one.',
    };
  }
  return { kind: 'ready', message: '' };
}

export function commentView(comment) {
  return { id: comment.id, body: comment.body, createdText: formatDate(comment.createdAt) };
}

export function commentListView(comments) {
  const list = Array.isArray(comments) ? comments : [];
  return {
    empty: list.length === 0,
    emptyText: 'No comments yet.',
    items: list.map(commentView),
  };
}

/** Ticket (+comments) -> detail panel data. */
export function detailView(ticket, comments = []) {
  const row = ticketRow(ticket);
  return {
    id: ticket.id,
    heading: `#${ticket.id} ${ticket.title}`,
    title: ticket.title,
    description: ticket.description,
    status: ticket.status,
    assignee: ticket.assignedTo ?? '',
    categoryLabel: row.categoryLabel,
    priorityLabel: row.priorityLabel,
    priorityClass: row.priorityClass,
    statusLabel: row.statusLabel,
    statusClass: row.statusClass,
    createdText: formatDate(ticket.createdAt),
    updatedText: formatDate(ticket.updatedAt),
    comments: commentListView(comments),
  };
}

/** Assignee select value -> PATCH value ('' means unassign). */
export function assigneeToPatch(value) {
  const t = String(value ?? '').trim();
  return t === '' ? null : t;
}

/** Any thrown value -> {message, fields, code}. Field messages come from the server. */
export function errorMessage(err) {
  if (err && typeof err === 'object' && 'code' in err) {
    const fields = err.fields && typeof err.fields === 'object' ? { ...err.fields } : {};
    const detail = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('; ');
    let message;
    if (err.code === 'network_error') {
      message = 'Cannot reach the server. Check your connection and try again.';
    } else if (err.code === 'validation_error') {
      message = detail ? `Please fix the following: ${detail}` : err.message || 'Validation failed.';
    } else if (err.code === 'not_found') {
      message = 'That item no longer exists.';
    } else {
      message = err.message || 'Something went wrong.';
    }
    return { message, fields, code: err.code };
  }
  return { message: (err && err.message) || 'Something went wrong.', fields: {}, code: 'unknown_error' };
}
