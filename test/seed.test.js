import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { SEED_TICKETS, seed } from '../scripts/seed.js';
import { openStore } from '../server/store.js';
import { validateCreateTicket } from '../server/validation.js';
import { CATEGORIES, PRIORITIES, STATUSES, TECHNICIANS } from '../shared/contract.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const seedScript = join(repoRoot, 'scripts', 'seed.js');

let tmpRoot;
before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'campusfix-seed-'));
});
after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

let counter = 0;
const tempDb = () => join(tmpRoot, `db-${(counter += 1)}`, 'seed.db');

function withStore(path, fn) {
  const store = openStore(path);
  try {
    return fn(store);
  } finally {
    store.close();
  }
}

describe('SEED_TICKETS data', () => {
  test('contains exactly 24 tickets with unique titles', () => {
    assert.equal(SEED_TICKETS.length, 24);
    const titles = SEED_TICKETS.map((t) => t.title);
    assert.equal(new Set(titles).size, 24);
    assert.equal(new Set(titles.map((t) => t.toLowerCase())).size, 24);
  });

  test('every ticket passes the create-ticket validation with trimmed values', () => {
    for (const entry of SEED_TICKETS) {
      const result = validateCreateTicket({
        title: entry.title,
        description: entry.description,
        category: entry.category,
        priority: entry.priority,
      });
      assert.equal(result.ok, true, `${entry.title}: ${JSON.stringify(result.fields)}`);
      assert.equal(result.value.title, entry.title);
      assert.equal(result.value.description, entry.description);
    }
  });

  test('statuses, assignees and timestamps are valid', () => {
    for (const entry of SEED_TICKETS) {
      assert.ok(STATUSES.includes(entry.status), `${entry.title}: status ${entry.status}`);
      assert.ok(
        entry.assignedTo === null || TECHNICIANS.includes(entry.assignedTo),
        `${entry.title}: assignee ${entry.assignedTo}`,
      );
      for (const stamp of [entry.createdAt, entry.updatedAt]) {
        assert.equal(new Date(stamp).toISOString(), stamp, `${entry.title}: ${stamp}`);
      }
      assert.ok(entry.createdAt <= entry.updatedAt, `${entry.title}: updatedAt before createdAt`);
    }
  });

  test('covers every category, priority and status', () => {
    assert.deepEqual([...new Set(SEED_TICKETS.map((t) => t.category))].sort(), [...CATEGORIES].sort());
    assert.deepEqual([...new Set(SEED_TICKETS.map((t) => t.priority))].sort(), [...PRIORITIES].sort());
    assert.deepEqual([...new Set(SEED_TICKETS.map((t) => t.status))].sort(), [...STATUSES].sort());
  });

  test('includes assigned and unassigned tickets and a few with comments', () => {
    assert.ok(SEED_TICKETS.some((t) => t.assignedTo !== null));
    assert.ok(SEED_TICKETS.some((t) => t.assignedTo === null));
    const commented = SEED_TICKETS.filter((t) => (t.comments ?? []).length > 0);
    assert.ok(commented.length >= 3 && commented.length <= 8, `commented tickets: ${commented.length}`);
    for (const entry of commented) {
      for (const body of entry.comments) assert.ok(body.trim().length > 0 && body.length <= 1000);
    }
  });

  test('does not contain the BRIEF demo ticket so it stays uniquely findable', () => {
    const text = SEED_TICKETS.map((t) => `${t.title} ${t.description}`).join('\n').toLowerCase();
    assert.ok(!text.includes('projector'));
    assert.ok(!text.includes('lab 204'));
  });
});

describe('seed(store)', () => {
  test('first run inserts 24, second run inserts 0 and skips 24', () => {
    withStore(':memory:', (store) => {
      assert.deepEqual(seed(store), { inserted: 24, skipped: 0 });
      assert.equal(store.listTickets({}).length, 24);

      assert.deepEqual(seed(store), { inserted: 0, skipped: 24 });
      assert.equal(store.listTickets({}).length, 24);
      assert.equal(store.getSummary().total, 24);
    });
  });

  test('stored tickets carry the seed fields, timestamps and assignees', () => {
    withStore(':memory:', (store) => {
      seed(store);
      const byTitle = new Map(store.listTickets({}).map((t) => [t.title, t]));
      for (const entry of SEED_TICKETS) {
        const ticket = byTitle.get(entry.title);
        assert.ok(ticket, `missing ${entry.title}`);
        assert.equal(ticket.description, entry.description);
        assert.equal(ticket.category, entry.category);
        assert.equal(ticket.priority, entry.priority);
        assert.equal(ticket.status, entry.status);
        assert.equal(ticket.assignedTo, entry.assignedTo);
        assert.equal(ticket.createdAt, entry.createdAt);
        if (!entry.comments?.length) assert.equal(ticket.updatedAt, entry.updatedAt);
      }
    });
  });

  test('summary matches the status counts of the seed data', () => {
    withStore(':memory:', (store) => {
      seed(store);
      const expected = { total: 24, open: 0, in_progress: 0, resolved: 0 };
      for (const entry of SEED_TICKETS) expected[entry.status] += 1;
      assert.deepEqual(store.getSummary(), expected);
      assert.equal(expected.open + expected.in_progress + expected.resolved, 24);
    });
  });

  test('comments are stored once and not duplicated by a repeated seed', () => {
    withStore(':memory:', (store) => {
      seed(store);
      seed(store);
      const byTitle = new Map(store.listTickets({}).map((t) => [t.title, t]));
      let totalExpected = 0;
      for (const entry of SEED_TICKETS) {
        const expected = entry.comments ?? [];
        totalExpected += expected.length;
        const comments = store.listComments(byTitle.get(entry.title).id);
        assert.deepEqual(
          comments.map((c) => c.body),
          expected,
          entry.title,
        );
      }
      assert.ok(totalExpected > 0);
    });
  });

  test('skips only titles that already exist and inserts the rest', () => {
    withStore(':memory:', (store) => {
      const first = SEED_TICKETS[0];
      store.createTicket(
        { title: first.title, description: 'Pre-existing ticket', category: 'network', priority: 'low' },
      );
      assert.deepEqual(seed(store), { inserted: 23, skipped: 1 });
      const matching = store.listTickets({}).filter((t) => t.title === first.title);
      assert.equal(matching.length, 1);
      assert.equal(matching[0].description, 'Pre-existing ticket');
      assert.equal(store.listTickets({}).length, 24);
    });
  });

  test('seeded data is persisted across reopening a file database', () => {
    const path = tempDb();
    withStore(path, (store) => assert.deepEqual(seed(store), { inserted: 24, skipped: 0 }));
    withStore(path, (store) => {
      assert.equal(store.getSummary().total, 24);
      assert.deepEqual(seed(store), { inserted: 0, skipped: 24 });
      assert.equal(store.listTickets({}).length, 24);
    });
  });

  test('seeded tickets are searchable and filterable through the store', () => {
    withStore(':memory:', (store) => {
      seed(store);
      const wifi = store.listTickets({ q: 'wi-fi' });
      assert.ok(wifi.length >= 2);
      for (const ticket of wifi) {
        assert.match(`${ticket.title} ${ticket.description}`.toLowerCase(), /wi-fi/);
      }
      const resolvedFacilities = store.listTickets({ status: 'resolved', category: 'facilities' });
      assert.ok(resolvedFacilities.length >= 1);
      assert.ok(resolvedFacilities.every((t) => t.status === 'resolved' && t.category === 'facilities'));
      assert.equal(store.listTickets({ q: 'projector' }).length, 0);
    });
  });
});

describe('scripts/seed.js as a program', () => {
  const run = (args, env) =>
    spawnSync(process.execPath, args, { cwd: repoRoot, env: { ...process.env, ...env }, encoding: 'utf8' });

  test('importing the module does not seed or create a database', () => {
    const dbPath = tempDb();
    const result = run(['--input-type=module', '-e', `await import(${JSON.stringify(seedScript)});`], {
      DB_PATH: dbPath,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), '');
    assert.equal(existsSync(dbPath), false);
  });

  test('running it twice against DB_PATH inserts 24 then 0', () => {
    const dbPath = tempDb();

    const first = run([seedScript], { DB_PATH: dbPath });
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /inserted 24, skipped 0/);

    const second = run([seedScript], { DB_PATH: dbPath });
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /inserted 0, skipped 24/);

    withStore(dbPath, (store) => {
      assert.equal(store.listTickets({}).length, 24);
      assert.equal(store.getSummary().total, 24);
    });
  });
});
