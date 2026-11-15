// CampusFix SQLite store (task: store). Behaviour is specified in API.md "Store".
// Synchronous API on top of node:sqlite. All SQL is parameterised; LIKE wildcards in the
// search text are escaped so `%`, `_` and `\` match literally.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  CATEGORIES,
  COMMENT_FIELDS,
  DEFAULT_DB_PATH,
  PRIORITIES,
  STATUSES,
  TICKET_FIELDS,
} from '../shared/contract.js';

const sqlList = (values) => values.map((v) => `'${v}'`).join(', ');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tickets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  description TEXT NOT NULL,
  category    TEXT NOT NULL CHECK (category IN (${sqlList(CATEGORIES)})),
  priority    TEXT NOT NULL CHECK (priority IN (${sqlList(PRIORITIES)})),
  status      TEXT NOT NULL CHECK (status IN (${sqlList(STATUSES)})),
  assignedTo  TEXT,
  createdAt   TEXT NOT NULL,
  updatedAt   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS comments (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ticketId  INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  body      TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tickets_order ON tickets (updatedAt DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_comments_ticket ON comments (ticketId, createdAt, id);
`;

const TICKET_COLUMNS = TICKET_FIELDS.join(', ');
const COMMENT_COLUMNS = COMMENT_FIELDS.join(', ');

// node:sqlite rows have a null prototype; return plain objects with exactly the contract fields.
function pick(row, fields) {
  if (!row) return null;
  const out = {};
  for (const field of fields) out[field] = row[field] ?? null;
  return out;
}
const toTicket = (row) => pick(row, TICKET_FIELDS);
const toComment = (row) => pick(row, COMMENT_FIELDS);

function escapeLike(text) {
  return text.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

// Ids are positive integers; anything else (strings, NaN, floats, null) never matches a row.
function normalizeId(id) {
  if (typeof id === 'string' && /^[0-9]+$/.test(id)) id = Number(id);
  return Number.isSafeInteger(id) ? id : null;
}

const isProvided = (value) => value !== undefined && value !== null && value !== '';

export function openStore(dbPath = DEFAULT_DB_PATH) {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);

  const insertTicket = db.prepare(
    `INSERT INTO tickets (title, description, category, priority, status, assignedTo, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const selectTicket = db.prepare(`SELECT ${TICKET_COLUMNS} FROM tickets WHERE id = ?`);
  const touchTicket = db.prepare('UPDATE tickets SET updatedAt = ? WHERE id = ?');
  const insertComment = db.prepare('INSERT INTO comments (ticketId, body, createdAt) VALUES (?, ?, ?)');
  const selectComment = db.prepare(`SELECT ${COMMENT_COLUMNS} FROM comments WHERE id = ?`);
  const selectComments = db.prepare(
    `SELECT ${COMMENT_COLUMNS} FROM comments WHERE ticketId = ? ORDER BY createdAt ASC, id ASC`,
  );
  const selectSummary = db.prepare(
    'SELECT status, COUNT(*) AS n FROM tickets GROUP BY status',
  );

  let closed = false;

  // Runs fn inside a transaction; rolls back and rethrows on error.
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  const store = {
    createTicket(input, extra = {}) {
      const now = new Date().toISOString();
      const opts = extra ?? {};
      const createdAt = opts.createdAt ?? now;
      const updatedAt = opts.updatedAt ?? opts.createdAt ?? now;
      const { lastInsertRowid } = insertTicket.run(
        input.title,
        input.description,
        input.category,
        input.priority,
        opts.status ?? 'open',
        opts.assignedTo ?? null,
        createdAt,
        updatedAt,
      );
      return toTicket(selectTicket.get(Number(lastInsertRowid)));
    },

    getTicket(id) {
      const key = normalizeId(id);
      if (key === null) return null;
      return toTicket(selectTicket.get(key));
    },

    listTickets(filters = {}) {
      const f = filters ?? {};
      const where = [];
      const params = [];

      if (typeof f.q === 'string' && f.q.trim() !== '') {
        const pattern = `%${escapeLike(f.q.trim())}%`;
        where.push("(title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')");
        params.push(pattern, pattern);
      }
      for (const column of ['status', 'priority', 'category']) {
        if (isProvided(f[column])) {
          where.push(`${column} = ?`);
          params.push(String(f[column]));
        }
      }

      const sql =
        `SELECT ${TICKET_COLUMNS} FROM tickets` +
        (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
        ' ORDER BY updatedAt DESC, id DESC';
      return db.prepare(sql).all(...params).map(toTicket);
    },

    updateTicket(id, patch = {}) {
      const key = normalizeId(id);
      if (key === null) return null;
      const changes = patch ?? {};

      return transaction(() => {
        if (!selectTicket.get(key)) return null;

        const sets = [];
        const params = [];
        for (const column of ['status', 'priority', 'assignedTo']) {
          if (changes[column] !== undefined) {
            sets.push(`${column} = ?`);
            params.push(changes[column]);
          }
        }
        if (sets.length > 0) {
          sets.push('updatedAt = ?');
          params.push(new Date().toISOString(), key);
          db.prepare(`UPDATE tickets SET ${sets.join(', ')} WHERE id = ?`).run(...params);
        }
        return toTicket(selectTicket.get(key));
      });
    },

    addComment(ticketId, { body } = {}) {
      const key = normalizeId(ticketId);
      if (key === null) return null;

      return transaction(() => {
        if (!selectTicket.get(key)) return null;
        const now = new Date().toISOString();
        const { lastInsertRowid } = insertComment.run(key, body, now);
        touchTicket.run(now, key);
        return toComment(selectComment.get(Number(lastInsertRowid)));
      });
    },

    listComments(ticketId) {
      const key = normalizeId(ticketId);
      if (key === null) return [];
      return selectComments.all(key).map(toComment);
    },

    getSummary() {
      const summary = { total: 0, open: 0, in_progress: 0, resolved: 0 };
      for (const row of selectSummary.all()) {
        if (row.status in summary) summary[row.status] = Number(row.n);
      }
      summary.total = summary.open + summary.in_progress + summary.resolved;
      return summary;
    },

    close() {
      if (closed) return;
      closed = true;
      db.close();
    },
  };

  return store;
}
