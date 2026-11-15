// CampusFix end-to-end acceptance test. Runs the real integrated app (server/main.js createApp)
// on an ephemeral port with a temporary SQLite file and talks to it over real HTTP.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApp } from '../server/main.js';
import { openStore } from '../server/store.js';
import { SEED_TICKETS, seed } from '../scripts/seed.js';
import { createClient, ApiError } from '../public/api.js';
import {
  CATEGORIES,
  DOM_IDS,
  PRIORITIES,
  STATUSES,
  TICKET_FIELDS,
  COMMENT_FIELDS,
} from '../shared/contract.js';

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

let tmpRoot;
const apps = [];

async function startApp(dbPath) {
  const app = createApp({ dbPath });
  const info = await app.start(0);
  apps.push(app);
  return { app, ...info };
}

async function http(base, method, path, body) {
  const init = { method, headers: {} };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const res = await fetch(`${base}${path}`, init);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { res, status: res.status, text, json };
}

function assertTicketShape(ticket) {
  assert.deepEqual(Object.keys(ticket).sort(), [...TICKET_FIELDS].sort());
  assert.ok(Number.isInteger(ticket.id));
  assert.match(ticket.createdAt, ISO);
  assert.match(ticket.updatedAt, ISO);
}

function assertSorted(tickets) {
  for (let i = 1; i < tickets.length; i += 1) {
    const a = tickets[i - 1];
    const b = tickets[i];
    const ok = a.updatedAt > b.updatedAt || (a.updatedAt === b.updatedAt && a.id > b.id);
    assert.ok(ok, `ordering violated between ids ${a.id} and ${b.id}`);
  }
}

async function assertSummaryConsistent(base, expected) {
  const { status, json } = await http(base, 'GET', '/api/summary');
  assert.equal(status, 200);
  assert.deepEqual(json, expected);
  assert.equal(json.total, json.open + json.in_progress + json.resolved);
}

before(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'campusfix-acceptance-'));
});

after(async () => {
  for (const app of apps) await app.stop();
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('end-to-end ticket workflow over HTTP', () => {
  let base;
  let dbPath;
  const created = {};

  before(async () => {
    dbPath = join(tmpRoot, 'workflow.db');
    ({ url: base } = await startApp(dbPath));
  });

  test('health endpoint reports ok and the summary starts empty', async () => {
    const { status, json } = await http(base, 'GET', '/health');
    assert.equal(status, 200);
    assert.deepEqual(json, { status: 'ok' });
    await assertSummaryConsistent(base, { total: 0, open: 0, in_progress: 0, resolved: 0 });
    const list = await http(base, 'GET', '/api/tickets');
    assert.deepEqual(list.json, { tickets: [], total: 0 });
  });

  test('create: POST /api/tickets returns an open, unassigned ticket', async () => {
    const input = {
      title: '  Projector bulb blown in Hall B  ',
      description: 'The ceiling PROJECTOR shows a black picture; the lamp indicator is red.',
      category: 'equipment',
      priority: 'high',
      ignoredExtra: 'x',
    };
    const { status, json, res } = await http(base, 'POST', '/api/tickets', input);
    assert.equal(status, 201);
    assert.match(res.headers.get('content-type'), /^application\/json/);
    assertTicketShape(json.ticket);
    assert.equal(json.ticket.title, 'Projector bulb blown in Hall B');
    assert.equal(json.ticket.category, 'equipment');
    assert.equal(json.ticket.priority, 'high');
    assert.equal(json.ticket.status, 'open');
    assert.equal(json.ticket.assignedTo, null);
    assert.equal(json.ticket.createdAt, json.ticket.updatedAt);
    created.projector = json.ticket;

    const b = await http(base, 'POST', '/api/tickets', {
      title: 'Corridor lights flicker',
      description: 'Lights on level 2 flicker; maybe a projector circuit is shared.',
      category: 'facilities',
      priority: 'low',
    });
    assert.equal(b.status, 201);
    created.lights = b.json.ticket;

    const c = await http(base, 'POST', '/api/tickets', {
      title: 'Wi-Fi down in Annex',
      description: 'No wireless signal on the ground floor.',
      category: 'network',
      priority: 'high',
    });
    assert.equal(c.status, 201);
    created.wifi = c.json.ticket;

    assert.ok(created.projector.id < created.lights.id && created.lights.id < created.wifi.id);
    await assertSummaryConsistent(base, { total: 3, open: 3, in_progress: 0, resolved: 0 });
  });

  test('find: search matches title OR description case-insensitively', async () => {
    const byTitle = await http(base, 'GET', '/api/tickets?q=WI-FI');
    assert.equal(byTitle.status, 200);
    assert.deepEqual(byTitle.json.tickets.map((t) => t.id), [created.wifi.id]);
    assert.equal(byTitle.json.total, 1);

    // "projector" is in the title of one ticket and only in the description of another.
    const both = await http(base, 'GET', '/api/tickets?q=PrOjEcToR');
    assert.deepEqual(
      both.json.tickets.map((t) => t.id).sort((x, y) => x - y),
      [created.projector.id, created.lights.id].sort((x, y) => x - y),
    );
    assert.equal(both.json.total, 2);
    assertSorted(both.json.tickets);

    const descOnly = await http(base, 'GET', '/api/tickets?q=lamp%20indicator');
    assert.deepEqual(descOnly.json.tickets.map((t) => t.id), [created.projector.id]);

    const none = await http(base, 'GET', '/api/tickets?q=zzz-no-match');
    assert.deepEqual(none.json, { tickets: [], total: 0 });

    const wildcard = await http(base, 'GET', '/api/tickets?q=%25');
    assert.deepEqual(wildcard.json, { tickets: [], total: 0 });
  });

  test('find: q, status, priority and category filters are AND-combined', async () => {
    const q = (qs) => http(base, 'GET', `/api/tickets?${qs}`).then((r) => r.json.tickets.map((t) => t.id));

    assert.deepEqual(await q('priority=high'), [created.wifi.id, created.projector.id]);
    assert.deepEqual(await q('category=facilities'), [created.lights.id]);
    assert.deepEqual(await q('priority=high&category=network'), [created.wifi.id]);
    assert.deepEqual(await q('priority=high&category=facilities'), []);
    assert.deepEqual(await q('q=projector&priority=high'), [created.projector.id]);
    assert.deepEqual(await q('q=projector&priority=low&category=facilities'), [created.lights.id]);
    assert.deepEqual(await q('q=projector&priority=low&category=equipment'), []);
    assert.deepEqual(await q('status=resolved'), []);
    assert.equal((await q('status=open')).length, 3);
    assert.deepEqual(await q('q=&status=&priority=&category='), (await q('')));
    assert.equal((await q('')).length, 3);

    const bad = await http(base, 'GET', '/api/tickets?status=closed');
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error.code, 'validation_error');
    assert.ok(bad.json.error.fields.status);
  });

  test('assign: PATCH assignedTo sets the technician and refreshes updatedAt', async () => {
    await new Promise((r) => setTimeout(r, 5));
    const { status, json } = await http(base, 'PATCH', `/api/tickets/${created.projector.id}`, {
      assignedTo: '  Avery Chen ',
    });
    assert.equal(status, 200);
    assertTicketShape(json.ticket);
    assert.equal(json.ticket.assignedTo, 'Avery Chen');
    assert.equal(json.ticket.status, 'open');
    assert.ok(json.ticket.updatedAt > created.projector.updatedAt);
    assert.equal(json.ticket.createdAt, created.projector.createdAt);
    created.projector = json.ticket;

    await assertSummaryConsistent(base, { total: 3, open: 3, in_progress: 0, resolved: 0 });
  });

  test('change status: open -> in_progress -> resolved keeps summary counts consistent', async () => {
    await new Promise((r) => setTimeout(r, 5));
    const first = await http(base, 'PATCH', `/api/tickets/${created.projector.id}`, {
      status: 'in_progress',
    });
    assert.equal(first.status, 200);
    assert.equal(first.json.ticket.status, 'in_progress');
    assert.equal(first.json.ticket.assignedTo, 'Avery Chen');
    assert.ok(first.json.ticket.updatedAt > created.projector.updatedAt);
    await assertSummaryConsistent(base, { total: 3, open: 2, in_progress: 1, resolved: 0 });

    await new Promise((r) => setTimeout(r, 5));
    const second = await http(base, 'PATCH', `/api/tickets/${created.lights.id}`, { status: 'resolved' });
    assert.equal(second.status, 200);
    assert.equal(second.json.ticket.status, 'resolved');
    await assertSummaryConsistent(base, { total: 3, open: 1, in_progress: 1, resolved: 1 });

    const filtered = await http(base, 'GET', '/api/tickets?status=in_progress');
    assert.deepEqual(filtered.json.tickets.map((t) => t.id), [created.projector.id]);
    const combined = await http(base, 'GET', '/api/tickets?status=resolved&category=facilities&q=lights');
    assert.deepEqual(combined.json.tickets.map((t) => t.id), [created.lights.id]);
    created.projector = first.json.ticket;
    created.lights = second.json.ticket;

    // Unassign with null.
    const un = await http(base, 'PATCH', `/api/tickets/${created.wifi.id}`, { assignedTo: 'Priya Raman' });
    assert.equal(un.json.ticket.assignedTo, 'Priya Raman');
    const un2 = await http(base, 'PATCH', `/api/tickets/${created.wifi.id}`, { assignedTo: null });
    assert.equal(un2.json.ticket.assignedTo, null);
    created.wifi = un2.json.ticket;
  });

  test('comment: POST adds a comment and refreshes the ticket updatedAt', async () => {
    const before = (await http(base, 'GET', `/api/tickets/${created.wifi.id}`)).json.ticket;
    await new Promise((r) => setTimeout(r, 5));
    const first = await http(base, 'POST', `/api/tickets/${created.wifi.id}/comments`, {
      body: '  Checked the access point; rebooting tonight.  ',
    });
    assert.equal(first.status, 201);
    assert.deepEqual(Object.keys(first.json.comment).sort(), [...COMMENT_FIELDS].sort());
    assert.equal(first.json.comment.ticketId, created.wifi.id);
    assert.equal(first.json.comment.body, 'Checked the access point; rebooting tonight.');
    assert.match(first.json.comment.createdAt, ISO);

    await new Promise((r) => setTimeout(r, 5));
    const second = await http(base, 'POST', `/api/tickets/${created.wifi.id}/comments`, {
      body: 'Reboot done, monitoring.',
    });
    assert.equal(second.status, 201);
    assert.ok(second.json.comment.id > first.json.comment.id);
    created.wifiComments = [first.json.comment, second.json.comment];

    const after = (await http(base, 'GET', `/api/tickets/${created.wifi.id}`)).json.ticket;
    assert.ok(after.updatedAt > before.updatedAt);
    created.wifi = after;
    await assertSummaryConsistent(base, { total: 3, open: 1, in_progress: 1, resolved: 1 });
  });

  test('reload: GET ticket returns comments in order; list is ordered updatedAt desc, id desc', async () => {
    const detail = await http(base, 'GET', `/api/tickets/${created.wifi.id}`);
    assert.equal(detail.status, 200);
    assert.deepEqual(detail.json.ticket, created.wifi);
    assert.deepEqual(detail.json.comments, created.wifiComments);

    const empty = await http(base, 'GET', `/api/tickets/${created.projector.id}`);
    assert.deepEqual(empty.json.comments, []);
    assert.deepEqual(empty.json.ticket, created.projector);

    const list = await http(base, 'GET', '/api/tickets');
    assert.equal(list.json.total, 3);
    assert.equal(list.json.tickets.length, 3);
    list.json.tickets.forEach(assertTicketShape);
    assertSorted(list.json.tickets);
    // The commented ticket was touched last, so it must be first.
    assert.equal(list.json.tickets[0].id, created.wifi.id);
    const byId = Object.fromEntries(list.json.tickets.map((t) => [t.id, t]));
    assert.deepEqual(byId[created.projector.id], created.projector);
    assert.deepEqual(byId[created.lights.id], created.lights);
    assert.deepEqual(byId[created.wifi.id], created.wifi);
  });

  test('validation failures return 400 validation_error with per-field messages', async () => {
    const blankTitle = await http(base, 'POST', '/api/tickets', {
      title: '   \t ',
      description: 'ok',
      category: 'network',
      priority: 'low',
    });
    assert.equal(blankTitle.status, 400);
    assert.equal(blankTitle.json.error.code, 'validation_error');
    assert.equal(typeof blankTitle.json.error.message, 'string');
    assert.equal(typeof blankTitle.json.error.fields.title, 'string');

    const badEnums = await http(base, 'POST', '/api/tickets', {
      title: 'x',
      description: 'y',
      category: 'plumbing',
      priority: 'URGENT',
    });
    assert.equal(badEnums.status, 400);
    assert.equal(badEnums.json.error.code, 'validation_error');
    assert.ok(badEnums.json.error.fields.category);
    assert.ok(badEnums.json.error.fields.priority);

    const wrongType = await http(base, 'POST', '/api/tickets', {
      title: 5,
      description: 'y',
      category: 'network',
      priority: 'low',
    });
    assert.equal(wrongType.status, 400);
    assert.ok(wrongType.json.error.fields.title);

    const badStatus = await http(base, 'PATCH', `/api/tickets/${created.wifi.id}`, { status: 'closed' });
    assert.equal(badStatus.status, 400);
    assert.equal(badStatus.json.error.code, 'validation_error');
    assert.ok(badStatus.json.error.fields.status);

    const emptyPatch = await http(base, 'PATCH', `/api/tickets/${created.wifi.id}`, {});
    assert.equal(emptyPatch.status, 400);
    assert.equal(emptyPatch.json.error.code, 'validation_error');

    const blankComment = await http(base, 'POST', `/api/tickets/${created.wifi.id}/comments`, { body: '  ' });
    assert.equal(blankComment.status, 400);
    assert.equal(blankComment.json.error.code, 'validation_error');
    assert.ok(blankComment.json.error.fields.body);

    const badJson = await http(base, 'POST', '/api/tickets', '{not json');
    assert.equal(badJson.status, 400);
    assert.equal(badJson.json.error.code, 'invalid_json');

    // Nothing above may have changed state.
    await assertSummaryConsistent(base, { total: 3, open: 1, in_progress: 1, resolved: 1 });
    const detail = await http(base, 'GET', `/api/tickets/${created.wifi.id}`);
    assert.deepEqual(detail.json.ticket, created.wifi);
    assert.equal(detail.json.comments.length, 2);
  });

  test('unknown ids and routes return 404 not_found; wrong methods return 405', async () => {
    for (const [method, path, body] of [
      ['GET', '/api/tickets/99999'],
      ['GET', '/api/tickets/abc'],
      ['PATCH', '/api/tickets/99999', { status: 'resolved' }],
      ['POST', '/api/tickets/99999/comments', { body: 'hello' }],
      ['GET', '/api/nope'],
    ]) {
      const r = await http(base, method, path, body);
      assert.equal(r.status, 404, `${method} ${path}`);
      assert.equal(r.json.error.code, 'not_found', `${method} ${path}`);
      assert.equal(typeof r.json.error.message, 'string');
    }
    const wrong = await http(base, 'DELETE', '/api/tickets');
    assert.equal(wrong.status, 405);
    assert.equal(wrong.json.error.code, 'method_not_allowed');
  });

  test('restart: stopping the app and reopening the same DB retains all data', async () => {
    const beforeList = (await http(base, 'GET', '/api/tickets')).json;
    const beforeDetail = (await http(base, 'GET', `/api/tickets/${created.wifi.id}`)).json;
    const beforeSummary = (await http(base, 'GET', '/api/summary')).json;

    const oldApp = apps.find((a) => a.server.listening && `http://127.0.0.1:${a.server.address().port}` === base);
    assert.ok(oldApp, 'running app for this DB must be found');
    await oldApp.stop();
    await assert.rejects(() => fetch(`${base}/health`), 'server must be unreachable after stop()');
    await oldApp.stop(); // idempotent

    const reopened = await startApp(dbPath);
    assert.notEqual(reopened.url, undefined);
    const afterList = (await http(reopened.url, 'GET', '/api/tickets')).json;
    const afterDetail = (await http(reopened.url, 'GET', `/api/tickets/${created.wifi.id}`)).json;
    const afterSummary = (await http(reopened.url, 'GET', '/api/summary')).json;
    assert.deepEqual(afterList, beforeList);
    assert.deepEqual(afterDetail, beforeDetail);
    assert.deepEqual(afterSummary, beforeSummary);
    assert.deepEqual(afterSummary, { total: 3, open: 1, in_progress: 1, resolved: 1 });
    assert.deepEqual(afterDetail.comments, created.wifiComments);

    // And it still accepts writes with ids that continue the sequence.
    const next = await http(reopened.url, 'POST', '/api/tickets', {
      title: 'After restart',
      description: 'created after the restart',
      category: 'facilities',
      priority: 'medium',
    });
    assert.equal(next.status, 201);
    assert.ok(next.json.ticket.id > created.wifi.id);
    await assertSummaryConsistent(reopened.url, { total: 4, open: 2, in_progress: 1, resolved: 1 });
  });
});

describe('static assets', () => {
  let base;

  before(async () => {
    ({ url: base } = await startApp(join(tmpRoot, 'static.db')));
  });

  test('GET / serves the HTML page containing every DOM id from the contract', async () => {
    const r = await http(base, 'GET', '/');
    assert.equal(r.status, 200);
    assert.match(r.res.headers.get('content-type'), /^text\/html/);
    assert.match(r.text, /<!doctype html>/i);
    for (const [name, id] of Object.entries(DOM_IDS)) {
      assert.ok(r.text.includes(`id="${id}"`), `index.html is missing id="${id}" (${name})`);
    }
    assert.match(r.text, /\/styles\.css/);
    assert.match(r.text, /\/app\.js/);
  });

  test('scripts, stylesheet and shared contract are served with proper content types', async () => {
    const expectations = [
      ['/app.js', /^text\/javascript/, /import/],
      ['/api.js', /^text\/javascript/, /createClient/],
      ['/view-model.js', /^text\/javascript/, /export/],
      ['/styles.css', /^text\/css/, /\{/],
      ['/shared/contract.js', /^text\/javascript/, /DOM_IDS/],
    ];
    for (const [path, type, content] of expectations) {
      const r = await http(base, 'GET', path);
      assert.equal(r.status, 200, path);
      assert.match(r.res.headers.get('content-type'), type, path);
      assert.match(r.text, content, path);
    }
    const head = await fetch(`${base}/app.js`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
  });

  test('misses and path traversal return a 404 JSON not_found error', async () => {
    for (const path of [
      '/nope.js',
      '/../package.json',
      '/%2e%2e/package.json',
      '/%2e%2e%2fpackage.json',
      '/shared/../package.json',
      '/shared/%2e%2e/server/main.js',
      '/server/main.js',
      '/package.json',
      '/.git/config',
    ]) {
      const r = await http(base, 'GET', path);
      assert.equal(r.status, 404, path);
      assert.equal(r.json?.error?.code, 'not_found', path);
    }
    const post = await http(base, 'POST', '/app.js', {});
    assert.equal(post.status, 405);
  });
});

describe('seeding', () => {
  test('seed(store) twice on a temp DB yields 24 tickets and inserts nothing the second time', async () => {
    const dbPath = join(tmpRoot, 'seed-only.db');
    const store = openStore(dbPath);
    try {
      assert.equal(SEED_TICKETS.length, 24);
      const first = seed(store);
      assert.equal(first.inserted, 24);
      assert.equal(first.skipped, 0);
      assert.equal(store.listTickets({}).length, 24);
      const second = seed(store);
      assert.equal(second.inserted, 0);
      assert.equal(second.skipped, 24);
      assert.equal(store.listTickets({}).length, 24);
      assert.equal(store.getSummary().total, 24);
    } finally {
      store.close();
    }
  });

  test('the app serves seeded data covering all categories, priorities and statuses', async () => {
    const dbPath = join(tmpRoot, 'seeded-app.db');
    const store = openStore(dbPath);
    try {
      assert.equal(seed(store).inserted, 24);
      assert.equal(seed(store).inserted, 0);
    } finally {
      store.close();
    }
    const { url } = await startApp(dbPath);

    const list = await http(url, 'GET', '/api/tickets');
    assert.equal(list.status, 200);
    assert.equal(list.json.total, 24);
    assert.equal(list.json.tickets.length, 24);
    list.json.tickets.forEach(assertTicketShape);
    assertSorted(list.json.tickets);
    assert.equal(new Set(list.json.tickets.map((t) => t.title)).size, 24);
    assert.deepEqual([...new Set(list.json.tickets.map((t) => t.category))].sort(), [...CATEGORIES].sort());
    assert.deepEqual([...new Set(list.json.tickets.map((t) => t.priority))].sort(), [...PRIORITIES].sort());
    assert.deepEqual([...new Set(list.json.tickets.map((t) => t.status))].sort(), [...STATUSES].sort());

    const summary = (await http(url, 'GET', '/api/summary')).json;
    const count = (s) => list.json.tickets.filter((t) => t.status === s).length;
    assert.deepEqual(summary, {
      total: 24,
      open: count('open'),
      in_progress: count('in_progress'),
      resolved: count('resolved'),
    });
    assert.equal(summary.total, summary.open + summary.in_progress + summary.resolved);

    // Seeded comments are reachable through the ticket detail endpoint.
    const withComments = SEED_TICKETS.filter((t) => (t.comments ?? []).length > 0);
    assert.ok(withComments.length > 0);
    for (const seedTicket of withComments) {
      const ticket = list.json.tickets.find((t) => t.title === seedTicket.title);
      assert.ok(ticket, seedTicket.title);
      const detail = await http(url, 'GET', `/api/tickets/${ticket.id}`);
      assert.deepEqual(detail.json.comments.map((c) => c.body), seedTicket.comments);
    }

    // Filters work against the seeded data and agree with the full list.
    for (const category of CATEGORIES) {
      const r = await http(url, 'GET', `/api/tickets?category=${category}`);
      assert.deepEqual(
        r.json.tickets.map((t) => t.id),
        list.json.tickets.filter((t) => t.category === category).map((t) => t.id),
      );
    }
    const combo = await http(url, 'GET', '/api/tickets?priority=high&status=open');
    assert.deepEqual(
      combo.json.tickets.map((t) => t.id),
      list.json.tickets.filter((t) => t.priority === 'high' && t.status === 'open').map((t) => t.id),
    );
    const search = await http(url, 'GET', '/api/tickets?q=WI-FI');
    assert.ok(search.json.total >= 1);
    for (const t of search.json.tickets) {
      assert.ok(/wi-fi/i.test(`${t.title} ${t.description}`));
    }
  });
});

describe('browser client (public/api.js) against the live app', () => {
  let client;
  let base;

  before(async () => {
    ({ url: base } = await startApp(join(tmpRoot, 'client.db')));
    client = createClient({ baseUrl: base });
  });

  test('create, list with filters, update, comment, get and summarise through the client', async () => {
    const { ticket } = await client.createTicket({
      title: 'Broken door closer',
      description: 'The fire door on level 1 slams shut.',
      category: 'facilities',
      priority: 'medium',
    });
    assert.equal(ticket.status, 'open');
    assert.equal(ticket.assignedTo, null);
    assert.deepEqual(await client.getSummary(), { total: 1, open: 1, in_progress: 0, resolved: 0 });

    await client.createTicket({
      title: 'Router offline',
      description: 'Closet router on level 1 has no power.',
      category: 'network',
      priority: 'high',
    });

    const found = await client.listTickets({ q: 'DOOR', category: 'facilities', priority: 'medium', status: 'open' });
    assert.equal(found.total, 1);
    assert.equal(found.tickets[0].id, ticket.id);
    const level = await client.listTickets({ q: 'level 1' });
    assert.equal(level.total, 2);
    assert.equal((await client.listTickets({ q: '', status: '' })).total, 2);
    assert.equal((await client.listTickets({ q: 'door', priority: 'high' })).total, 0);

    const assigned = await client.updateTicket(ticket.id, { assignedTo: 'Sam Whitlock', status: 'in_progress' });
    assert.equal(assigned.ticket.assignedTo, 'Sam Whitlock');
    assert.equal(assigned.ticket.status, 'in_progress');
    assert.deepEqual(await client.getSummary(), { total: 2, open: 1, in_progress: 1, resolved: 0 });

    const { comment } = await client.addComment(ticket.id, 'Parts ordered.');
    assert.equal(comment.ticketId, ticket.id);
    assert.equal(comment.body, 'Parts ordered.');

    const detail = await client.getTicket(ticket.id);
    assert.equal(detail.ticket.id, ticket.id);
    assert.equal(detail.ticket.status, 'in_progress');
    assert.ok(detail.ticket.updatedAt >= assigned.ticket.updatedAt);
    assert.deepEqual(detail.comments, [comment]);
    assert.equal((await client.listTickets({})).tickets[0].id, ticket.id);
  });

  test('client rejects with ApiError carrying status, code and fields', async () => {
    await assert.rejects(
      () => client.createTicket({ title: '  ', description: 'd', category: 'x', priority: 'low' }),
      (err) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.status, 400);
        assert.equal(err.code, 'validation_error');
        assert.ok(err.fields.title);
        assert.ok(err.fields.category);
        return true;
      },
    );
    await assert.rejects(
      () => client.getTicket(424242),
      (err) => err instanceof ApiError && err.status === 404 && err.code === 'not_found',
    );
    await assert.rejects(
      () => client.addComment(424242, 'hi'),
      (err) => err instanceof ApiError && err.status === 404 && err.code === 'not_found',
    );
    await assert.rejects(
      () => client.listTickets({ status: 'bogus' }),
      (err) => err instanceof ApiError && err.status === 400 && err.code === 'validation_error',
    );
  });

  test('client reports network failures as ApiError network_error with status 0', async () => {
    const dead = await startApp(join(tmpRoot, 'dead.db'));
    const deadClient = createClient({ baseUrl: dead.url });
    await dead.app.stop();
    await assert.rejects(
      () => deadClient.getSummary(),
      (err) => err instanceof ApiError && err.status === 0 && err.code === 'network_error',
    );
  });
});
