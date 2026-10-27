import type { ReviewView } from '../http/views.js';
type Demo = { id: string; label: string; batchIds: string[] };
type Selection = { fixtureId: string; batchId: string; receiptId: string };
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let token = '',
  demos: Demo[] = [],
  selection: Selection | null = null,
  current: ReviewView | null = null,
  poll: ReturnType<typeof setTimeout> | undefined,
  busy = false,
  reviewRequest = 0,
  evidenceRequest = 0;
let runtimeLabel = 'Fake/scripted';
function clearEvidence() {
  evidenceRequest++;
  el('evidence-record').hidden = true;
  el('evidence-record').textContent = '';
}
function resetSelection() {
  selection = null;
  current = null;
  reviewRequest++;
  if (poll) clearTimeout(poll);
  clearEvidence();
  el('review').hidden = true;
}
function money(value: string | null, positiveSign = false): string {
  if (value === null) return 'Unavailable';
  const n = BigInt(value),
    abs = n < 0n ? -n : n;
  return (
    (n < 0n ? '-' : positiveSign && n > 0n ? '+' : '') +
    '$' +
    (abs / 100n).toString() +
    '.' +
    (abs % 100n).toString().padStart(2, '0')
  );
}
function message(text: string, error = false) {
  el('feedback').textContent = text;
  el('feedback').classList.toggle('error', error);
}
async function api(path: string, body?: unknown) {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers:
      body === undefined ? {} : { 'content-type': 'application/json', 'x-session-token': token },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'REQUEST_FAILED');
  return data;
}
function base() {
  if (!selection) throw new Error('NO_RECEIPT');
  return `/api/batches/${selection.batchId}/receipts/${selection.receiptId}`;
}
async function render(view: ReviewView) {
  if (JSON.stringify(current?.evidenceRefs) !== JSON.stringify(view.evidenceRefs)) clearEvidence();
  current = view;
  el('review').hidden = false;
  el('receipt-label').textContent = `${view.receiptId} / AUD`;
  el('pos-total').textContent = money(view.posTotalMinor);
  el('accounting-total').textContent = money(view.accountingTotalMinor);
  el('difference').textContent = money(view.differenceMinor, true);
  const unresolved = view.proposal?.category !== 'explained_rounding';
  let status =
    view.outcome === 'reviewed_explained'
      ? 'Reviewed / explained'
      : view.outcome
        ? 'Open / unresolved'
        : view.status === 'awaiting_review'
          ? unresolved
            ? 'Needs more evidence'
            : 'Awaiting review'
          : view.status === 'investigating'
            ? 'Investigating'
            : view.status === 'applying_decision'
              ? 'Recording review'
              : view.status === 'matched'
                ? 'Matched'
                : view.status === 'failed'
                  ? 'Investigation stopped'
                  : 'Ready';
  if (
    view.category === 'unexplained_mismatch' &&
    !view.outcome &&
    view.status === 'awaiting_review'
  )
    status = 'Unexplained difference';
  if (
    view.category === 'contradictory_evidence' &&
    !view.outcome &&
    view.status === 'awaiting_review'
  )
    status = 'Conflicting evidence';
  el('status').textContent = status;
  el('status').classList.toggle(
    'accepted',
    view.outcome === 'reviewed_explained' || view.status === 'matched',
  );
  el('explanation').textContent =
    view.proposal?.explanation ??
    (view.status === 'matched'
      ? 'The recorded totals agree. No model investigation was needed.'
      : view.status === 'failed'
        ? `The investigation stopped (${view.errorCode ?? 'workflow error'}). This exception remains open.`
        : 'Gathering evidence and checking calculation profiles.');
  el('next-step').textContent = view.proposal?.nextStep ?? '';
  el('references').textContent = view.proposal
    ? `Proposal model: ${view.proposal.modelVersion}. Evidence: ` +
      view.proposal.evidenceRefs.map((r) => `${r.id} v${r.version}`).join(', ')
    : '';
  for (const action of ['accept', 'reject', 'acknowledge'] as const) {
    const button = el<HTMLButtonElement>(action);
    button.hidden = !view.actions.includes(action);
    button.disabled = busy;
  }
  const links = el('evidence-links');
  links.replaceChildren();
  for (const ref of view.evidenceRefs) {
    const row = document.createElement('div');
    row.className = 'evidence-link';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `${ref.id} v${ref.version}`;
    button.addEventListener('click', () => {
      const selected = selection;
      const request = ++evidenceRequest;
      void api(`/api/evidence/${ref.kind}/${ref.id}/${ref.version}`)
        .then((record) => {
          if (
            selection !== selected ||
            request !== evidenceRequest ||
            !current?.evidenceRefs.some(
              (r) => r.kind === ref.kind && r.id === ref.id && r.version === ref.version,
            )
          )
            return;
          el('evidence-record').textContent = JSON.stringify(record, null, 2);
          el('evidence-record').hidden = false;
        })
        .catch((error) => {
          if (selection === selected && request === evidenceRequest) showError(error);
        });
    });
    const kind = document.createElement('small');
    kind.textContent = ref.kind;
    row.append(button, kind);
    links.append(row);
  }
  const history = el('history');
  history.replaceChildren();
  for (const event of view.history) {
    const item = document.createElement('li');
    const data = event.body as Record<string, unknown>;
    item.textContent =
      event.type.replaceAll('_', ' ') +
      (data.decision
        ? `: ${data.decision}`
        : data.outcome
          ? `: ${data.outcome}`
          : data.code
            ? `: ${data.code}`
            : data.name
              ? `: ${data.name}`
              : '');
    history.append(item);
  }
  if (poll) clearTimeout(poll);
  if (view.status === 'investigating' || view.status === 'applying_decision')
    poll = setTimeout(() => void refresh().catch(showError), 200);
}
async function refresh() {
  const selected = selection;
  const request = ++reviewRequest;
  try {
    const view = await api(base() + '/review');
    if (selection === selected && request === reviewRequest) await render(view);
  } catch (error) {
    if (selection === selected && request === reviewRequest) throw error;
  }
}
function showError(error: unknown) {
  message(
    error instanceof Error
      ? `Request could not complete: ${error.message}. Reload the page to refresh evidence and session.`
      : 'Request could not complete.',
    true,
  );
}
async function chooseReceipt(batchId: string, receiptId: string, start: boolean) {
  const fixtureId = el<HTMLSelectElement>('fixture').value;
  resetSelection();
  selection = { fixtureId, batchId, receiptId };
  const selected = selection;
  sessionStorage.setItem('payment-review', JSON.stringify(selection));
  if (start) await api(base() + '/investigations', {});
  if (selection === selected) await refresh();
}
async function loadExample() {
  if (busy) return;
  busy = true;
  el<HTMLButtonElement>('load').disabled = true;
  el<HTMLSelectElement>('fixture').disabled = true;
  resetSelection();
  message('Loading synthetic evidence...');
  try {
    const demo = demos.find((d) => d.id === el<HTMLSelectElement>('fixture').value)!;
    await api('/api/imports', { fixtureId: demo.id });
    const receipts: ReviewView[] = [];
    for (const batchId of demo.batchIds)
      receipts.push(...(await api(`/api/batches/${batchId}/receipts`)));
    const picker = el<HTMLSelectElement>('receipt');
    picker.replaceChildren();
    for (const receipt of receipts) {
      const option = document.createElement('option');
      option.value = `${receipt.batchId}/${receipt.receiptId}`;
      option.textContent = receipt.receiptId;
      picker.append(option);
    }
    el('receipt-picker').hidden = receipts.length < 2;
    if (!receipts.length) throw new Error('NO_RECEIPTS');
    await chooseReceipt(receipts[0].batchId, receipts[0].receiptId, true);
    message(`${runtimeLabel} investigation. Review the evidence before deciding.`);
  } catch (error) {
    showError(error);
  } finally {
    busy = false;
    el<HTMLButtonElement>('load').disabled = false;
    el<HTMLSelectElement>('fixture').disabled = false;
    if (current) await render(current);
  }
}
async function decide(decision: 'accept' | 'reject' | 'acknowledge') {
  if (busy || !current?.proposal) return;
  busy = true;
  try {
    const p = current.proposal;
    for (const name of ['accept', 'reject', 'acknowledge'])
      el<HTMLButtonElement>(name).disabled = true;
    await api('/api/decisions', {
      proposalId: p.id,
      proposalVersion: p.version,
      snapshotDigest: p.snapshotDigest,
      idempotencyKey: crypto.randomUUID(),
      decision,
    });
    message('Review saved. Original amounts retained.');
    await refresh();
  } catch (error) {
    showError(error);
  } finally {
    busy = false;
    if (current) await render(current);
  }
}
el('load').addEventListener('click', () => void loadExample());
el('receipt').addEventListener('change', () => {
  const [batchId, receiptId] = el<HTMLSelectElement>('receipt').value.split('/');
  void chooseReceipt(batchId, receiptId, true).catch(showError);
});
for (const action of ['accept', 'reject', 'acknowledge'] as const)
  el(action).addEventListener('click', () => void decide(action));
async function init() {
  const session = await api('/api/session');
  token = session.token;
  runtimeLabel =
    session.mode === 'anthropic' ? `Claude (${session.modelVersion})` : 'Fake/scripted';
  el('model-mode').textContent = `Local demo / ${runtimeLabel}`;
  demos = await api('/api/fixtures');
  const picker = el<HTMLSelectElement>('fixture');
  for (const demo of demos) {
    const option = document.createElement('option');
    option.value = demo.id;
    option.textContent = demo.label;
    picker.append(option);
  }
  try {
    const saved = JSON.parse(
      sessionStorage.getItem('payment-review') ?? 'null',
    ) as Selection | null;
    if (saved && demos.some((d) => d.id === saved.fixtureId)) {
      picker.value = saved.fixtureId;
      selection = saved;
      await refresh();
    }
  } catch {
    sessionStorage.removeItem('payment-review');
  }
}
void init().catch(showError);
