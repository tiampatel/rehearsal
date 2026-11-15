// CampusFix browser API client. Browser-native ES module, also importable under Node.
// Routes are hard-coded on purpose so this file has no imports (see API.md "Browser client").

export class ApiError extends Error {
  constructor({ status = 0, code = 'unknown_error', message = 'Request failed', fields } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

const FILTER_KEYS = ['q', 'status', 'priority', 'category'];

export function buildQuery(filters = {}) {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = filters?.[key];
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text === '') continue;
    params.set(key, text);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

// URL of the CSV export for the given filters (same filter keys as the ticket list).
export function exportCsvUrl(filters = {}, baseUrl = '') {
  return `${baseUrl}/api/export/tickets.csv${buildQuery(filters)}`;
}

export function createClient({ baseUrl = '', fetchImpl = globalThis.fetch } = {}) {
  async function request(method, path, body) {
    const init = { method, headers: { Accept: 'application/json' } };
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    let response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, init);
    } catch (err) {
      throw new ApiError({
        status: 0,
        code: 'network_error',
        message: `Network error: ${err && err.message ? err.message : 'request failed'}`,
      });
    }

    let text;
    try {
      text = await response.text();
    } catch (err) {
      throw new ApiError({
        status: 0,
        code: 'network_error',
        message: `Network error while reading response: ${err && err.message ? err.message : 'failed'}`,
      });
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new ApiError({
        status: response.status,
        code: 'invalid_response',
        message: `Server returned a non-JSON response (HTTP ${response.status})`,
      });
    }

    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      throw new ApiError({
        status: response.status,
        code: 'invalid_response',
        message: `Server returned an unexpected response (HTTP ${response.status})`,
      });
    }

    if (!response.ok) {
      const e = data.error;
      if (e && typeof e === 'object' && typeof e.code === 'string') {
        throw new ApiError({
          status: response.status,
          code: e.code,
          message: typeof e.message === 'string' ? e.message : `Request failed (HTTP ${response.status})`,
          fields: e.fields && typeof e.fields === 'object' ? e.fields : undefined,
        });
      }
      throw new ApiError({
        status: response.status,
        code: 'invalid_response',
        message: `Request failed with an unexpected error body (HTTP ${response.status})`,
      });
    }

    if (data.error) {
      throw new ApiError({
        status: response.status,
        code: typeof data.error.code === 'string' ? data.error.code : 'invalid_response',
        message: typeof data.error.message === 'string' ? data.error.message : 'Request failed',
        fields: data.error.fields,
      });
    }
    return data;
  }

  const ticketPath = (id) => `/api/tickets/${encodeURIComponent(String(id))}`;

  return {
    listTickets: (filters) => request('GET', `/api/tickets${buildQuery(filters)}`),
    getTicket: (id) => request('GET', ticketPath(id)),
    createTicket: (input) => request('POST', '/api/tickets', input),
    updateTicket: (id, patch) => request('PATCH', ticketPath(id), patch),
    addComment: (id, body) => request('POST', `${ticketPath(id)}/comments`, { body }),
    getSummary: () => request('GET', '/api/summary'),
    exportCsvUrl: (filters) => exportCsvUrl(filters, baseUrl),
  };
}
