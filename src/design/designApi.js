import { supabase } from "../lib/supabaseClient.js";

// Answers are always written to localStorage first (instant, works offline) and mirrored to the
// design_answers table when it exists (migration 0021). Reads take whichever copy is newer.

const EMPTY = { sections: {}, selfCheck: {}, hintsShown: 0, revealed: false, updatedAt: 0 };
const lsKey = (userId, qid) => `sparx:design:${userId}:${qid}`;

function readLocal(userId, qid) {
  try {
    const raw = localStorage.getItem(lsKey(userId, qid));
    return raw ? { ...EMPTY, ...JSON.parse(raw) } : null;
  } catch {
    return null;
  }
}

const withTimeout = (promise, ms) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);

export function loadLocalAnswer(userId, questionId) {
  return readLocal(userId, questionId);
}

export function loadLocalProgress(userId, questionIds) {
  const out = {};
  for (const id of questionIds) {
    const local = readLocal(userId, id);
    if (local) out[id] = local;
  }
  return out;
}

function writeLocal(userId, qid, state) {
  try { localStorage.setItem(lsKey(userId, qid), JSON.stringify(state)); } catch { /* storage unavailable */ }
}

function fromRow(row) {
  return {
    sections: row.sections || {},
    selfCheck: row.self_check || {},
    hintsShown: row.hints_shown || 0,
    revealed: !!row.revealed,
    updatedAt: new Date(row.updated_at).getTime(),
  };
}

export async function loadAnswer(userId, questionId) {
  const local = readLocal(userId, questionId);
  try {
    const { data, error } = await withTimeout(supabase.from("design_answers").select("*").eq("user_id", userId).eq("question_id", questionId).maybeSingle(), 3000);
    if (!error && data) {
      const remote = fromRow(data);
      return !local || remote.updatedAt >= local.updatedAt ? remote : local;
    }
  } catch { /* table missing or offline — fall through to the local copy */ }
  return local || { ...EMPTY };
}

export async function saveAnswer(userId, questionId, state) {
  const stamped = { ...state, updatedAt: Date.now() };
  writeLocal(userId, questionId, stamped);
  try {
    const { error } = await supabase.from("design_answers").upsert({
      user_id: userId,
      question_id: questionId,
      sections: stamped.sections,
      self_check: stamped.selfCheck,
      hints_shown: stamped.hintsShown,
      revealed: stamped.revealed,
      updated_at: new Date(stamped.updatedAt).toISOString(),
    });
    return !error;
  } catch {
    return false;
  }
}

/** { [questionId]: state } for the progress badges on the list page. */
export async function loadProgress(userId, questionIds) {
  const out = {};
  for (const id of questionIds) {
    const local = readLocal(userId, id);
    if (local) out[id] = local;
  }
  try {
    const { data, error } = await withTimeout(supabase.from("design_answers").select("*").eq("user_id", userId), 3000);
    if (!error) {
      for (const row of data || []) {
        const remote = fromRow(row);
        if (!out[row.question_id] || remote.updatedAt >= out[row.question_id].updatedAt) out[row.question_id] = remote;
      }
    }
  } catch { /* offline or table missing */ }
  return out;
}

export function filledSections(state, sections) {
  return sections.filter((s) => (state?.sections?.[s.id] || "").trim().length >= 20).length;
}
