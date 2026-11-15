// Input validation for the CampusFix API. Pure functions, no I/O, never throw on bad input.
// Every function returns { ok: true, value } or { ok: false, fields } where `fields` maps a
// field name to a human-readable message. Behavioural rules live in API.md.

import { CATEGORIES, PRIORITIES, STATUSES, LIMITS } from '../shared/contract.js';

const NOT_OBJECT = 'must be a JSON object';

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function has(obj, key) {
  return Object.hasOwn(obj, key) && obj[key] !== undefined;
}

function oneOf(list) {
  return list.join(', ');
}

function fail(fields) {
  return { ok: false, fields };
}

function succeed(value) {
  return { ok: true, value };
}

// Validates a required, trimmed, non-empty string with a maximum length.
// Returns { value } or { error }.
function requiredText(obj, key, max) {
  if (!has(obj, key) || obj[key] === null) return { error: 'is required' };
  const raw = obj[key];
  if (typeof raw !== 'string') return { error: 'must be a string' };
  const value = raw.trim();
  if (value.length === 0) return { error: 'must not be empty' };
  if (value.length > max) return { error: `must be at most ${max} characters` };
  return { value };
}

// Validates a required enum member (exact, case-sensitive match, no trimming or coercion).
function requiredEnum(obj, key, allowed) {
  if (!has(obj, key) || obj[key] === null) return { error: 'is required' };
  const raw = obj[key];
  if (typeof raw !== 'string') return { error: 'must be a string' };
  if (!allowed.includes(raw)) return { error: `must be one of: ${oneOf(allowed)}` };
  return { value: raw };
}

export function validateCreateTicket(body) {
  if (!isPlainObject(body)) return fail({ body: NOT_OBJECT });
  const fields = {};
  const value = {};

  const checks = [
    ['title', requiredText(body, 'title', LIMITS.title)],
    ['description', requiredText(body, 'description', LIMITS.description)],
    ['category', requiredEnum(body, 'category', CATEGORIES)],
    ['priority', requiredEnum(body, 'priority', PRIORITIES)],
  ];
  for (const [key, result] of checks) {
    if (result.error) fields[key] = `${key} ${result.error}`;
    else value[key] = result.value;
  }

  return Object.keys(fields).length > 0 ? fail(fields) : succeed(value);
}

export function validatePatchTicket(body) {
  if (!isPlainObject(body)) return fail({ body: NOT_OBJECT });
  const fields = {};
  const value = {};
  let recognised = 0;

  if (has(body, 'status')) {
    recognised += 1;
    const result = requiredEnum(body, 'status', STATUSES);
    if (result.error) fields.status = `status ${result.error}`;
    else value.status = result.value;
  }

  if (has(body, 'priority')) {
    recognised += 1;
    const result = requiredEnum(body, 'priority', PRIORITIES);
    if (result.error) fields.priority = `priority ${result.error}`;
    else value.priority = result.value;
  }

  if (has(body, 'assignedTo')) {
    recognised += 1;
    if (body.assignedTo === null) {
      value.assignedTo = null;
    } else {
      const result = requiredText(body, 'assignedTo', LIMITS.assignedTo);
      if (result.error) fields.assignedTo = `assignedTo ${result.error} (or null to unassign)`;
      else value.assignedTo = result.value;
    }
  }

  if (recognised === 0) {
    return fail({ body: 'must include at least one of: status, assignedTo, priority' });
  }
  return Object.keys(fields).length > 0 ? fail(fields) : succeed(value);
}

export function validateComment(body) {
  if (!isPlainObject(body)) return fail({ body: NOT_OBJECT });
  const result = requiredText(body, 'body', LIMITS.commentBody);
  if (result.error) return fail({ body: `body ${result.error}` });
  return succeed({ body: result.value });
}

// Reads one raw query member from a URLSearchParams or a plain object.
// Returns { present: false } for absent, { value } for a string, or { error } for other types.
function readQueryMember(query, key) {
  if (query instanceof URLSearchParams) {
    const raw = query.get(key);
    return raw === null ? { present: false } : { value: raw };
  }
  if (!has(query, key)) return { present: false };
  const raw = query[key];
  if (raw === null) return { present: false };
  if (typeof raw !== 'string') return { error: `${key} must be a string` };
  return { value: raw };
}

export function validateListQuery(query) {
  if (query === undefined || query === null) {
    return succeed({ q: undefined, status: undefined, priority: undefined, category: undefined });
  }
  if (!(query instanceof URLSearchParams) && !isPlainObject(query)) {
    return fail({ query: 'must be an object of query parameters' });
  }

  const fields = {};
  const value = { q: undefined, status: undefined, priority: undefined, category: undefined };

  const q = readQueryMember(query, 'q');
  if (q.error) {
    fields.q = q.error;
  } else if (q.value !== undefined) {
    const trimmed = q.value.trim();
    if (trimmed.length > LIMITS.searchQuery) {
      fields.q = `q must be at most ${LIMITS.searchQuery} characters`;
    } else if (trimmed.length > 0) {
      value.q = trimmed;
    }
  }

  for (const [key, allowed] of [
    ['status', STATUSES],
    ['priority', PRIORITIES],
    ['category', CATEGORIES],
  ]) {
    const member = readQueryMember(query, key);
    if (member.error) {
      fields[key] = member.error;
    } else if (member.value !== undefined && member.value !== '') {
      if (allowed.includes(member.value)) value[key] = member.value;
      else fields[key] = `${key} must be one of: ${oneOf(allowed)}`;
    }
  }

  return Object.keys(fields).length > 0 ? fail(fields) : succeed(value);
}
