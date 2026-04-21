// Dev-only diagnostics for render loops and validation thrash
// Enabled when running in development OR when URL has ?diag=1 or ?debugLoops=1

const safeNow = () => Date.now();

function enabled() {
  try {
    const isDev = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV;
    const url = new URL(window.location.href);
    const byFlag = url.searchParams.get('diag') === '1' || url.searchParams.get('debugLoops') === '1' || url.searchParams.get('redux-data') === 'true';
    return !!(isDev || byFlag);
  } catch (_) {
    return false;
  }
}

// Render tracking for TextareaQuestion
const RENDER_WINDOW_MS = 2000;
const RENDER_THRESHOLD_DEFAULT = 20;
const RENDER_THRESHOLD_HOT = 10; // for 23.1 and 25.1
const renderBuckets = new Map(); // qid -> number[] (timestamps)

export function trackTextareaRender(qid) {
  if (!enabled() || !qid) return;
  const now = safeNow();
  const list = renderBuckets.get(qid) || [];
  list.push(now);
  // prune window
  const cutoff = now - RENDER_WINDOW_MS;
  while (list.length && list[0] < cutoff) list.shift();
  renderBuckets.set(qid, list);
  const thr = (qid === '23.1' || qid === '25.1') ? RENDER_THRESHOLD_HOT : RENDER_THRESHOLD_DEFAULT;
  if (list.length > thr) {
    console.warn(`[DEV-DIAG] Q${qid} rendered ${list.length} times in ${(RENDER_WINDOW_MS/1000).toFixed(1)}s — potential render loop.`);
  }
}

// Validation dispatch tracking
const VAL_WINDOW_MS = 1500;
const VAL_REPEAT_DEFAULT = 6;
const VAL_REPEAT_HOT = 4; // tighter for 23.1, 25.1
const validationHistory = new Map(); // qid -> { ts: number, status: string }[]

export function trackValidationDispatch(qid, status) {
  if (!enabled() || !qid) return;
  const now = safeNow();
  const arr = validationHistory.get(qid) || [];
  arr.push({ ts: now, status });
  const cutoff = now - VAL_WINDOW_MS;
  while (arr.length && arr[0].ts < cutoff) arr.shift();
  validationHistory.set(qid, arr);
  // Count repeats of the same status
  const lastStatus = status;
  const same = arr.filter(e => e.status === lastStatus);
  const thr = (qid === '23.1' || qid === '25.1') ? VAL_REPEAT_HOT : VAL_REPEAT_DEFAULT;
  if (same.length >= thr) {
    console.warn(`[DEV-DIAG] Validation thrash on Q${qid}: '${lastStatus}' repeated ${same.length}× in ${(VAL_WINDOW_MS/1000).toFixed(1)}s.`);
  }
}

// Parent status flip-flop detection
const PARENT_WINDOW_MS = 2500;
const FLIP_FLOP_THRESHOLD = 3;
const parentStatusMap = new Map(); // parentId -> { ts: number, status: string, viaChild?: string }[]

export function trackParentStatusChange(parentId, newStatus, causeChildId) {
  if (!enabled() || !parentId) return;
  const now = safeNow();
  const arr = parentStatusMap.get(parentId) || [];
  arr.push({ ts: now, status: newStatus, viaChild: causeChildId });
  const cutoff = now - PARENT_WINDOW_MS;
  while (arr.length && arr[0].ts < cutoff) arr.shift();
  parentStatusMap.set(parentId, arr);
  // Detect flip-flops (A->B->A) within window
  if (arr.length >= 3) {
    const last = arr[arr.length - 1].status;
    const prev = arr[arr.length - 2].status;
    const prev2 = arr[arr.length - 3].status;
    if (last === prev2 && last !== prev) {
      // count number of alternations in window
      let flips = 0;
      for (let i = 2; i < arr.length; i++) {
        const a = arr[i - 2].status;
        const b = arr[i - 1].status;
        const c = arr[i].status;
        if (a === c && a !== b) flips++;
      }
      if (flips >= FLIP_FLOP_THRESHOLD) {
        const hotTag = (causeChildId === '23.1' || causeChildId === '25.1') ? ' (hot child)' : '';
        const childNote = causeChildId ? `, triggered by child Q${causeChildId}` : '';
        console.warn(`[DEV-DIAG] Parent Q${parentId} status flip-flop detected ${flips}× in ${(PARENT_WINDOW_MS/1000).toFixed(1)}s${childNote}${hotTag}. Latest='${newStatus}'.`);
      }
    }
  }
}

export function devDiagEnabled() {
  return enabled();
}