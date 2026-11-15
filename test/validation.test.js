import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateCreateTicket,
  validatePatchTicket,
  validateComment,
  validateListQuery,
} from '../server/validation.js';
import { LIMITS, CATEGORIES, PRIORITIES, STATUSES } from '../shared/contract.js';

const validTicket = () => ({
  title: 'Projector broken in Lab 204',
  description: 'The ceiling projector shows no signal.',
  category: 'equipment',
  priority: 'high',
});

function assertFails(result, ...fieldNames) {
  assert.equal(result.ok, false);
  assert.deepEqual(Object.keys(result.fields).sort(), [...fieldNames].sort());
  for (const message of Object.values(result.fields)) {
    assert.equal(typeof message, 'string');
    assert.ok(message.length > 0);
  }
}

describe('validateCreateTicket', () => {
  test('accepts a valid body and returns exactly the four fields', () => {
    const result = validateCreateTicket(validTicket());
    assert.deepEqual(result, { ok: true, value: validTicket() });
  });

  test('trims strings and ignores unknown extra fields', () => {
    const result = validateCreateTicket({
      ...validTicket(),
      title: '  Padded title \n',
      description: '\tPadded description  ',
      id: 99,
      status: 'resolved',
      assignedTo: 'Someone',
    });
    assert.deepEqual(result, {
      ok: true,
      value: {
        title: 'Padded title',
        description: 'Padded description',
        category: 'equipment',
        priority: 'high',
      },
    });
  });

  test('accepts every supported category and priority', () => {
    for (const category of CATEGORIES) {
      for (const priority of PRIORITIES) {
        const result = validateCreateTicket({ ...validTicket(), category, priority });
        assert.equal(result.ok, true);
        assert.equal(result.value.category, category);
        assert.equal(result.value.priority, priority);
      }
    }
  });

  test('rejects a whitespace-only title and description as empty', () => {
    assertFails(validateCreateTicket({ ...validTicket(), title: '   \t\n ' }), 'title');
    assertFails(validateCreateTicket({ ...validTicket(), description: '  ' }), 'description');
    assertFails(validateCreateTicket({ ...validTicket(), title: '' }), 'title');
  });

  test('rejects unsupported and wrongly cased enum values', () => {
    assertFails(validateCreateTicket({ ...validTicket(), category: 'plumbing' }), 'category');
    assertFails(validateCreateTicket({ ...validTicket(), category: 'Network' }), 'category');
    assertFails(validateCreateTicket({ ...validTicket(), priority: 'urgent' }), 'priority');
    assertFails(validateCreateTicket({ ...validTicket(), priority: 'HIGH' }), 'priority');
    assertFails(validateCreateTicket({ ...validTicket(), priority: ' high ' }), 'priority');
    assertFails(validateCreateTicket({ ...validTicket(), priority: '' }), 'priority');
  });

  test('rejects wrong types without coercing', () => {
    assertFails(validateCreateTicket({ ...validTicket(), title: 123 }), 'title');
    assertFails(validateCreateTicket({ ...validTicket(), title: ['a'] }), 'title');
    assertFails(validateCreateTicket({ ...validTicket(), description: { a: 1 } }), 'description');
    assertFails(validateCreateTicket({ ...validTicket(), category: 1 }), 'category');
    assertFails(validateCreateTicket({ ...validTicket(), priority: true }), 'priority');
    assertFails(validateCreateTicket({ ...validTicket(), title: null }), 'title');
  });

  test('reports every missing field at once', () => {
    assertFails(validateCreateTicket({}), 'title', 'description', 'category', 'priority');
    const partial = validateCreateTicket({ title: 'Only a title' });
    assertFails(partial, 'description', 'category', 'priority');
    assert.match(partial.fields.description, /required/);
  });

  test('enforces length limits after trimming', () => {
    const atLimit = validateCreateTicket({
      ...validTicket(),
      title: 'a'.repeat(LIMITS.title),
      description: 'b'.repeat(LIMITS.description),
    });
    assert.equal(atLimit.ok, true);

    const padded = validateCreateTicket({ ...validTicket(), title: ` ${'a'.repeat(LIMITS.title)} ` });
    assert.equal(padded.ok, true);
    assert.equal(padded.value.title.length, LIMITS.title);

    assertFails(
      validateCreateTicket({ ...validTicket(), title: 'a'.repeat(LIMITS.title + 1) }),
      'title',
    );
    assertFails(
      validateCreateTicket({ ...validTicket(), description: 'b'.repeat(LIMITS.description + 1) }),
      'description',
    );
  });

  test('returns multiple field errors together', () => {
    assertFails(
      validateCreateTicket({ title: ' ', description: 5, category: 'x', priority: 'low' }),
      'title',
      'description',
      'category',
    );
  });

  test('rejects non-object bodies without throwing', () => {
    for (const body of [null, undefined, [], [validTicket()], 'text', 42, true]) {
      const result = validateCreateTicket(body);
      assertFails(result, 'body');
      assert.match(result.fields.body, /JSON object/);
    }
  });
});

describe('validatePatchTicket', () => {
  test('accepts each recognised key on its own', () => {
    assert.deepEqual(validatePatchTicket({ status: 'in_progress' }), {
      ok: true,
      value: { status: 'in_progress' },
    });
    assert.deepEqual(validatePatchTicket({ priority: 'low' }), {
      ok: true,
      value: { priority: 'low' },
    });
    assert.deepEqual(validatePatchTicket({ assignedTo: 'Priya Raman' }), {
      ok: true,
      value: { assignedTo: 'Priya Raman' },
    });
  });

  test('accepts every status value', () => {
    for (const status of STATUSES) {
      assert.deepEqual(validatePatchTicket({ status }), { ok: true, value: { status } });
    }
  });

  test('accepts null assignedTo to unassign and keeps it distinct from absent', () => {
    const result = validatePatchTicket({ assignedTo: null });
    assert.deepEqual(result, { ok: true, value: { assignedTo: null } });
    assert.equal(Object.hasOwn(result.value, 'assignedTo'), true);
  });

  test('trims assignedTo and combines several keys', () => {
    assert.deepEqual(
      validatePatchTicket({ status: 'resolved', assignedTo: '  Avery Chen ', priority: 'medium' }),
      { ok: true, value: { status: 'resolved', assignedTo: 'Avery Chen', priority: 'medium' } },
    );
  });

  test('ignores unrecognised keys and does not copy them into the value', () => {
    const result = validatePatchTicket({
      status: 'open',
      title: 'Hijack',
      id: 5,
      createdAt: 'x',
      category: 'network',
    });
    assert.deepEqual(result, { ok: true, value: { status: 'open' } });
  });

  test('rejects an empty patch and a patch with only unrecognised keys', () => {
    assertFails(validatePatchTicket({}), 'body');
    assertFails(validatePatchTicket({ title: 'New title', description: 'x' }), 'body');
    assertFails(validatePatchTicket({ status: undefined }), 'body');
  });

  test('rejects unsupported enum values and wrong types', () => {
    assertFails(validatePatchTicket({ status: 'closed' }), 'status');
    assertFails(validatePatchTicket({ status: 'Open' }), 'status');
    assertFails(validatePatchTicket({ status: 1 }), 'status');
    assertFails(validatePatchTicket({ status: null }), 'status');
    assertFails(validatePatchTicket({ priority: 'urgent' }), 'priority');
    assertFails(validatePatchTicket({ priority: ['low'] }), 'priority');
  });

  test('rejects empty, whitespace-only, non-string and over-long assignedTo', () => {
    assertFails(validatePatchTicket({ assignedTo: '' }), 'assignedTo');
    assertFails(validatePatchTicket({ assignedTo: '   ' }), 'assignedTo');
    assertFails(validatePatchTicket({ assignedTo: 7 }), 'assignedTo');
    assertFails(validatePatchTicket({ assignedTo: {} }), 'assignedTo');
    assertFails(validatePatchTicket({ assignedTo: 'n'.repeat(LIMITS.assignedTo + 1) }), 'assignedTo');
    assert.equal(validatePatchTicket({ assignedTo: 'n'.repeat(LIMITS.assignedTo) }).ok, true);
  });

  test('a valid key does not hide an invalid one', () => {
    assertFails(validatePatchTicket({ status: 'open', priority: 'nope' }), 'priority');
  });

  test('rejects non-object bodies without throwing', () => {
    for (const body of [null, undefined, [], ['status'], 'status', 1, false]) {
      assertFails(validatePatchTicket(body), 'body');
    }
  });
});

describe('validateComment', () => {
  test('accepts and trims a comment body', () => {
    assert.deepEqual(validateComment({ body: '  Replaced the lamp.  ' }), {
      ok: true,
      value: { body: 'Replaced the lamp.' },
    });
  });

  test('ignores extra fields', () => {
    assert.deepEqual(validateComment({ body: 'ok', ticketId: 9, id: 1 }), {
      ok: true,
      value: { body: 'ok' },
    });
  });

  test('rejects missing, empty and whitespace-only bodies', () => {
    assertFails(validateComment({}), 'body');
    assertFails(validateComment({ body: '' }), 'body');
    assertFails(validateComment({ body: ' \n\t ' }), 'body');
    assertFails(validateComment({ body: null }), 'body');
  });

  test('rejects wrong types', () => {
    assertFails(validateComment({ body: 12 }), 'body');
    assertFails(validateComment({ body: ['a'] }), 'body');
    assertFails(validateComment({ body: { text: 'a' } }), 'body');
  });

  test('enforces the comment length limit after trimming', () => {
    assert.equal(validateComment({ body: ` ${'c'.repeat(LIMITS.commentBody)} ` }).ok, true);
    assertFails(validateComment({ body: 'c'.repeat(LIMITS.commentBody + 1) }), 'body');
  });

  test('non-object bodies report the body field without throwing', () => {
    for (const body of [null, undefined, [], 'hello', 3]) {
      const result = validateComment(body);
      assertFails(result, 'body');
      assert.match(result.fields.body, /JSON object/);
    }
  });
});

describe('validateListQuery', () => {
  const none = { q: undefined, status: undefined, priority: undefined, category: undefined };

  test('empty object, undefined and null give all-undefined members', () => {
    assert.deepEqual(validateListQuery({}), { ok: true, value: none });
    assert.deepEqual(validateListQuery(undefined), { ok: true, value: none });
    assert.deepEqual(validateListQuery(null), { ok: true, value: none });
    assert.deepEqual(validateListQuery(new URLSearchParams()), { ok: true, value: none });
  });

  test('accepts a plain object with all filters', () => {
    assert.deepEqual(
      validateListQuery({ q: 'projector', status: 'open', priority: 'high', category: 'equipment' }),
      { ok: true, value: { q: 'projector', status: 'open', priority: 'high', category: 'equipment' } },
    );
  });

  test('accepts URLSearchParams', () => {
    const params = new URLSearchParams('q=wifi&status=in_progress&priority=low&category=network');
    assert.deepEqual(validateListQuery(params), {
      ok: true,
      value: { q: 'wifi', status: 'in_progress', priority: 'low', category: 'network' },
    });
  });

  test('trims q and treats blank q as absent', () => {
    assert.equal(validateListQuery({ q: '   lab 204 \t' }).value.q, 'lab 204');
    assert.equal(validateListQuery({ q: '    ' }).value.q, undefined);
    assert.equal(validateListQuery(new URLSearchParams('q=%20%20spaced%20out%20')).value.q, 'spaced out');
  });

  test('empty-string parameters mean not provided', () => {
    assert.deepEqual(validateListQuery({ q: '', status: '', priority: '', category: '' }), {
      ok: true,
      value: none,
    });
    assert.deepEqual(validateListQuery(new URLSearchParams('q=&status=&priority=&category=')), {
      ok: true,
      value: none,
    });
  });

  test('unsupported enum values are errors, not empty results', () => {
    assertFails(validateListQuery({ status: 'closed' }), 'status');
    assertFails(validateListQuery({ priority: 'urgent' }), 'priority');
    assertFails(validateListQuery({ category: 'plumbing' }), 'category');
    assertFails(validateListQuery({ status: 'OPEN' }), 'status');
    assertFails(validateListQuery(new URLSearchParams('status=bogus&category=nope')), 'status', 'category');
  });

  test('q longer than the limit after trimming is an error; at the limit is fine', () => {
    assert.equal(validateListQuery({ q: 'a'.repeat(LIMITS.searchQuery) }).ok, true);
    assert.equal(validateListQuery({ q: ` ${'a'.repeat(LIMITS.searchQuery)} ` }).ok, true);
    assertFails(validateListQuery({ q: 'a'.repeat(LIMITS.searchQuery + 1) }), 'q');
  });

  test('wrong member types are errors without coercion', () => {
    assertFails(validateListQuery({ q: 5 }), 'q');
    assertFails(validateListQuery({ status: ['open'] }), 'status');
    assertFails(validateListQuery({ priority: true }), 'priority');
  });

  test('ignores unknown parameters', () => {
    assert.deepEqual(validateListQuery({ page: '2', status: 'resolved' }), {
      ok: true,
      value: { ...none, status: 'resolved' },
    });
  });

  test('non-object queries return an error without throwing', () => {
    for (const query of ['status=open', 5, true, []]) {
      assertFails(validateListQuery(query), 'query');
    }
  });
});
