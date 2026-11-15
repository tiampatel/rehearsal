import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as contract from '../shared/contract.js';

test('enumerations match the agreed values', () => {
  assert.deepEqual([...contract.CATEGORIES], ['network', 'equipment', 'facilities']);
  assert.deepEqual([...contract.PRIORITIES], ['low', 'medium', 'high']);
  assert.deepEqual([...contract.STATUSES], ['open', 'in_progress', 'resolved']);
});

test('ticket, comment and summary field lists match the brief', () => {
  assert.deepEqual([...contract.TICKET_FIELDS], [
    'id', 'title', 'description', 'category', 'priority', 'status', 'assignedTo', 'createdAt', 'updatedAt',
  ]);
  assert.deepEqual([...contract.COMMENT_FIELDS], ['id', 'ticketId', 'body', 'createdAt']);
  assert.deepEqual([...contract.SUMMARY_FIELDS], ['total', 'open', 'in_progress', 'resolved']);
});

test('runtime defaults', () => {
  assert.equal(contract.DEFAULT_PORT, 4318);
  assert.equal(contract.DEFAULT_HOST, '127.0.0.1');
  assert.equal(contract.DEFAULT_DB_PATH, 'data/campusfix.db');
  assert.deepEqual({ ...contract.ENV }, { port: 'PORT', dbPath: 'DB_PATH' });
});

test('every route and error code the brief requires is defined', () => {
  assert.equal(contract.ROUTES.health, '/health');
  assert.equal(contract.ROUTES.tickets, '/api/tickets');
  assert.equal(contract.ROUTES.ticket, '/api/tickets/:id');
  assert.equal(contract.ROUTES.comments, '/api/tickets/:id/comments');
  assert.equal(contract.ROUTES.summary, '/api/summary');
  assert.equal(contract.ROUTES.exportTicketsCsv, '/api/export/tickets.csv');
  assert.equal(contract.ERROR_CODES.validation, 'validation_error');
  assert.equal(contract.ERROR_CODES.notFound, 'not_found');
});

test('DOM ids are unique, kebab-case and non-empty', () => {
  const ids = Object.values(contract.DOM_IDS);
  assert.ok(ids.length > 0);
  assert.equal(new Set(ids).size, ids.length, 'duplicate DOM id');
  for (const id of ids) assert.match(id, /^[a-z]+(-[a-z]+)*$/);
});

test('contract objects are frozen so no module can mutate shared constants', () => {
  assert.throws(() => contract.CATEGORIES.push('x'), TypeError);
  assert.throws(() => { contract.LIMITS.title = 1; }, TypeError);
  assert.equal(contract.TECHNICIANS.length > 0, true);
});
