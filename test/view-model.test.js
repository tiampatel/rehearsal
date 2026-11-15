import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  filtersToQuery, hasActiveFilters, summaryCards, formatDate, ticketCountText, ticketRow,
  listState, commentListView, detailView, assigneeToPatch, errorMessage, statusLabel,
} from '../public/view-model.js';

const ticket = {
  id: 5, title: 'Projector broken', description: 'No image', category: 'equipment',
  priority: 'high', status: 'in_progress', assignedTo: 'Avery Chen',
  createdAt: '2026-11-15T07:30:00.000Z', updatedAt: '2026-11-15T09:05:00.000Z',
};

test('filtersToQuery trims and omits empty values, keeps no semantics', () => {
  assert.deepEqual(filtersToQuery({ q: '  lab 204 ', status: '', priority: undefined, category: 'network' }),
    { q: 'lab 204', category: 'network' });
  assert.deepEqual(filtersToQuery({ q: '   ' }), {});
  assert.deepEqual(filtersToQuery(), {});
  assert.equal(hasActiveFilters({ status: 'open' }), true);
  assert.equal(hasActiveFilters({ status: '', q: ' ' }), false);
});

test('summaryCards maps counts and defaults missing to 0', () => {
  const cards = summaryCards({ total: 24, open: 10, in_progress: 8, resolved: 6 });
  assert.deepEqual(cards.map((c) => [c.key, c.text]),
    [['total', '24'], ['open', '10'], ['in_progress', '8'], ['resolved', '6']]);
  assert.deepEqual(summaryCards(null).map((c) => c.value), [0, 0, 0, 0]);
});

test('formatDate is UTC and tolerant of bad input', () => {
  assert.equal(formatDate('2026-11-15T07:30:00.000Z'), '2026-11-15 07:30 UTC');
  assert.equal(formatDate('nope'), '');
  assert.equal(formatDate(undefined), '');
});

test('ticketCountText pluralises', () => {
  assert.equal(ticketCountText(0), '0 tickets');
  assert.equal(ticketCountText(1), '1 ticket');
  assert.equal(ticketCountText(24), '24 tickets');
});

test('ticketRow builds badge descriptors and selection', () => {
  const row = ticketRow(ticket, 5);
  assert.equal(row.priorityClass, 'badge badge--priority-high');
  assert.equal(row.statusClass, 'badge badge--status-in_progress');
  assert.equal(row.statusLabel, 'In progress');
  assert.equal(row.categoryLabel, 'Equipment');
  assert.equal(row.assigneeText, 'Assigned to Avery Chen');
  assert.equal(row.selected, true);
  assert.equal(ticketRow(ticket, 4).selected, false);
  assert.equal(ticketRow({ ...ticket, assignedTo: null }).assigneeText, 'Unassigned');
  assert.match(row.ariaLabel, /#5 Projector broken, High priority, In progress/);
});

test('listState covers loading, error, empty (with/without filters) and ready', () => {
  assert.deepEqual(listState({ loading: true }), { kind: 'loading', message: 'Loading tickets...' });
  assert.equal(listState({ error: { code: 'network_error' } }).kind, 'error');
  assert.match(listState({ error: { code: 'network_error' } }).message, /Cannot reach the server/);
  assert.match(listState({ count: 0, filtersActive: true }).message, /No tickets match/);
  assert.match(listState({ count: 0 }).message, /No tickets yet/);
  assert.deepEqual(listState({ count: 3 }), { kind: 'ready', message: '' });
  assert.equal(listState({ loading: true, error: {} , count: 3 }).kind, 'loading');
});

test('commentListView and detailView', () => {
  const empty = commentListView([]);
  assert.equal(empty.empty, true);
  const view = detailView(ticket, [{ id: 1, ticketId: 5, body: 'On it', createdAt: '2026-11-15T08:00:00.000Z' }]);
  assert.equal(view.heading, '#5 Projector broken');
  assert.equal(view.assignee, 'Avery Chen');
  assert.equal(view.status, 'in_progress');
  assert.equal(view.createdText, '2026-11-15 07:30 UTC');
  assert.deepEqual(view.comments.items, [{ id: 1, body: 'On it', createdText: '2026-11-15 08:00 UTC' }]);
  assert.equal(detailView({ ...ticket, assignedTo: null }).assignee, '');
});

test('assigneeToPatch maps blank to null', () => {
  assert.equal(assigneeToPatch(''), null);
  assert.equal(assigneeToPatch('  '), null);
  assert.equal(assigneeToPatch(' Priya Raman '), 'Priya Raman');
});

test('errorMessage maps ApiError-like and plain errors', () => {
  const v = errorMessage({ code: 'validation_error', message: 'Invalid', fields: { title: 'Title is required' } });
  assert.equal(v.message, 'Please fix the following: title: Title is required');
  assert.deepEqual(v.fields, { title: 'Title is required' });
  assert.match(errorMessage({ code: 'network_error', status: 0 }).message, /Cannot reach the server/);
  assert.equal(errorMessage({ code: 'not_found' }).message, 'That item no longer exists.');
  assert.equal(errorMessage({ code: 'internal_error', message: 'Boom' }).message, 'Boom');
  assert.equal(errorMessage(new Error('plain')).message, 'plain');
  assert.equal(errorMessage(undefined).message, 'Something went wrong.');
  assert.equal(statusLabel('weird'), 'weird');
});
