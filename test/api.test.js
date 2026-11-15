import { test, describe, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/main.js';
import { createApiHandler } from '../server/api.js';
import { COMMENT_FIELDS, TICKET_FIELDS } from '../shared/contract.js';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const validTicket = (overrides = {}) => ({
  title: 'Projector broken in Lab 204',
  description: 'No picture from HDMI input.',
  category: 'equipment',
  priority: 'medium',
  ...overrides,
});

// Raw HTTP request with an exact request-target (fetch would normalise dot segments).
function rawRequest(baseUrl, method, target, body) {
  const { hostname, port } = new URL(baseUrl);
  return new Promise((resolveReq, rejectReq) => {
    const req = http.request({ hostname, port, method, path: target }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolveReq({ status: res.statusCode, headers: res.headers, text });
      });
    });
    req.on('error', rejectReq);
    req.end(body);
  });
}

function freePort() {
  return new Promise((resolvePort, rejectPort) => {
    const srv = net.createServer();
    srv.on('error', rejectPort);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolvePort(port));
    });
  });
}

function makeClient(baseUrl) {
  async function call(method, path, body, rawBody) {
    const init = { method, headers: {} };
    if (rawBody !== undefined) {
      init.body = rawBody;
      init.headers['Content-Type'] = 'application/json';
    } else if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(baseUrl + path, init);
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: res.status, headers: res.headers, text, json };
  }
  return {
    get: (path) => call('GET', path),
    post: (path, body) => call('POST', path, body),
    patch: (path, body) => call('PATCH', path, body),
    del: (path) => call('DELETE', path),
    call,
  };
}

describe('API over HTTP', () => {
  let dir;
  let publicDir;
  let app;
  let baseUrl;
  let api;

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'campusfix-api-'));
    publicDir = join(dir, 'public');
    mkdirSync(publicDir);
    writeFileSync(join(publicDir, 'index.html'), '<!doctype html><title>CampusFix test</title>');
    writeFileSync(join(publicDir, 'app.js'), 'export const x = 1;');
    writeFileSync(join(publicDir, 'styles.css'), 'body { margin: 0 }');
    writeFileSync(join(publicDir, 'data.json'), '{"a":1}');
    writeFileSync(join(publicDir, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    writeFileSync(join(publicDir, 'favicon.ico'), Buffer.from([0, 0, 1, 0]));
    writeFileSync(join(publicDir, '.secret'), 'hidden');
    writeFileSync(join(dir, 'outside.txt'), 'outside the public dir');
    symlinkSync(join(dir, 'outside.txt'), join(publicDir, 'link.txt'));
    mkdirSync(join(publicDir, 'sub'));
    writeFileSync(join(publicDir, 'sub', 'page.html'), '<p>sub</p>');

    app = createApp({ dbPath: join(dir, 'db', 'api.db'), publicDir });
    ({ url: baseUrl } = await app.start(0));
    api = makeClient(baseUrl);
  });

  after(async () => {
    await app.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  describe('lifecycle', () => {
    test('start(0) binds an ephemeral loopback port and reports its url', () => {
      assert.match(baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
      assert.notEqual(new URL(baseUrl).port, '4318');
    });

    test('GET /health', async () => {
      const res = await api.get('/health');
      assert.equal(res.status, 200);
      assert.deepEqual(res.json, { status: 'ok' });
      assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');
    });
  });

  describe('POST /api/tickets', () => {
    test('creates a ticket: 201, open, unassigned, createdAt == updatedAt', async () => {
      const res = await api.post('/api/tickets', validTicket({ title: '  Padded title  ', extra: 'ignored', status: 'resolved', id: 99 }));
      assert.equal(res.status, 201);
      assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');
      const { ticket } = res.json;
      assert.deepEqual(Object.keys(ticket), [...TICKET_FIELDS]);
      assert.equal(typeof ticket.id, 'number');
      assert.equal(ticket.title, 'Padded title');
      assert.equal(ticket.status, 'open');
      assert.equal(ticket.assignedTo, null);
      assert.match(ticket.createdAt, ISO);
      assert.equal(ticket.updatedAt, ticket.createdAt);
      assert.notEqual(ticket.id, 99);
      assert.equal(ticket.extra, undefined);

      const fetched = await api.get(`/api/tickets/${ticket.id}`);
      assert.deepEqual(fetched.json.ticket, ticket);
    });

    test('whitespace-only title is a validation_error with a field message', async () => {
      const res = await api.post('/api/tickets', validTicket({ title: '   \t ' }));
      assert.equal(res.status, 400);
      assert.equal(res.json.error.code, 'validation_error');
      assert.equal(typeof res.json.error.message, 'string');
      assert.deepEqual(Object.keys(res.json.error.fields), ['title']);
    });

    test('unsupported enum values and wrong types are rejected without coercion', async () => {
      const bad = await api.post('/api/tickets', validTicket({ category: 'Network', priority: 'urgent' }));
      assert.equal(bad.status, 400);
      assert.deepEqual(Object.keys(bad.json.error.fields).sort(), ['category', 'priority']);

      const types = await api.post('/api/tickets', validTicket({ title: 42, description: ['x'] }));
      assert.equal(types.status, 400);
      assert.deepEqual(Object.keys(types.json.error.fields).sort(), ['description', 'title']);
    });

    test('missing required fields and overlong fields are rejected', async () => {
      const missing = await api.post('/api/tickets', {});
      assert.equal(missing.status, 400);
      assert.deepEqual(Object.keys(missing.json.error.fields).sort(), ['category', 'description', 'priority', 'title']);

      const long = await api.post('/api/tickets', validTicket({ title: 'x'.repeat(121) }));
      assert.equal(long.status, 400);
      assert.ok(long.json.error.fields.title);

      const edge = await api.post('/api/tickets', validTicket({ title: 'x'.repeat(120), description: 'd'.repeat(2000) }));
      assert.equal(edge.status, 201);
    });

    test('rejected requests create nothing', async () => {
      const before = (await api.get('/api/summary')).json.total;
      await api.post('/api/tickets', validTicket({ title: ' ' }));
      await api.post('/api/tickets', validTicket({ priority: 'nope' }));
      assert.equal((await api.get('/api/summary')).json.total, before);
    });
  });

  describe('invalid JSON bodies', () => {
    const cases = [
      ['malformed JSON', '{"title": '],
      ['empty body', ''],
      ['a JSON array', '[1,2]'],
      ['a JSON string', '"text"'],
      ['JSON null', 'null'],
      ['a number', '5'],
    ];
    for (const [label, raw] of cases) {
      test(`POST /api/tickets with ${label} -> 400 invalid_json`, async () => {
        const res = await api.call('POST', '/api/tickets', undefined, raw);
        assert.equal(res.status, 400);
        assert.equal(res.json.error.code, 'invalid_json');
        assert.equal(typeof res.json.error.message, 'string');
      });
    }

    test('PATCH and comment endpoints also report invalid_json', async () => {
      const { ticket } = (await api.post('/api/tickets', validTicket())).json;
      const patch = await api.call('PATCH', `/api/tickets/${ticket.id}`, undefined, 'not json');
      assert.equal(patch.status, 400);
      assert.equal(patch.json.error.code, 'invalid_json');
      const comment = await api.call('POST', `/api/tickets/${ticket.id}/comments`, undefined, '[]');
      assert.equal(comment.status, 400);
      assert.equal(comment.json.error.code, 'invalid_json');
    });

    test('an oversized body is rejected with invalid_json', async () => {
      const res = await api.call('POST', '/api/tickets', undefined, JSON.stringify({ title: 'x'.repeat(200 * 1024) }));
      assert.equal(res.status, 400);
      assert.equal(res.json.error.code, 'invalid_json');
    });
  });

  describe('GET /api/tickets/:id', () => {
    test('returns the ticket with comments in creation order', async () => {
      const { ticket } = (await api.post('/api/tickets', validTicket())).json;
      await api.post(`/api/tickets/${ticket.id}/comments`, { body: 'first' });
      await api.post(`/api/tickets/${ticket.id}/comments`, { body: 'second' });
      await api.post(`/api/tickets/${ticket.id}/comments`, { body: 'third' });

      const res = await api.get(`/api/tickets/${ticket.id}`);
      assert.equal(res.status, 200);
      assert.equal(res.json.ticket.id, ticket.id);
      assert.deepEqual(res.json.comments.map((c) => c.body), ['first', 'second', 'third']);
      for (const comment of res.json.comments) {
        assert.deepEqual(Object.keys(comment), [...COMMENT_FIELDS]);
        assert.equal(comment.ticketId, ticket.id);
        assert.match(comment.createdAt, ISO);
      }
    });

    test('a ticket without comments returns an empty array', async () => {
      const { ticket } = (await api.post('/api/tickets', validTicket())).json;
      const res = await api.get(`/api/tickets/${ticket.id}`);
      assert.deepEqual(res.json.comments, []);
    });

    test('unknown and malformed ids are 404 not_found', async () => {
      for (const id of ['999999', '0', 'abc', '1.5', '-1', '1e3', '99999999999999999999']) {
        const res = await api.get(`/api/tickets/${id}`);
        assert.equal(res.status, 404, `id ${id}`);
        assert.equal(res.json.error.code, 'not_found', `id ${id}`);
      }
    });
  });

  describe('PATCH /api/tickets/:id', () => {
    test('updates status, assignee and priority and refreshes updatedAt', async () => {
      const { ticket } = (await api.post('/api/tickets', validTicket())).json;
      await sleep(5);
      const res = await api.patch(`/api/tickets/${ticket.id}`, {
        status: 'in_progress',
        assignedTo: '  Priya Raman ',
        priority: 'high',
        title: 'ignored change',
      });
      assert.equal(res.status, 200);
      assert.equal(res.json.ticket.status, 'in_progress');
      assert.equal(res.json.ticket.assignedTo, 'Priya Raman');
      assert.equal(res.json.ticket.priority, 'high');
      assert.equal(res.json.ticket.title, ticket.title);
      assert.equal(res.json.ticket.createdAt, ticket.createdAt);
      assert.ok(Date.parse(res.json.ticket.updatedAt) > Date.parse(ticket.updatedAt));
      assert.deepEqual((await api.get(`/api/tickets/${ticket.id}`)).json.ticket, res.json.ticket);
    });

    test('assignedTo null unassigns', async () => {
      const { ticket } = (await api.post('/api/tickets', validTicket())).json;
      await api.patch(`/api/tickets/${ticket.id}`, { assignedTo: 'Sam Whitlock' });
      const res = await api.patch(`/api/tickets/${ticket.id}`, { assignedTo: null });
      assert.equal(res.status, 200);
      assert.equal(res.json.ticket.assignedTo, null);
    });

    test('empty body, unrecognised fields only, and invalid values are 400 validation_error', async () => {
      const { ticket } = (await api.post('/api/tickets', validTicket())).json;
      const url = `/api/tickets/${ticket.id}`;
      for (const body of [{}, { title: 'nope' }, { status: 'closed' }, { priority: 'urgent' }, { assignedTo: '   ' }, { assignedTo: 5 }]) {
        const res = await api.patch(url, body);
        assert.equal(res.status, 400, JSON.stringify(body));
        assert.equal(res.json.error.code, 'validation_error', JSON.stringify(body));
        assert.ok(res.json.error.fields, JSON.stringify(body));
      }
      assert.deepEqual((await api.get(url)).json.ticket, ticket);
    });

    test('unknown or malformed id is 404', async () => {
      assert.equal((await api.patch('/api/tickets/987654', { status: 'resolved' })).status, 404);
      const res = await api.patch('/api/tickets/abc', { status: 'resolved' });
      assert.equal(res.status, 404);
      assert.equal(res.json.error.code, 'not_found');
    });
  });

  describe('POST /api/tickets/:id/comments', () => {
    test('adds a trimmed comment and refreshes the ticket updatedAt', async () => {
      const { ticket } = (await api.post('/api/tickets', validTicket())).json;
      await sleep(5);
      const res = await api.post(`/api/tickets/${ticket.id}/comments`, { body: '  Technician on the way  ', ticketId: 12345 });
      assert.equal(res.status, 201);
      assert.deepEqual(Object.keys(res.json.comment), [...COMMENT_FIELDS]);
      assert.equal(res.json.comment.body, 'Technician on the way');
      assert.equal(res.json.comment.ticketId, ticket.id);

      const after = (await api.get(`/api/tickets/${ticket.id}`)).json.ticket;
      assert.equal(after.updatedAt, res.json.comment.createdAt);
      assert.ok(Date.parse(after.updatedAt) > Date.parse(ticket.updatedAt));
    });

    test('invalid bodies are 400 validation_error and store nothing', async () => {
      const { ticket } = (await api.post('/api/tickets', validTicket())).json;
      const url = `/api/tickets/${ticket.id}/comments`;
      for (const body of [{}, { body: '   ' }, { body: 7 }, { body: 'x'.repeat(1001) }]) {
        const res = await api.post(url, body);
        assert.equal(res.status, 400);
        assert.equal(res.json.error.code, 'validation_error');
        assert.ok(res.json.error.fields.body);
      }
      assert.deepEqual((await api.get(`/api/tickets/${ticket.id}`)).json.comments, []);
    });

    test('unknown ticket is 404 not_found', async () => {
      const res = await api.post('/api/tickets/424242/comments', { body: 'hello' });
      assert.equal(res.status, 404);
      assert.equal(res.json.error.code, 'not_found');
      assert.equal((await api.post('/api/tickets/abc/comments', { body: 'hello' })).status, 404);
    });
  });

  describe('search, filters and ordering (GET /api/tickets)', () => {
    let fixtures; // isolated app so earlier tests do not interfere
    let fx;

    before(async () => {
      fixtures = createApp({ dbPath: join(dir, 'filters.db'), publicDir });
      const { url } = await fixtures.start(0);
      fx = makeClient(url);
      const make = async (body, patch) => {
        const { ticket } = (await fx.post('/api/tickets', body)).json;
        if (patch) await fx.patch(`/api/tickets/${ticket.id}`, patch);
        await sleep(3);
        return ticket.id;
      };
      fixtures.ids = {
        projector: await make({ title: 'Projector broken in Lab 204', description: 'No picture.', category: 'equipment', priority: 'medium' }),
        wifi: await make({ title: 'Wi-Fi drops', description: 'The projector room loses Wi-Fi.', category: 'network', priority: 'high' }, { status: 'in_progress' }),
        leak: await make({ title: 'Roof leak', description: 'Water in corridor B, 100% wet', category: 'facilities', priority: 'high' }, { status: 'resolved', assignedTo: 'Mateo Alvarez' }),
        printer: await make({ title: 'Printer jam', description: 'queue_stuck on level 2', category: 'equipment', priority: 'low' }),
      };
    });

    after(async () => {
      await fixtures.stop();
    });

    const ids = async (query) => {
      const res = await fx.get(`/api/tickets${query}`);
      assert.equal(res.status, 200, query);
      assert.equal(res.json.total, res.json.tickets.length, query);
      return res.json.tickets.map((t) => t.id);
    };

    test('no filter returns everything, newest update first, with total', async () => {
      const { projector, wifi, leak, printer } = fixtures.ids;
      assert.deepEqual(await ids(''), [printer, leak, wifi, projector]);
      // a comment moves a ticket to the top
      await fx.post(`/api/tickets/${projector}/comments`, { body: 'bump' });
      assert.deepEqual(await ids(''), [projector, printer, leak, wifi]);
      // updating it back restores relative order for the rest
      await sleep(3);
      await fx.patch(`/api/tickets/${wifi}`, { priority: 'high' });
      assert.deepEqual(await ids(''), [wifi, projector, printer, leak]);
    });

    test('q searches title OR description, case-insensitively, trimmed', async () => {
      const { projector, wifi } = fixtures.ids;
      const found = new Set(await ids('?q=PROJECTOR'));
      assert.deepEqual(found, new Set([projector, wifi]));
      assert.deepEqual(await ids('?q=%20%20lab%20204%20'), [projector]);
      assert.deepEqual(await ids('?q=corridor'), [fixtures.ids.leak]);
      assert.deepEqual(await ids('?q=lab%20broken'), []);
      assert.deepEqual(await ids('?q=zzz-nothing'), []);
    });

    test('LIKE wildcards in q match literally', async () => {
      assert.deepEqual(await ids('?q=100%25'), [fixtures.ids.leak]);
      assert.deepEqual(await ids('?q=%25'), [fixtures.ids.leak]);
      assert.deepEqual(await ids('?q=queue_stuck'), [fixtures.ids.printer]);
      assert.deepEqual(await ids('?q=queue-stuck'), []);
      assert.deepEqual(await ids('?q=P%25r'), []);
    });

    test('status, priority and category filter exactly and combine with AND', async () => {
      const { projector, wifi, leak, printer } = fixtures.ids;
      assert.deepEqual(new Set(await ids('?status=open')), new Set([projector, printer]));
      assert.deepEqual(await ids('?status=in_progress'), [wifi]);
      assert.deepEqual(new Set(await ids('?priority=high')), new Set([wifi, leak]));
      assert.deepEqual(new Set(await ids('?category=equipment')), new Set([projector, printer]));
      assert.deepEqual(await ids('?category=equipment&priority=low'), [printer]);
      assert.deepEqual(await ids('?category=equipment&priority=high'), []);
      assert.deepEqual(await ids('?q=projector&category=network'), [wifi]);
      assert.deepEqual(await ids('?q=projector&status=open&priority=medium&category=equipment'), [projector]);
      assert.deepEqual(await ids('?priority=high&status=resolved'), [leak]);
    });

    test('empty-string parameters are treated as not provided', async () => {
      assert.equal((await ids('?q=&status=&priority=&category=')).length, 4);
      assert.deepEqual(await ids('?q=%20%20&status=open&priority=low'), [fixtures.ids.printer]);
    });

    test('unsupported status/priority/category values are 400 validation_error', async () => {
      for (const query of ['?status=closed', '?priority=urgent', '?category=plumbing', '?status=OPEN']) {
        const res = await fx.get(`/api/tickets${query}`);
        assert.equal(res.status, 400, query);
        assert.equal(res.json.error.code, 'validation_error', query);
        assert.ok(Object.keys(res.json.error.fields).length >= 1, query);
      }
    });

    test('q longer than 200 characters is a validation_error; exactly 200 is fine', async () => {
      const long = await fx.get(`/api/tickets?q=${'a'.repeat(201)}`);
      assert.equal(long.status, 400);
      assert.ok(long.json.error.fields.q);
      const ok = await fx.get(`/api/tickets?q=${'a'.repeat(200)}`);
      assert.equal(ok.status, 200);
    });

    test('summary ignores filters and tracks status changes', async () => {
      const { projector } = fixtures.ids;
      const filtered = await fx.get('/api/tickets?status=resolved');
      assert.equal(filtered.json.total, 1);
      const before = (await fx.get('/api/summary')).json;
      assert.deepEqual(before, { total: 4, open: 2, in_progress: 1, resolved: 1 });
      assert.deepEqual((await fx.get('/api/summary?status=resolved')).json, before);

      await fx.patch(`/api/tickets/${projector}`, { status: 'resolved' });
      const afterOne = (await fx.get('/api/summary')).json;
      assert.deepEqual(afterOne, { total: 4, open: 1, in_progress: 1, resolved: 2 });
      assert.equal(afterOne.total, afterOne.open + afterOne.in_progress + afterOne.resolved);
      assert.equal((await fx.get('/api/tickets?status=resolved')).json.total, 2);
    });
  });

  describe('GET /api/summary', () => {
    test('returns the four counts', async () => {
      const res = await api.get('/api/summary');
      assert.equal(res.status, 200);
      assert.deepEqual(Object.keys(res.json), ['total', 'open', 'in_progress', 'resolved']);
      assert.equal(res.json.total, res.json.open + res.json.in_progress + res.json.resolved);
    });
  });

  describe('routing errors', () => {
    test('unknown API routes are 404 not_found in the error shape', async () => {
      for (const path of ['/api', '/api/', '/api/nope', '/api/tickets/1/other', '/api/tickets/1/comments/2', '/api/tickets/']) {
        const res = await api.get(path);
        assert.equal(res.status, 404, path);
        assert.equal(res.json.error.code, 'not_found', path);
        assert.equal(typeof res.json.error.message, 'string', path);
      }
    });

    test('known routes with unsupported methods are 405 method_not_allowed with Allow', async () => {
      const { ticket } = (await api.post('/api/tickets', validTicket())).json;
      const cases = [
        ['DELETE', '/api/tickets', 'GET, POST'],
        ['PUT', '/api/tickets', 'GET, POST'],
        ['DELETE', `/api/tickets/${ticket.id}`, 'GET, PATCH'],
        ['PUT', `/api/tickets/${ticket.id}`, 'GET, PATCH'],
        ['POST', `/api/tickets/${ticket.id}`, 'GET, PATCH'],
        ['GET', `/api/tickets/${ticket.id}/comments`, 'POST'],
        ['PATCH', `/api/tickets/${ticket.id}/comments`, 'POST'],
        ['POST', '/api/summary', 'GET'],
        ['POST', '/health', 'GET'],
        ['DELETE', '/health', 'GET'],
      ];
      for (const [method, path, allow] of cases) {
        const res = await api.call(method, path);
        assert.equal(res.status, 405, `${method} ${path}`);
        assert.equal(res.json.error.code, 'method_not_allowed', `${method} ${path}`);
        assert.equal(res.headers.get('allow'), allow, `${method} ${path}`);
      }
      assert.equal((await api.get(`/api/tickets/${ticket.id}`)).status, 200);
    });
  });

  describe('static files', () => {
    test('GET / serves public/index.html', async () => {
      const res = await api.get('/');
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');
      assert.match(res.text, /CampusFix test/);
    });

    test('files are served with the right content type', async () => {
      const expected = {
        '/index.html': 'text/html; charset=utf-8',
        '/app.js': 'text/javascript; charset=utf-8',
        '/styles.css': 'text/css; charset=utf-8',
        '/data.json': 'application/json; charset=utf-8',
        '/logo.svg': 'image/svg+xml',
        '/favicon.ico': 'image/x-icon',
        '/sub/page.html': 'text/html; charset=utf-8',
      };
      for (const [path, type] of Object.entries(expected)) {
        const res = await api.get(path);
        assert.equal(res.status, 200, path);
        assert.equal(res.headers.get('content-type'), type, path);
      }
      assert.equal((await api.get('/app.js')).text, 'export const x = 1;');
    });

    test('HEAD returns headers without a body; other methods are 405', async () => {
      const head = await rawRequest(baseUrl, 'HEAD', '/styles.css');
      assert.equal(head.status, 200);
      assert.equal(head.headers['content-type'], 'text/css; charset=utf-8');
      assert.equal(head.text, '');
      const post = await api.call('POST', '/app.js', {});
      assert.equal(post.status, 405);
      assert.equal(post.json.error.code, 'method_not_allowed');
      assert.equal((await api.call('DELETE', '/')).status, 405);
    });

    test('misses are 404 not_found in the JSON error shape', async () => {
      for (const path of ['/missing.js', '/sub', '/sub/', '/nothing/here.html']) {
        const res = await api.get(path);
        assert.equal(res.status, 404, path);
        assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8', path);
        assert.equal(res.json.error.code, 'not_found', path);
      }
    });

    test('path traversal, hidden files, encoded tricks and symlink escapes are rejected', async () => {
      const targets = [
        '/../outside.txt',
        '/..%2foutside.txt',
        '/%2e%2e/outside.txt',
        '/%2e%2e%2foutside.txt',
        '/sub/../../outside.txt',
        '/..\\outside.txt',
        '/%5c..%5coutside.txt',
        '/.secret',
        '/sub/%2e%2e/.secret',
        '/%00',
        '/index.html%00.js',
        '/%E0%A4%A',
        '/link.txt',
        '/shared/../package.json',
        '/shared/%2e%2e/package.json',
        '/shared/..%2fpackage.json',
        '/shared/',
        '/shared/nonexistent.js',
      ];
      for (const target of targets) {
        const res = await rawRequest(baseUrl, 'GET', target);
        assert.equal(res.status, 404, target);
        assert.ok(!res.text.includes('outside the public dir'), target);
        assert.ok(!res.text.includes('hidden'), target);
        assert.equal(JSON.parse(res.text).error.code, 'not_found', target);
      }
    });

    test('GET /shared/contract.js serves the repo shared contract and nothing else outside public/', async () => {
      const res = await api.get('/shared/contract.js');
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'text/javascript; charset=utf-8');
      assert.match(res.text, /export const STATUSES/);
      assert.equal((await api.get('/package.json')).status, 404);
      assert.equal((await api.get('/server/store.js')).status, 404);
    });
  });
});

describe('internal errors', () => {
  test('a throwing store yields a generic 500 internal_error without a stack trace', async () => {
    const secret = 'SECRET-DB-FAILURE-DETAIL';
    const brokenStore = new Proxy({}, {
      get() {
        return () => {
          throw new Error(secret);
        };
      },
    });
    const handler = createApiHandler(brokenStore);
    const server = http.createServer(async (req, res) => {
      if (!(await handler(req, res))) {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const errorLog = mock.method(console, 'error', () => {});
    try {
      const url = `http://127.0.0.1:${server.address().port}`;
      for (const path of ['/api/summary', '/api/tickets', '/api/tickets/1']) {
        const res = await fetch(url + path);
        const text = await res.text();
        assert.equal(res.status, 500, path);
        assert.equal(JSON.parse(text).error.code, 'internal_error', path);
        assert.ok(!text.includes(secret), path);
        assert.ok(!/\bat\s.+\(.+:\d+:\d+\)/.test(text), path);
      }
      assert.equal(errorLog.mock.callCount(), 3);
      const other = await fetch(`${url}/not-api`);
      assert.equal(other.status, 404);
    } finally {
      errorLog.mock.restore();
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
  });

  test('createApiHandler returns false for paths it does not own', async () => {
    const handler = createApiHandler({});
    const result = await handler({ method: 'GET', url: '/index.html' }, {});
    assert.equal(result, false);
    assert.equal(await handler({ method: 'GET', url: '/apix' }, {}), false);
  });
});

describe('persistence across restarts', () => {
  let dir;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'campusfix-api-persist-'));
  });
  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('create -> find -> assign -> status -> comment survives stop() and a new createApp', async () => {
    const dbPath = join(dir, 'data', 'persist.db');
    const publicDir = join(dir, 'public');
    mkdirSync(publicDir);

    const first = createApp({ dbPath, publicDir });
    const { url: url1 } = await first.start(0);
    const c1 = makeClient(url1);
    const { ticket } = (await c1.post('/api/tickets', validTicket({ title: 'Projector broken in Lab 204' }))).json;
    const found = (await c1.get('/api/tickets?q=projector&category=equipment')).json;
    assert.deepEqual(found.tickets.map((t) => t.id), [ticket.id]);
    await c1.patch(`/api/tickets/${ticket.id}`, { assignedTo: 'Avery Chen', status: 'in_progress' });
    await c1.post(`/api/tickets/${ticket.id}/comments`, { body: 'Bulb replaced, testing' });
    const expected = (await c1.get(`/api/tickets/${ticket.id}`)).json;
    const expectedSummary = (await c1.get('/api/summary')).json;
    assert.deepEqual(expectedSummary, { total: 1, open: 0, in_progress: 1, resolved: 0 });

    await first.stop();
    await first.stop(); // idempotent
    await assert.rejects(fetch(url1 + '/health'));
    await assert.rejects(first.start(0), /stopped/);

    const second = createApp({ dbPath, publicDir });
    try {
      const { url: url2, port } = await second.start(0);
      assert.equal(typeof port, 'number');
      const c2 = makeClient(url2);
      assert.deepEqual((await c2.get(`/api/tickets/${ticket.id}`)).json, expected);
      assert.deepEqual((await c2.get('/api/summary')).json, expectedSummary);
      const again = (await c2.get('/api/tickets?q=lab%20204&status=in_progress')).json;
      assert.deepEqual(again.tickets.map((t) => t.id), [ticket.id]);
      assert.equal(again.tickets[0].assignedTo, 'Avery Chen');
      const next = (await c2.post('/api/tickets', validTicket({ title: 'Second' }))).json.ticket;
      assert.equal(next.id, ticket.id + 1);
    } finally {
      await second.stop();
    }
  });

  test('stop() on an app that was never started closes the store and is idempotent', async () => {
    const app = createApp({ dbPath: join(dir, 'never-started.db'), publicDir: dir });
    await app.stop();
    await app.stop();
    assert.throws(() => app.store.listTickets());
  });

  test('start() twice returns the same address', async () => {
    const app = createApp({ dbPath: ':memory:', publicDir: dir });
    try {
      const a = await app.start(0);
      const b = await app.start(0);
      assert.deepEqual(a, b);
    } finally {
      await app.stop();
    }
  });

  test('start() rejects when the port is already taken', async () => {
    const blocker = http.createServer();
    await new Promise((r) => blocker.listen(0, '127.0.0.1', r));
    const app = createApp({ dbPath: ':memory:', publicDir: dir });
    try {
      await assert.rejects(app.start(blocker.address().port), (err) => err.code === 'EADDRINUSE');
    } finally {
      await app.stop();
      await new Promise((r) => blocker.close(r));
    }
  });
});

describe('npm start entry point (node server/main.js)', () => {
  test('serves on PORT with DB_PATH and shuts down cleanly on SIGTERM', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'campusfix-api-main-'));
    const port = await freePort();
    const child = spawn(process.execPath, [join(REPO_ROOT, 'server', 'main.js')], {
      cwd: dir,
      env: { ...process.env, PORT: String(port), DB_PATH: join(dir, 'data', 'main.db') },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const exited = new Promise((r) => child.on('exit', (code, signal) => r({ code, signal })));

    try {
      const deadline = Date.now() + 10000;
      while (!stdout.includes('listening') && Date.now() < deadline) {
        await sleep(50);
      }
      assert.match(stdout, new RegExp(`http://127\\.0\\.0\\.1:${port}`), `stderr: ${stderr}`);

      const base = `http://127.0.0.1:${port}`;
      assert.deepEqual(await (await fetch(`${base}/health`)).json(), { status: 'ok' });
      const created = await fetch(`${base}/api/tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validTicket()),
      });
      assert.equal(created.status, 201);
      assert.equal((await (await fetch(`${base}/api/summary`)).json()).total, 1);
    } finally {
      child.kill('SIGTERM');
    }
    const result = await exited;
    try {
      assert.deepEqual(result, { code: 0, signal: null }, `stderr: ${stderr}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('importing server/main.js does not start a server or open a database', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'campusfix-api-import-'));
    try {
      const moduleUrl = new URL('../server/main.js', import.meta.url).href;
      const child = spawn(
        process.execPath,
        ['--input-type=module', '-e', `await import(${JSON.stringify(moduleUrl)}); console.log('imported');`],
        { cwd: dir, env: { ...process.env, PORT: String(await freePort()) }, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let stdout = '';
      child.stdout.on('data', (d) => (stdout += d));
      const timer = setTimeout(() => child.kill('SIGKILL'), 8000);
      const result = await new Promise((r) => child.on('exit', (code, signal) => r({ code, signal })));
      clearTimeout(timer);
      // A server would keep the process alive until the timer killed it.
      assert.deepEqual(result, { code: 0, signal: null });
      assert.equal(stdout.trim(), 'imported');
      assert.equal(existsSync(join(dir, 'data')), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
