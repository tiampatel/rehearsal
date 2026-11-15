import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, ApiError, buildQuery } from '../public/api.js';

function fakeFetch(status, payload, { raw } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const text = raw !== undefined ? raw : JSON.stringify(payload);
    return { ok: status >= 200 && status < 300, status, text: async () => text };
  };
  impl.calls = calls;
  return impl;
}

test('listTickets omits empty filters and encodes values', async () => {
  const f = fakeFetch(200, { tickets: [], total: 0 });
  const c = createClient({ fetchImpl: f });
  const res = await c.listTickets({ q: ' a&b c ', status: '', priority: undefined, category: 'network' });
  assert.deepEqual(res, { tickets: [], total: 0 });
  assert.equal(f.calls[0].url, '/api/tickets?q=a%26b+c&category=network');
  assert.equal(f.calls[0].init.method, 'GET');
  assert.equal(f.calls[0].init.body, undefined);
});

test('listTickets with no filters has no query string; baseUrl is prefixed', async () => {
  const f = fakeFetch(200, { tickets: [], total: 0 });
  const c = createClient({ baseUrl: 'http://x:1', fetchImpl: f });
  await c.listTickets();
  await c.listTickets({ q: '', status: '' });
  assert.equal(f.calls[0].url, 'http://x:1/api/tickets');
  assert.equal(f.calls[1].url, 'http://x:1/api/tickets');
  assert.equal(buildQuery({ status: 'open', priority: 'high' }), '?status=open&priority=high');
});

test('getTicket encodes id and returns payload', async () => {
  const payload = { ticket: { id: 3 }, comments: [] };
  const f = fakeFetch(200, payload);
  const res = await createClient({ fetchImpl: f }).getTicket('3/../x');
  assert.deepEqual(res, payload);
  assert.equal(f.calls[0].url, '/api/tickets/3%2F..%2Fx');
});

test('createTicket posts JSON with content-type', async () => {
  const input = { title: 'T', description: 'D', category: 'network', priority: 'low' };
  const f = fakeFetch(201, { ticket: { id: 1, ...input } });
  const res = await createClient({ fetchImpl: f }).createTicket(input);
  assert.equal(res.ticket.id, 1);
  const { url, init } = f.calls[0];
  assert.equal(url, '/api/tickets');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(init.body), input);
});

test('updateTicket sends PATCH with patch body', async () => {
  const f = fakeFetch(200, { ticket: { id: 7, status: 'resolved' } });
  const res = await createClient({ fetchImpl: f }).updateTicket(7, { status: 'resolved', assignedTo: null });
  assert.equal(res.ticket.status, 'resolved');
  assert.equal(f.calls[0].url, '/api/tickets/7');
  assert.equal(f.calls[0].init.method, 'PATCH');
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { status: 'resolved', assignedTo: null });
});

test('addComment posts {body} to comments route', async () => {
  const f = fakeFetch(201, { comment: { id: 1, ticketId: 7, body: 'hi' } });
  const res = await createClient({ fetchImpl: f }).addComment(7, 'hi');
  assert.equal(res.comment.body, 'hi');
  assert.equal(f.calls[0].url, '/api/tickets/7/comments');
  assert.equal(f.calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { body: 'hi' });
});

test('getSummary returns counts', async () => {
  const f = fakeFetch(200, { total: 3, open: 1, in_progress: 1, resolved: 1 });
  const res = await createClient({ fetchImpl: f }).getSummary();
  assert.deepEqual(res, { total: 3, open: 1, in_progress: 1, resolved: 1 });
  assert.equal(f.calls[0].url, '/api/summary');
});

test('validation error maps to ApiError with fields', async () => {
  const f = fakeFetch(400, { error: { code: 'validation_error', message: 'Invalid', fields: { title: 'required' } } });
  await assert.rejects(createClient({ fetchImpl: f }).createTicket({}), (err) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.status, 400);
    assert.equal(err.code, 'validation_error');
    assert.equal(err.message, 'Invalid');
    assert.deepEqual(err.fields, { title: 'required' });
    return true;
  });
});

test('404 error maps to ApiError without fields', async () => {
  const f = fakeFetch(404, { error: { code: 'not_found', message: 'No such ticket' } });
  await assert.rejects(createClient({ fetchImpl: f }).getTicket(99), (err) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.status, 404);
    assert.equal(err.code, 'not_found');
    assert.equal(err.fields, undefined);
    return true;
  });
});

test('non-JSON body rejects with clear message', async () => {
  const f = fakeFetch(502, null, { raw: '<html>Bad gateway</html>' });
  await assert.rejects(createClient({ fetchImpl: f }).getSummary(), (err) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.status, 502);
    assert.equal(err.code, 'invalid_response');
    assert.match(err.message, /non-JSON/);
    return true;
  });
});

test('unexpected JSON shapes reject', async () => {
  await assert.rejects(createClient({ fetchImpl: fakeFetch(200, [1, 2]) }).getSummary(), (e) => e.code === 'invalid_response');
  await assert.rejects(createClient({ fetchImpl: fakeFetch(500, { oops: true }) }).getSummary(), (e) => e instanceof ApiError && e.status === 500 && e.code === 'invalid_response');
});

test('network failure rejects with status 0 network_error', async () => {
  const c = createClient({ fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(c.getSummary(), (err) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.status, 0);
    assert.equal(err.code, 'network_error');
    assert.match(err.message, /fetch failed/);
    return true;
  });
});
