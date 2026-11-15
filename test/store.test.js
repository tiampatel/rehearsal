import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../server/store.js';
import { COMMENT_FIELDS, TICKET_FIELDS } from '../shared/contract.js';

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const base = (overrides = {}) => ({
  title: 'Wi-Fi down in Library',
  description: 'Access points on level 2 are offline.',
  category: 'network',
  priority: 'high',
  ...overrides,
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('store', () => {
  let dir;
  let dbPath;
  let store;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'campusfix-store-'));
    dbPath = join(dir, 'nested', 'test.db');
    store = openStore(dbPath);
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  describe('creating and reading tickets', () => {
    test('creates the parent directory and the database file', () => {
      assert.ok(existsSync(dbPath));
    });

    test('createTicket returns a complete ticket with defaults', () => {
      const before = Date.now();
      const ticket = store.createTicket(base());
      const after = Date.now();

      assert.deepEqual(Object.keys(ticket), [...TICKET_FIELDS]);
      assert.equal(ticket.id, 1);
      assert.equal(ticket.title, 'Wi-Fi down in Library');
      assert.equal(ticket.description, 'Access points on level 2 are offline.');
      assert.equal(ticket.category, 'network');
      assert.equal(ticket.priority, 'high');
      assert.equal(ticket.status, 'open');
      assert.equal(ticket.assignedTo, null);
      assert.match(ticket.createdAt, ISO);
      assert.equal(ticket.updatedAt, ticket.createdAt);
      const created = Date.parse(ticket.createdAt);
      assert.ok(created >= before && created <= after);
      assert.equal(Object.getPrototypeOf(ticket), Object.prototype);
    });

    test('ids are sequential integers', () => {
      const a = store.createTicket(base({ title: 'A' }));
      const b = store.createTicket(base({ title: 'B' }));
      assert.equal(a.id, 1);
      assert.equal(b.id, 2);
      assert.ok(Number.isInteger(b.id));
    });

    test('createTicket honours extra overrides used for seeding', () => {
      const ticket = store.createTicket(base(), {
        status: 'in_progress',
        assignedTo: 'Priya Raman',
        createdAt: '2026-01-02T03:04:05.000Z',
        updatedAt: '2026-01-03T03:04:05.000Z',
      });
      assert.equal(ticket.status, 'in_progress');
      assert.equal(ticket.assignedTo, 'Priya Raman');
      assert.equal(ticket.createdAt, '2026-01-02T03:04:05.000Z');
      assert.equal(ticket.updatedAt, '2026-01-03T03:04:05.000Z');
    });

    test('updatedAt defaults to a supplied createdAt', () => {
      const ticket = store.createTicket(base(), { createdAt: '2026-02-01T00:00:00.000Z' });
      assert.equal(ticket.updatedAt, '2026-02-01T00:00:00.000Z');
    });

    test('createTicket rejects unsupported enum values instead of storing them', () => {
      assert.throws(() => store.createTicket(base({ category: 'plumbing' })));
      assert.throws(() => store.createTicket(base({ priority: 'urgent' })));
      assert.throws(() => store.createTicket(base(), { status: 'closed' }));
      assert.equal(store.listTickets().length, 0);
    });

    test('getTicket returns the stored ticket', () => {
      const created = store.createTicket(base());
      assert.deepEqual(store.getTicket(created.id), created);
    });

    test('getTicket accepts numeric-string ids and returns null for unknown or malformed ids', () => {
      const created = store.createTicket(base());
      assert.deepEqual(store.getTicket(String(created.id)), created);
      assert.equal(store.getTicket(999), null);
      assert.equal(store.getTicket(0), null);
      assert.equal(store.getTicket(-1), null);
      assert.equal(store.getTicket(1.5), null);
      assert.equal(store.getTicket('abc'), null);
      assert.equal(store.getTicket('1; DROP TABLE tickets'), null);
      assert.equal(store.getTicket(null), null);
      assert.equal(store.getTicket(undefined), null);
      assert.equal(store.listTickets().length, 1);
    });

    test('stores text containing quotes and SQL metacharacters verbatim', () => {
      const title = `Robert'); DROP TABLE tickets;--`;
      const created = store.createTicket(base({ title }));
      assert.equal(store.getTicket(created.id).title, title);
      assert.equal(store.listTickets().length, 1);
    });
  });

  describe('updateTicket', () => {
    test('applies status, assignedTo and priority and refreshes updatedAt', async () => {
      const created = store.createTicket(base());
      await sleep(5);
      const updated = store.updateTicket(created.id, {
        status: 'in_progress',
        assignedTo: 'Jordan Okafor',
        priority: 'low',
      });
      assert.equal(updated.status, 'in_progress');
      assert.equal(updated.assignedTo, 'Jordan Okafor');
      assert.equal(updated.priority, 'low');
      assert.equal(updated.title, created.title);
      assert.equal(updated.createdAt, created.createdAt);
      assert.ok(Date.parse(updated.updatedAt) > Date.parse(created.updatedAt));
      assert.deepEqual(store.getTicket(created.id), updated);
    });

    test('only touches the fields present in the patch', () => {
      const created = store.createTicket(base(), { assignedTo: 'Sam Whitlock' });
      const updated = store.updateTicket(created.id, { status: 'resolved' });
      assert.equal(updated.status, 'resolved');
      assert.equal(updated.assignedTo, 'Sam Whitlock');
      assert.equal(updated.priority, 'high');
    });

    test('assignedTo null unassigns the ticket', () => {
      const created = store.createTicket(base(), { assignedTo: 'Sam Whitlock' });
      const updated = store.updateTicket(created.id, { assignedTo: null });
      assert.equal(updated.assignedTo, null);
    });

    test('undefined members of the patch are ignored', () => {
      const created = store.createTicket(base());
      const updated = store.updateTicket(created.id, { status: 'resolved', priority: undefined });
      assert.equal(updated.status, 'resolved');
      assert.equal(updated.priority, 'high');
    });

    test('an empty patch changes nothing and returns the ticket', () => {
      const created = store.createTicket(base());
      assert.deepEqual(store.updateTicket(created.id, {}), created);
    });

    test('returns null for an unknown id and does not create anything', () => {
      assert.equal(store.updateTicket(42, { status: 'resolved' }), null);
      assert.equal(store.updateTicket('nope', { status: 'resolved' }), null);
      assert.equal(store.listTickets().length, 0);
    });

    test('an invalid enum value is rejected and leaves the ticket unchanged', () => {
      const created = store.createTicket(base());
      assert.throws(() => store.updateTicket(created.id, { status: 'closed' }));
      assert.deepEqual(store.getTicket(created.id), created);
    });
  });

  describe('comments', () => {
    test('addComment returns a comment and refreshes the ticket updatedAt', async () => {
      const created = store.createTicket(base());
      await sleep(5);
      const comment = store.addComment(created.id, { body: 'Technician dispatched.' });

      assert.deepEqual(Object.keys(comment), [...COMMENT_FIELDS]);
      assert.equal(comment.id, 1);
      assert.equal(comment.ticketId, created.id);
      assert.equal(comment.body, 'Technician dispatched.');
      assert.match(comment.createdAt, ISO);

      const ticket = store.getTicket(created.id);
      assert.equal(ticket.updatedAt, comment.createdAt);
      assert.ok(Date.parse(ticket.updatedAt) > Date.parse(created.updatedAt));
      assert.equal(ticket.status, created.status);
    });

    test('addComment returns null for an unknown ticket and stores nothing', () => {
      const created = store.createTicket(base());
      assert.equal(store.addComment(999, { body: 'orphan' }), null);
      assert.equal(store.addComment('abc', { body: 'orphan' }), null);
      assert.deepEqual(store.listComments(created.id), []);
      assert.deepEqual(store.listComments(999), []);
    });

    test('listComments returns comments for one ticket in creation order, even within one millisecond', () => {
      const a = store.createTicket(base({ title: 'A' }));
      const b = store.createTicket(base({ title: 'B' }));
      const bodies = [];
      for (let i = 0; i < 25; i += 1) {
        const body = `note ${i}`;
        bodies.push(body);
        store.addComment(a.id, { body });
        if (i % 5 === 0) store.addComment(b.id, { body: `other ${i}` });
      }
      const comments = store.listComments(a.id);
      assert.deepEqual(
        comments.map((c) => c.body),
        bodies,
      );
      assert.ok(comments.every((c) => c.ticketId === a.id));
      const ids = comments.map((c) => c.id);
      assert.deepEqual(ids, [...ids].sort((x, y) => x - y));
      assert.equal(store.listComments(b.id).length, 5);
    });

    test('adding a comment moves the ticket to the top of the list', async () => {
      const first = store.createTicket(base({ title: 'first' }), { createdAt: '2026-01-01T00:00:00.000Z' });
      const second = store.createTicket(base({ title: 'second' }), { createdAt: '2026-01-02T00:00:00.000Z' });
      assert.deepEqual(store.listTickets().map((t) => t.id), [second.id, first.id]);
      store.addComment(first.id, { body: 'bump' });
      assert.deepEqual(store.listTickets().map((t) => t.id), [first.id, second.id]);
    });
  });

  describe('listTickets ordering', () => {
    test('orders by updatedAt descending', () => {
      const a = store.createTicket(base({ title: 'a' }), { updatedAt: '2026-03-01T00:00:00.000Z' });
      const b = store.createTicket(base({ title: 'b' }), { updatedAt: '2026-03-03T00:00:00.000Z' });
      const c = store.createTicket(base({ title: 'c' }), { updatedAt: '2026-03-02T00:00:00.000Z' });
      assert.deepEqual(store.listTickets().map((t) => t.id), [b.id, c.id, a.id]);
    });

    test('ties on updatedAt are broken by id descending', () => {
      const stamp = '2026-03-01T12:00:00.000Z';
      const ids = [];
      for (let i = 0; i < 6; i += 1) {
        ids.push(store.createTicket(base({ title: `t${i}` }), { updatedAt: stamp }).id);
      }
      assert.deepEqual(store.listTickets().map((t) => t.id), [...ids].reverse());
    });

    test('filtered results keep the same ordering', () => {
      const stamp = '2026-03-01T12:00:00.000Z';
      const x = store.createTicket(base({ title: 'router one', priority: 'low' }), { updatedAt: stamp });
      store.createTicket(base({ title: 'router skip', priority: 'high' }), { updatedAt: stamp });
      const z = store.createTicket(base({ title: 'router two', priority: 'low' }), { updatedAt: stamp });
      const result = store.listTickets({ q: 'router', priority: 'low' });
      assert.deepEqual(result.map((t) => t.id), [z.id, x.id]);
    });
  });

  describe('listTickets search and filters', () => {
    let projector;
    let wifi;
    let leak;
    let printer;

    beforeEach(() => {
      projector = store.createTicket(
        { title: 'Projector broken in Lab 204', description: 'No picture from HDMI.', category: 'equipment', priority: 'medium' },
        { createdAt: '2026-04-01T00:00:00.000Z' },
      );
      wifi = store.createTicket(
        { title: 'Wi-Fi drops', description: 'The projector room loses Wi-Fi hourly.', category: 'network', priority: 'high' },
        { status: 'in_progress', createdAt: '2026-04-02T00:00:00.000Z' },
      );
      leak = store.createTicket(
        { title: 'Roof leak', description: 'Water in corridor B.', category: 'facilities', priority: 'high' },
        { status: 'resolved', assignedTo: 'Mateo Alvarez', createdAt: '2026-04-03T00:00:00.000Z' },
      );
      printer = store.createTicket(
        { title: 'Printer jam', description: 'Level 100% full queue_stuck', category: 'equipment', priority: 'low' },
        { createdAt: '2026-04-04T00:00:00.000Z' },
      );
    });

    const ids = (filters) => store.listTickets(filters).map((t) => t.id);

    test('no filters, empty filters and undefined members return everything', () => {
      const all = [printer.id, leak.id, wifi.id, projector.id];
      assert.deepEqual(ids(), all);
      assert.deepEqual(ids({}), all);
      assert.deepEqual(ids(null), all);
      assert.deepEqual(ids({ q: undefined, status: undefined, priority: undefined, category: undefined }), all);
      assert.deepEqual(ids({ q: '', status: '', priority: '', category: '' }), all);
      assert.deepEqual(ids({ q: '   ' }), all);
    });

    test('q matches the title case-insensitively', () => {
      assert.deepEqual(ids({ q: 'PROJECTOR BROKEN' }), [projector.id]);
      assert.deepEqual(ids({ q: 'roof' }), [leak.id]);
    });

    test('q matches the description as well as the title (OR)', () => {
      // "projector" is in the title of one ticket and only in the description of another.
      assert.deepEqual(ids({ q: 'projector' }), [wifi.id, projector.id]);
      assert.deepEqual(ids({ q: 'corridor' }), [leak.id]);
    });

    test('q is trimmed and multi-word q is one substring', () => {
      assert.deepEqual(ids({ q: '  lab 204  ' }), [projector.id]);
      assert.deepEqual(ids({ q: 'lab broken' }), []);
    });

    test('q with no match returns an empty array', () => {
      assert.deepEqual(store.listTickets({ q: 'nonexistent-term' }), []);
    });

    test('LIKE wildcards in q are treated literally', () => {
      assert.deepEqual(ids({ q: '100%' }), [printer.id]);
      assert.deepEqual(ids({ q: '%' }), [printer.id]);
      assert.deepEqual(ids({ q: 'queue_stuck' }), [printer.id]);
      assert.deepEqual(ids({ q: '_' }), [printer.id]);
      assert.deepEqual(ids({ q: 'queue-stuck' }), []);
      assert.deepEqual(ids({ q: 'queueXstuck' }), []);
      assert.deepEqual(ids({ q: 'P%r' }), []);
      assert.deepEqual(ids({ q: '\\' }), []);
    });

    test('a backslash in q matches a literal backslash', () => {
      const unc = store.createTicket(base({ title: 'Share \\\\fileserver\\docs unreachable' }));
      assert.deepEqual(ids({ q: '\\\\fileserver' }), [unc.id]);
      assert.deepEqual(ids({ q: '\\' }), [unc.id]);
    });

    test('q containing quotes is safe', () => {
      assert.deepEqual(ids({ q: "' OR 1=1 --" }), []);
    });

    test('status, priority and category are exact filters', () => {
      assert.deepEqual(ids({ status: 'in_progress' }), [wifi.id]);
      assert.deepEqual(ids({ status: 'open' }), [printer.id, projector.id]);
      assert.deepEqual(ids({ priority: 'high' }), [leak.id, wifi.id]);
      assert.deepEqual(ids({ category: 'equipment' }), [printer.id, projector.id]);
      assert.deepEqual(ids({ status: 'bogus' }), []);
    });

    test('all provided filters combine with AND', () => {
      assert.deepEqual(ids({ category: 'equipment', priority: 'low' }), [printer.id]);
      assert.deepEqual(ids({ category: 'equipment', priority: 'high' }), []);
      assert.deepEqual(ids({ q: 'projector', category: 'network' }), [wifi.id]);
      assert.deepEqual(ids({ q: 'projector', status: 'open', priority: 'medium', category: 'equipment' }), [projector.id]);
      assert.deepEqual(ids({ q: 'projector', status: 'resolved' }), []);
      assert.deepEqual(ids({ priority: 'high', status: 'resolved' }), [leak.id]);
    });

    test('filters see changes made by updateTicket', () => {
      store.updateTicket(printer.id, { status: 'resolved', priority: 'high' });
      assert.deepEqual(ids({ status: 'resolved', priority: 'high' }), [printer.id, leak.id]);
      assert.deepEqual(ids({ status: 'open' }), [projector.id]);
    });
  });

  describe('getSummary', () => {
    test('is all zero for an empty store', () => {
      assert.deepEqual(store.getSummary(), { total: 0, open: 0, in_progress: 0, resolved: 0 });
    });

    test('counts every ticket by status and updates after status changes', () => {
      const a = store.createTicket(base({ title: 'a' }));
      const b = store.createTicket(base({ title: 'b' }));
      store.createTicket(base({ title: 'c' }));
      store.createTicket(base({ title: 'd' }), { status: 'resolved' });
      assert.deepEqual(store.getSummary(), { total: 4, open: 3, in_progress: 0, resolved: 1 });

      store.updateTicket(a.id, { status: 'in_progress' });
      assert.deepEqual(store.getSummary(), { total: 4, open: 2, in_progress: 1, resolved: 1 });

      store.updateTicket(b.id, { status: 'resolved' });
      store.updateTicket(a.id, { status: 'resolved' });
      assert.deepEqual(store.getSummary(), { total: 4, open: 1, in_progress: 0, resolved: 3 });
    });

    test('total is the sum of the three statuses', () => {
      store.createTicket(base({ title: 'a' }));
      store.createTicket(base({ title: 'b' }), { status: 'in_progress' });
      store.createTicket(base({ title: 'c' }), { status: 'resolved' });
      const s = store.getSummary();
      assert.equal(s.total, s.open + s.in_progress + s.resolved);
      assert.equal(s.total, 3);
    });

    test('ignores listTickets filters', () => {
      store.createTicket(base({ title: 'a', category: 'network' }));
      store.createTicket(base({ title: 'b', category: 'facilities' }));
      assert.equal(store.listTickets({ category: 'network' }).length, 1);
      assert.equal(store.getSummary().total, 2);
    });
  });

  describe('persistence and lifecycle', () => {
    test('reopening the same file returns the same tickets and comments', () => {
      const a = store.createTicket(base({ title: 'persist me' }));
      store.updateTicket(a.id, { status: 'in_progress', assignedTo: 'Avery Chen' });
      store.addComment(a.id, { body: 'first' });
      store.addComment(a.id, { body: 'second' });
      const b = store.createTicket(base({ title: 'another' }));

      const expectedTickets = store.listTickets();
      const expectedComments = store.listComments(a.id);
      const expectedSummary = store.getSummary();
      store.close();

      const reopened = openStore(dbPath);
      try {
        assert.deepEqual(reopened.listTickets(), expectedTickets);
        assert.deepEqual(reopened.getTicket(a.id), expectedTickets.find((t) => t.id === a.id));
        assert.deepEqual(reopened.listComments(a.id), expectedComments);
        assert.deepEqual(reopened.getSummary(), expectedSummary);
        assert.equal(reopened.getTicket(a.id).assignedTo, 'Avery Chen');

        // ids continue after reopening
        const c = reopened.createTicket(base({ title: 'after reopen' }));
        assert.equal(c.id, b.id + 1);
      } finally {
        reopened.close();
      }

      // the afterEach hook closes `store` again; keep it valid for that (close is idempotent)
    });

    test('close is idempotent', () => {
      store.close();
      assert.doesNotThrow(() => store.close());
      assert.doesNotThrow(() => store.close());
    });

    test('methods throw after close rather than silently failing', () => {
      store.close();
      assert.throws(() => store.listTickets());
      assert.throws(() => store.createTicket(base()));
    });

    test('supports :memory: databases that are independent of each other', () => {
      const one = openStore(':memory:');
      const two = openStore(':memory:');
      try {
        one.createTicket(base({ title: 'only in one' }));
        assert.equal(one.listTickets().length, 1);
        assert.equal(two.listTickets().length, 0);
      } finally {
        one.close();
        two.close();
      }
    });

    test('opening an existing database does not wipe data (tables created only if missing)', () => {
      store.createTicket(base({ title: 'keep' }));
      const second = openStore(dbPath);
      try {
        assert.equal(second.listTickets().length, 1);
      } finally {
        second.close();
      }
      assert.equal(store.listTickets().length, 1);
    });
  });
});
