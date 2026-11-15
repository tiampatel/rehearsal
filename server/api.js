// CampusFix HTTP API (task: api). Behaviour is specified in API.md.
// createApiHandler(store) returns async (req, res) => boolean: true when it responded
// (/health and /api/*), false for any other path so the caller can fall through to static files.

import { ERROR_CODES, ROUTES } from '../shared/contract.js';
import {
  validateComment,
  validateCreateTicket,
  validateListQuery,
  validatePatchTicket,
} from './validation.js';
import { ticketsToCsv } from './csv.js';

const MAX_BODY_BYTES = 64 * 1024;
const JSON_TYPE = 'application/json; charset=utf-8';
const CSV_TYPE = 'text/csv; charset=utf-8';
const CSV_DISPOSITION = 'attachment; filename="campusfix-tickets.csv"';

class HttpError extends Error {
  constructor(status, code, message, fields, headers) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.headers = headers;
  }
}

const notFound = (message = 'Resource not found') =>
  new HttpError(404, ERROR_CODES.notFound, message);

export function sendJson(res, status, payload, headers = {}) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(status, {
    'Content-Type': JSON_TYPE,
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

export function sendCsv(res, csv) {
  const body = Buffer.from(csv, 'utf8');
  res.writeHead(200, {
    'Content-Type': CSV_TYPE,
    'Content-Disposition': CSV_DISPOSITION,
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

export function sendError(res, status, code, message, fields, headers) {
  const error = { code, message };
  if (fields) error.fields = fields;
  sendJson(res, status, { error }, headers);
}

function validationError(fields) {
  return new HttpError(400, ERROR_CODES.validation, 'Validation failed', fields);
}

// Reads and parses a JSON object body. Rejects with invalid_json for anything else.
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let finished = false;
    const fail = (error) => {
      if (finished) return;
      finished = true;
      reject(error);
    };

    req.on('data', (chunk) => {
      if (finished) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        fail(new HttpError(400, ERROR_CODES.invalidJson, 'Request body is too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', () => fail(new HttpError(400, ERROR_CODES.invalidJson, 'Could not read request body')));
    req.on('end', () => {
      if (finished) return;
      finished = true;
      const text = Buffer.concat(chunks).toString('utf8');
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        reject(new HttpError(400, ERROR_CODES.invalidJson, 'Request body must be valid JSON'));
        return;
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        reject(new HttpError(400, ERROR_CODES.invalidJson, 'Request body must be a JSON object'));
        return;
      }
      resolve(parsed);
    });
  });
}

function methodNotAllowed(allowed) {
  return new HttpError(
    405,
    ERROR_CODES.methodNotAllowed,
    `Method not allowed; use ${allowed.join(', ')}`,
    undefined,
    { Allow: allowed.join(', ') },
  );
}

function parseId(segment) {
  if (!/^[0-9]+$/.test(segment)) throw notFound('Ticket not found');
  const id = Number(segment);
  if (!Number.isSafeInteger(id) || id < 1) throw notFound('Ticket not found');
  return id;
}

export function createApiHandler(store) {
  // Resolves a request to { status, payload }, or throws HttpError.
  async function route(req, url) {
    const method = req.method ?? 'GET';
    const { pathname } = url;

    if (pathname === ROUTES.health) {
      if (method !== 'GET') throw methodNotAllowed(['GET']);
      return { status: 200, payload: { status: 'ok' } };
    }

    if (pathname === ROUTES.summary) {
      if (method !== 'GET') throw methodNotAllowed(['GET']);
      return { status: 200, payload: store.getSummary() };
    }

    if (pathname === ROUTES.exportTicketsCsv) {
      if (method !== 'GET') throw methodNotAllowed(['GET']);
      const query = validateListQuery(url.searchParams);
      if (!query.ok) throw validationError(query.fields);
      return { status: 200, csv: ticketsToCsv(store.listTickets(query.value)) };
    }

    if (pathname === ROUTES.tickets) {
      if (method === 'GET') {
        const query = validateListQuery(url.searchParams);
        if (!query.ok) throw validationError(query.fields);
        const tickets = store.listTickets(query.value);
        return { status: 200, payload: { tickets, total: tickets.length } };
      }
      if (method === 'POST') {
        const body = await readJsonBody(req);
        const input = validateCreateTicket(body);
        if (!input.ok) throw validationError(input.fields);
        return { status: 201, payload: { ticket: store.createTicket(input.value) } };
      }
      throw methodNotAllowed(['GET', 'POST']);
    }

    const match = /^\/api\/tickets\/([^/]+)(\/comments)?$/.exec(pathname);
    if (match) {
      const isComments = match[2] !== undefined;

      if (isComments) {
        if (method !== 'POST') throw methodNotAllowed(['POST']);
        const id = parseId(match[1]);
        if (!store.getTicket(id)) throw notFound('Ticket not found');
        const body = await readJsonBody(req);
        const input = validateComment(body);
        if (!input.ok) throw validationError(input.fields);
        const comment = store.addComment(id, input.value);
        if (!comment) throw notFound('Ticket not found');
        return { status: 201, payload: { comment } };
      }

      if (method === 'GET') {
        const id = parseId(match[1]);
        const ticket = store.getTicket(id);
        if (!ticket) throw notFound('Ticket not found');
        return { status: 200, payload: { ticket, comments: store.listComments(id) } };
      }
      if (method === 'PATCH') {
        const id = parseId(match[1]);
        if (!store.getTicket(id)) throw notFound('Ticket not found');
        const body = await readJsonBody(req);
        const patch = validatePatchTicket(body);
        if (!patch.ok) throw validationError(patch.fields);
        const ticket = store.updateTicket(id, patch.value);
        if (!ticket) throw notFound('Ticket not found');
        return { status: 200, payload: { ticket } };
      }
      throw methodNotAllowed(['GET', 'PATCH']);
    }

    throw notFound('Route not found');
  }

  return async function handleApi(req, res) {
    let url;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      return false;
    }
    const { pathname } = url;
    if (pathname !== ROUTES.health && pathname !== '/api' && !pathname.startsWith('/api/')) {
      return false;
    }

    try {
      const { status, payload, csv } = await route(req, url);
      if (csv !== undefined) sendCsv(res, csv);
      else sendJson(res, status, payload);
    } catch (error) {
      if (error instanceof HttpError) {
        sendError(res, error.status, error.code, error.message, error.fields, error.headers);
      } else {
        console.error('CampusFix API internal error:', error);
        if (res.headersSent) {
          res.destroy();
        } else {
          sendError(res, 500, ERROR_CODES.internal, 'Internal server error');
        }
      }
    }
    return true;
  };
}
