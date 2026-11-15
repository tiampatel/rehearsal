// CampusFix page wiring. Search/filter semantics are applied by the server; this module only
// forwards the non-empty control values (see public/view-model.js filtersToQuery).
import { DOM_IDS, EVENTS } from '/shared/contract.js';
import { createClient } from '/api.js';
import {
  filtersToQuery, hasActiveFilters, summaryCards, ticketCountText, ticketRow, listState,
  detailView, assigneeToPatch, errorMessage,
} from '/view-model.js';

const SEARCH_DEBOUNCE_MS = 250;
const $ = (key) => document.getElementById(DOM_IDS[key]);
const client = createClient();

const state = { selectedId: null, listSeq: 0, detailSeq: 0, tickets: [] };
let searchTimer = null;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function showError(node, message) {
  node.textContent = message || '';
  node.hidden = !message;
}

function readFilters() {
  return filtersToQuery({
    q: $('searchInput').value,
    status: $('filterStatus').value,
    priority: $('filterPriority').value,
    category: $('filterCategory').value,
  });
}

// ---- Rendering ------------------------------------------------------------------------------

function renderSummary(summary) {
  const ids = { total: 'summaryTotal', open: 'summaryOpen', in_progress: 'summaryInProgress', resolved: 'summaryResolved' };
  for (const card of summaryCards(summary)) $(ids[card.key]).textContent = card.text;
}

function renderListState(opts) {
  const node = $('listState');
  const view = listState(opts);
  node.textContent = view.message;
  node.hidden = view.kind === 'ready';
  node.classList.toggle('is-error', view.kind === 'error');
  $('ticketList').classList.toggle('is-busy', view.kind === 'loading');
  $('ticketList').setAttribute('aria-busy', String(view.kind === 'loading'));
}

function renderList(tickets) {
  const list = $('ticketList');
  list.replaceChildren();
  for (const ticket of tickets) {
    const row = ticketRow(ticket, state.selectedId);
    const li = el('li', row.selected ? 'ticket-item is-selected' : 'ticket-item');
    li.dataset.id = String(row.id);
    const button = el('button', 'ticket-button');
    button.type = 'button';
    button.setAttribute('aria-label', row.ariaLabel);
    if (row.selected) button.setAttribute('aria-current', 'true');
    button.append(el('span', 'ticket-title', `#${row.id} ${row.title}`));
    const meta = el('span', 'ticket-meta');
    meta.append(
      el('span', row.priorityClass, row.priorityLabel),
      el('span', row.statusClass, row.statusLabel),
      el('span', 'badge badge--category', row.categoryLabel),
      el('span', 'ticket-assignee', row.assigneeText),
    );
    button.append(meta);
    button.addEventListener('click', () => selectTicket(row.id, { focus: true }));
    li.append(button);
    list.append(li);
  }
  $('ticketCount').textContent = ticketCountText(tickets.length);
}

function renderComments(view) {
  const list = $('commentList');
  list.replaceChildren();
  if (view.empty) {
    list.append(el('li', 'comment-item', view.emptyText));
    return;
  }
  for (const c of view.items) {
    const li = el('li', 'comment-item');
    li.append(el('div', 'comment-meta', c.createdText), el('div', 'comment-body', c.body));
    list.append(li);
  }
}

function renderDetail(ticket, comments) {
  const view = detailView(ticket, comments);
  $('detailTitle').textContent = view.heading;
  $('detailDescription').textContent = `${view.description} (${view.categoryLabel} / ${view.priorityLabel} priority; created ${view.createdText}, updated ${view.updatedText})`;
  $('detailStatus').value = view.status;
  const assignee = $('detailAssignee');
  if (view.assignee && ![...assignee.options].some((o) => o.value === view.assignee)) {
    assignee.append(new Option(view.assignee, view.assignee));
  }
  assignee.value = view.assignee;
  $('detailStatus').disabled = false;
  assignee.disabled = false;
  renderComments(view.comments);
}

function clearDetail() {
  state.selectedId = null;
  $('detailTitle').textContent = 'Select a ticket';
  $('detailDescription').textContent = 'Choose a ticket from the list to see its details and comments.';
  $('commentList').replaceChildren();
  $('detailStatus').disabled = true;
  $('detailAssignee').disabled = true;
}

// ---- Data loading ---------------------------------------------------------------------------

async function refreshSummary() {
  try {
    renderSummary(await client.getSummary());
  } catch (err) {
    showError($('detailError'), errorMessage(err).message);
  }
}

async function refreshList() {
  const seq = ++state.listSeq;
  const filters = readFilters();
  renderListState({ loading: true });
  try {
    const { tickets } = await client.listTickets(filters);
    if (seq !== state.listSeq) return;
    state.tickets = tickets;
    renderList(tickets);
    renderListState({ count: tickets.length, filtersActive: hasActiveFilters(filters) });
  } catch (err) {
    if (seq !== state.listSeq) return;
    renderList([]);
    renderListState({ error: err });
  }
}

async function loadDetail(id) {
  const seq = ++state.detailSeq;
  try {
    const { ticket, comments } = await client.getTicket(id);
    if (seq !== state.detailSeq) return false;
    showError($('detailError'), '');
    renderDetail(ticket, comments);
    return true;
  } catch (err) {
    if (seq !== state.detailSeq) return false;
    const info = errorMessage(err);
    if (info.code === 'not_found') clearDetail();
    showError($('detailError'), info.message);
    return false;
  }
}

async function selectTicket(id, { focus = false } = {}) {
  state.selectedId = id;
  for (const li of $('ticketList').children) {
    const on = li.dataset.id === String(id);
    li.classList.toggle('is-selected', on);
    const b = li.querySelector('.ticket-button');
    if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
  }
  const ok = await loadDetail(id);
  if (ok && focus) $('detailPanel').focus();
}

async function afterMutation() {
  document.dispatchEvent(new CustomEvent(EVENTS.ticketsChanged, { detail: { ticketId: state.selectedId } }));
  await Promise.all([refreshSummary(), refreshList()]);
}

// ---- Handlers -------------------------------------------------------------------------------

async function onCreate(event) {
  event.preventDefault();
  const form = $('createForm');
  const button = form.querySelector('button[type="submit"]');
  showError($('createError'), '');
  button.disabled = true;
  try {
    const { ticket } = await client.createTicket({
      title: $('createTitle').value,
      description: $('createDescription').value,
      category: $('createCategory').value,
      priority: $('createPriority').value,
    });
    form.reset();
    state.selectedId = ticket.id;
    await afterMutation();
    await loadDetail(ticket.id);
    $('createTitle').focus();
  } catch (err) {
    const info = errorMessage(err);
    showError($('createError'), info.message);
    const fieldMap = { title: 'createTitle', description: 'createDescription', category: 'createCategory', priority: 'createPriority' };
    for (const key of Object.keys(info.fields)) {
      if (fieldMap[key]) { $(fieldMap[key]).focus(); break; }
    }
  } finally {
    button.disabled = false;
  }
}

async function patchSelected(patch, control) {
  if (state.selectedId === null) return;
  showError($('detailError'), '');
  try {
    await client.updateTicket(state.selectedId, patch);
    await afterMutation();
    await loadDetail(state.selectedId);
  } catch (err) {
    showError($('detailError'), errorMessage(err).message);
    await loadDetail(state.selectedId);
    control.focus();
  }
}

async function onComment(event) {
  event.preventDefault();
  if (state.selectedId === null) {
    showError($('commentError'), 'Select a ticket before adding a comment.');
    return;
  }
  showError($('commentError'), '');
  const button = $('commentForm').querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await client.addComment(state.selectedId, $('commentBody').value);
    $('commentBody').value = '';
    await afterMutation();
    await loadDetail(state.selectedId);
    $('commentBody').focus();
  } catch (err) {
    showError($('commentError'), errorMessage(err).message);
    $('commentBody').focus();
  } finally {
    button.disabled = false;
  }
}

function onSearchInput() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(refreshList, SEARCH_DEBOUNCE_MS);
}

function onFilterChange() {
  clearTimeout(searchTimer);
  refreshList();
}

function onClear() {
  $('searchInput').value = '';
  $('filterStatus').value = '';
  $('filterPriority').value = '';
  $('filterCategory').value = '';
  clearTimeout(searchTimer);
  refreshList();
  $('searchInput').focus();
}

function init() {
  $('searchInput').addEventListener('input', onSearchInput);
  $('searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); onFilterChange(); }
  });
  for (const key of ['filterStatus', 'filterPriority', 'filterCategory']) {
    $(key).addEventListener('change', onFilterChange);
  }
  $('clearFilters').addEventListener('click', onClear);
  $('createForm').addEventListener('submit', onCreate);
  $('commentForm').addEventListener('submit', onComment);
  $('detailStatus').addEventListener('change', (e) => patchSelected({ status: e.target.value }, e.target));
  $('detailAssignee').addEventListener('change', (e) => patchSelected({ assignedTo: assigneeToPatch(e.target.value) }, e.target));
  clearDetail();
  refreshSummary();
  refreshList();
}

init();
