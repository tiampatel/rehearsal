// CSV serializer for the ticket export (decision feature/csv-export).
// Pure: no I/O, no dependencies. RFC 4180 with CRLF record terminators.

export const CSV_COLUMNS = ['id', 'title', 'category', 'priority', 'status', 'assignedTo'];

const CRLF = '\r\n';
const NEEDS_QUOTING = /[",\r\n]/;

function escapeField(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return NEEDS_QUOTING.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function ticketsToCsv(tickets) {
  const rows = [CSV_COLUMNS.map(escapeField).join(',')];
  for (const ticket of tickets ?? []) {
    rows.push(CSV_COLUMNS.map((column) => escapeField(ticket[column])).join(','));
  }
  return rows.join(CRLF) + CRLF;
}
