import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CSV_COLUMNS, ticketsToCsv } from '../server/csv.js';

const HEADER = 'id,title,category,priority,status,assignedTo\r\n';

const ticket = (overrides = {}) => ({
  id: 1,
  title: 'Projector broken',
  category: 'equipment',
  priority: 'high',
  status: 'open',
  assignedTo: null,
  ...overrides,
});

// Minimal RFC 4180 parser used to prove the output round-trips.
function parseCsv(text) {
  const records = [];
  let record = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      record.push(field);
      field = '';
    } else if (ch === '\r' && text[i + 1] === '\n') {
      record.push(field);
      records.push(record);
      record = [];
      field = '';
      i++;
    } else {
      field += ch;
    }
  }
  assert.equal(inQuotes, false, 'unterminated quoted field');
  assert.equal(field, '', 'output must end with a CRLF record terminator');
  assert.deepEqual(record, [], 'output must end with a CRLF record terminator');
  return records;
}

describe('CSV_COLUMNS', () => {
  test('lists exactly the six contract columns in order', () => {
    assert.deepEqual(CSV_COLUMNS, ['id', 'title', 'category', 'priority', 'status', 'assignedTo']);
  });
});

describe('ticketsToCsv', () => {
  test('emits only the header row (with CRLF) for an empty list', () => {
    assert.equal(ticketsToCsv([]), HEADER);
  });

  test('serializes a plain row, stringifying numbers', () => {
    assert.equal(
      ticketsToCsv([ticket({ id: 42, assignedTo: 'Sam' })]),
      `${HEADER}42,Projector broken,equipment,high,open,Sam\r\n`,
    );
  });

  test('null and undefined assignedTo become an empty field', () => {
    const csv = ticketsToCsv([ticket({ id: 1, assignedTo: null }), ticket({ id: 2, assignedTo: undefined })]);
    assert.equal(
      csv,
      `${HEADER}1,Projector broken,equipment,high,open,\r\n2,Projector broken,equipment,high,open,\r\n`,
    );
  });

  test('quotes fields containing commas', () => {
    const csv = ticketsToCsv([ticket({ title: 'Leak, ceiling' })]);
    assert.equal(csv, `${HEADER}1,"Leak, ceiling",equipment,high,open,\r\n`);
  });

  test('quotes fields containing double quotes and doubles the quotes', () => {
    const csv = ticketsToCsv([ticket({ title: 'The "big" screen' })]);
    assert.equal(csv, `${HEADER}1,"The ""big"" screen",equipment,high,open,\r\n`);
  });

  test('a field that is only a double quote is escaped correctly', () => {
    const csv = ticketsToCsv([ticket({ title: '"' })]);
    assert.equal(csv, `${HEADER}1,"""",equipment,high,open,\r\n`);
  });

  test('preserves embedded LF verbatim inside a quoted field', () => {
    const csv = ticketsToCsv([ticket({ title: 'line one\nline two' })]);
    assert.equal(csv, `${HEADER}1,"line one\nline two",equipment,high,open,\r\n`);
  });

  test('preserves embedded CRLF and lone CR verbatim inside quoted fields', () => {
    const csv = ticketsToCsv([ticket({ title: 'a\r\nb', assignedTo: 'c\rd' })]);
    assert.equal(csv, `${HEADER}1,"a\r\nb",equipment,high,open,"c\rd"\r\n`);
  });

  test('handles a field containing commas, quotes, LF and CRLF together', () => {
    const title = 'He said, "fix it"\nnow\r\nplease';
    const csv = ticketsToCsv([ticket({ title })]);
    assert.equal(csv, `${HEADER}1,"He said, ""fix it""\nnow\r\nplease",equipment,high,open,\r\n`);
  });

  test('preserves leading and trailing spaces without adding quotes', () => {
    const csv = ticketsToCsv([ticket({ title: '  padded  ' })]);
    assert.equal(csv, `${HEADER}1,  padded  ,equipment,high,open,\r\n`);
  });

  test('passes unicode through unchanged', () => {
    const csv = ticketsToCsv([ticket({ title: 'Café ☕ 投影机 😀', assignedTo: 'Zoë' })]);
    assert.equal(csv, `${HEADER}1,Café ☕ 投影机 😀,equipment,high,open,Zoë\r\n`);
  });

  test('emits only the six columns and ignores extra ticket fields', () => {
    const csv = ticketsToCsv([
      ticket({ description: 'secret, "extra"\ntext', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: 'x' }),
    ]);
    assert.equal(csv, `${HEADER}1,Projector broken,equipment,high,open,\r\n`);
    assert.equal(parseCsv(csv)[1].length, CSV_COLUMNS.length);
  });

  test('every record, including header and last row, ends with CRLF and there are no bare LFs outside quotes', () => {
    const csv = ticketsToCsv([ticket({ id: 1 }), ticket({ id: 2 }), ticket({ id: 3 })]);
    assert.ok(csv.endsWith('\r\n'));
    assert.equal(csv.split('\r\n').length, 5); // header + 3 rows + trailing empty segment
    assert.equal(csv.replaceAll('\r\n', '').includes('\n'), false);
    assert.equal(csv.replaceAll('\r\n', '').includes('\r'), false);
  });

  test('keeps the order of the supplied tickets', () => {
    const csv = ticketsToCsv([ticket({ id: 9 }), ticket({ id: 3 }), ticket({ id: 7 })]);
    assert.deepEqual(parseCsv(csv).slice(1).map((r) => r[0]), ['9', '3', '7']);
  });

  test('does not mutate its input', () => {
    const input = [ticket({ title: 'a,b' })];
    const snapshot = structuredClone(input);
    ticketsToCsv(input);
    assert.deepEqual(input, snapshot);
  });

  test('round-trips tricky values through an RFC 4180 parser', () => {
    const tickets = [
      ticket({ id: 1, title: 'plain', assignedTo: 'Sam' }),
      ticket({ id: 2, title: 'comma, here', assignedTo: null }),
      ticket({ id: 3, title: 'quote " inside', assignedTo: 'O"Neil, Pat' }),
      ticket({ id: 4, title: 'multi\nline\r\ntitle', assignedTo: 'x\ry' }),
      ticket({ id: 5, title: ' spaced ,"all",\r\n of it ', assignedTo: '' }),
      ticket({ id: 6, title: 'ünïcödé 😀', category: 'plumbing', priority: 'low', status: 'closed' }),
      ticket({ id: 7, title: '', assignedTo: undefined }),
    ];
    const records = parseCsv(ticketsToCsv(tickets));
    assert.deepEqual(records[0], CSV_COLUMNS);
    assert.equal(records.length, tickets.length + 1);
    tickets.forEach((t, i) => {
      assert.deepEqual(
        records[i + 1],
        CSV_COLUMNS.map((c) => (t[c] === null || t[c] === undefined ? '' : String(t[c]))),
      );
    });
  });
});
