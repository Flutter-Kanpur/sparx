// Minimal interview relay server.
//
// Holds interview "rooms" in memory (no database — rooms live only as long
// as this process runs) and relays live state between one candidate browser
// tab and any number of interviewer browser tabs over WebSocket:
//   - candidate code edits, language switches, active-problem switches
//   - run/submit verdicts (computed client-side against Judge0, then mirrored here)
//   - connect/disconnect presence
//
// The actual code execution still happens client-side against the public
// Judge0 sandbox (see src/pages/ProblemPage.jsx) — this server only relays
// state, it never runs candidate code.

import express from "express";
import cors from "cors";
import http from "http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { nanoid } from "nanoid";
import { createClient } from "@supabase/supabase-js";
import { GoogleGenAI } from "@google/genai";

// Manual .env loader — no `dotenv` dependency, and unlike Node's
// `--env-file` flag this doesn't throw when the file is absent (so
// `npm run server` / `npm run dev:all` keep working with zero setup for
// contributors who don't have Supabase credentials). Real shell-exported
// env vars still win (standard dotenv semantics).
function loadDotEnvIfPresent() {
  const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadDotEnvIfPresent();

const PORT = process.env.PORT || 8787;
// Default room lifetime when the interviewer doesn't set one explicitly —
// each room actually expires per its own `expiresAfterHours` (see
// normalizeExpiresAfterHours/roomExpiryMs), not this global constant; it's
// only the fallback default and the boot-query's outer sanity bound.
const DEFAULT_ROOM_TTL_HOURS = 8;
const PERSIST_DEBOUNCE_MS = 900;

// Interview rooms persist to Supabase (interview_rooms table, see
// supabase/migrations/0005_interview_rooms.sql) so a restart/redeploy of
// this process doesn't wipe live rooms — but the in-memory `rooms` Map
// below stays the source of truth for live relay; Supabase is a durable
// backup written to (debounced) after the fact, never in the hot path.
// Falls back to in-memory-only if these aren't set, so local dev needs no
// Supabase credentials — same fallback philosophy as
// src/lib/supabaseClient.js's isSupabaseConfigured on the frontend.
//
// NOT distributed: two concurrent instances of this server would still
// silently partition live WS relaying (interviewerSockets/candidateSocket
// are process-local, Supabase doesn't mediate that) even though writes to
// the table itself wouldn't corrupt. Fine for a single instance (the
// actual deployment target); would need Postgres LISTEN/NOTIFY or Supabase
// Realtime to fan out across instances if this ever needs to scale beyond
// one.
const supabase = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

if (!supabase) {
  console.warn(
    "[interview-relay] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set — " +
    "interview room persistence disabled; rooms live in memory only and " +
    "will be lost on restart."
  );
}

// Admin-only endpoints (check-ai/check-similarity, see requireAdmin below)
// need to verify a caller's Supabase session without service-role rights —
// SUPABASE_ANON_KEY is the same *public* value already baked into the
// frontend as VITE_SUPABASE_ANON_KEY, just duplicated under a server-side
// name (not a secret, safe to set the same way).
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || null;

// AI-generated-code detection (POST .../check-ai) — same "configured or
// null, warn once" pattern as the Supabase client above. Uses Gemini's free
// tier (aistudio.google.com/apikey — no credit card needed) rather than a
// paid API, since this is just an occasional on-demand classification call,
// not something worth spending real money on. A missing key degrades that
// one endpoint to a 503, never breaks anything else.
const gemini = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;

if (!gemini) {
  console.warn(
    "[interview-relay] GEMINI_API_KEY not set — AI-generated-code " +
    "detection disabled; POST .../check-ai will return 503."
  );
}

const app = express();
app.use(cors());
app.use(express.json());

/** @type {Map<string, Room>} */
const rooms = new Map();
/** @type {Map<string, NodeJS.Timeout>} */
const pendingPersists = new Map();
/** @type {Map<string, NodeJS.Timeout>} */
const autoEndTimers = new Map();

const DEFAULT_WEBUI = {
  html: `<div class="card">\n  <h1>Hello!</h1>\n  <p>Start building.</p>\n</div>`,
  css: `.card {\n  font-family: sans-serif;\n  padding: 24px;\n  border-radius: 12px;\n  background: #f4f4f5;\n}`,
  js: `// your code here`,
};

/** blank/0/invalid -> null ("no limit" — never schedules a timer, never shown in either UI). */
function normalizeTimeLimitMinutes(timeLimitMinutes) {
  const n = Number(timeLimitMinutes);
  return timeLimitMinutes != null && timeLimitMinutes !== "" && Number.isFinite(n) && n > 0
    ? Math.floor(n)
    : null;
}

/** blank/0/invalid -> the default (how long a room stays joinable before anyone's clicked the link). */
function normalizeExpiresAfterHours(expiresAfterHours) {
  const n = Number(expiresAfterHours);
  return expiresAfterHours != null && expiresAfterHours !== "" && Number.isFinite(n) && n > 0
    ? n
    : DEFAULT_ROOM_TTL_HOURS;
}

function roomExpiryMs(room) {
  return (room.expiresAfterHours ?? DEFAULT_ROOM_TTL_HOURS) * 60 * 60 * 1000;
}

function makeRoom({ title, candidateTitle, problemIds, flutterRound, flutterGistId, flutterPrompt, webuiRound, webuiPrompt, timeLimitMinutes, expiresAfterHours, isTemplate }) {
  const id = nanoid(8);
  const room = {
    id,
    title: title && title.trim() ? title.trim() : "Interview",
    candidateTitle: candidateTitle && candidateTitle.trim() ? candidateTitle.trim() : null,
    problemIds,
    flutterRound: !!flutterRound,
    flutterGistId: flutterGistId && flutterGistId.trim() ? flutterGistId.trim() : null,
    flutterPrompt: flutterPrompt && flutterPrompt.trim() ? flutterPrompt.trim() : null,
    webuiRound: !!webuiRound,
    webuiPrompt: webuiPrompt && webuiPrompt.trim() ? webuiPrompt.trim() : null,
    timeLimitMinutes: normalizeTimeLimitMinutes(timeLimitMinutes),
    expiresAfterHours: normalizeExpiresAfterHours(expiresAfterHours),
    isTemplate: !!isTemplate,
    createdAt: Date.now(),
    candidateSocket: null,
    interviewerSockets: new Set(),
    state: {
      activeProblemId: problemIds[0],
      language: "python",
      codeByProblem: {},
      lastResultByProblem: {},
      webui: { ...DEFAULT_WEBUI },
      candidateName: null,
      candidateEmail: null,
      candidateCollege: null,
      candidateYear: null,
      candidateBranch: null,
      candidatePhone: null,
      candidateConnected: false,
      testStartedAt: null,
    },
  };
  rooms.set(id, room);
  persistRoomInsert(room);
  return room;
}

// ---------------------------------------------------------------------------
// Supabase persistence — every function here is try/catch-wrapped and only
// ever logs a warning on failure. A DB hiccup must never throw into a route
// handler or block live relaying; it just means that moment isn't backed up.
// ---------------------------------------------------------------------------

function stateForPersist(state) {
  // candidateConnected is a live connection flag, not durable room data —
  // always recomputed as false on rehydration (a fresh process has no live
  // sockets yet), so don't persist it.
  const { candidateConnected, ...rest } = state;
  return rest;
}

function roomToRow(room) {
  return {
    id: room.id,
    title: room.title,
    candidate_title: room.candidateTitle,
    problem_ids: room.problemIds,
    flutter_round: room.flutterRound,
    flutter_gist_id: room.flutterGistId,
    flutter_prompt: room.flutterPrompt,
    webui_round: room.webuiRound,
    webui_prompt: room.webuiPrompt,
    time_limit_minutes: room.timeLimitMinutes,
    expires_after_hours: room.expiresAfterHours,
    is_template: room.isTemplate,
    state: stateForPersist(room.state),
    created_at: new Date(room.createdAt).toISOString(),
  };
}

function rowToRoom(row) {
  return {
    id: row.id,
    title: row.title,
    candidateTitle: row.candidate_title ?? null,
    problemIds: row.problem_ids || [],
    flutterRound: row.flutter_round,
    flutterGistId: row.flutter_gist_id,
    flutterPrompt: row.flutter_prompt,
    webuiRound: row.webui_round,
    webuiPrompt: row.webui_prompt,
    timeLimitMinutes: row.time_limit_minutes ?? null,
    expiresAfterHours: row.expires_after_hours ?? DEFAULT_ROOM_TTL_HOURS,
    isTemplate: !!row.is_template,
    createdAt: new Date(row.created_at).getTime(),
    candidateSocket: null,
    interviewerSockets: new Set(),
    state: { ...row.state, candidateConnected: false },
  };
}

async function persistRoomInsert(room) {
  if (!supabase) return;
  try {
    const { error } = await supabase.from("interview_rooms").insert(roomToRow(room));
    if (error) console.warn("[interview-relay] insert failed", room.id, error.message);
  } catch (err) {
    console.warn("[interview-relay] insert failed", room.id, err);
  }
}

async function persistRoomState(room) {
  if (!supabase) return;
  try {
    const { error } = await supabase
      .from("interview_rooms")
      .update({ state: stateForPersist(room.state) })
      .eq("id", room.id);
    if (error) console.warn("[interview-relay] state persist failed", room.id, error.message);
  } catch (err) {
    console.warn("[interview-relay] state persist failed", room.id, err);
  }
}

/**
 * Logs one real submit attempt to the permanent interview_submissions table
 * so the admin panel can review completion/results after a session has
 * ended, not just live. Fire-and-forget from the caller, same as every
 * other persistence helper here — never blocks the live relay path.
 * result.time from Judge0 is in seconds; time_ms needs the same *1000
 * conversion ProblemPage.jsx's insertSubmission already applies.
 */
async function persistInterviewSubmission(room, problemId, result) {
  if (!supabase) return;
  try {
    const { error } = await supabase.from("interview_submissions").insert({
      room_id: room.id,
      room_title: room.title,
      candidate_name: room.state.candidateName,
      candidate_email: room.state.candidateEmail,
      candidate_college: room.state.candidateCollege,
      candidate_year: room.state.candidateYear,
      candidate_branch: room.state.candidateBranch,
      candidate_phone: room.state.candidatePhone,
      problem_id: problemId,
      kind: "submit",
      language: room.state.language,
      code: room.state.codeByProblem[problemId] || "",
      verdict: result.verdict,
      passed: result.passed ?? null,
      total: result.total ?? null,
      time_ms: (result.time ?? 0) * 1000,
      memory_kb: result.memory ?? null,
    });
    if (error) console.warn("[interview-relay] submission persist failed", room.id, error.message);
  } catch (err) {
    console.warn("[interview-relay] submission persist failed", room.id, err);
  }
}

async function deleteRoomRow(roomId) {
  if (!supabase) return;
  try {
    const { error } = await supabase.from("interview_rooms").delete().eq("id", roomId);
    if (error) console.warn("[interview-relay] delete failed", roomId, error.message);
  } catch (err) {
    console.warn("[interview-relay] delete failed", roomId, err);
  }
}

async function fetchRoomRow(roomId) {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.from("interview_rooms").select("*").eq("id", roomId).maybeSingle();
    if (error) {
      console.warn("[interview-relay] fetch failed", roomId, error.message);
      return null;
    }
    return data;
  } catch (err) {
    console.warn("[interview-relay] fetch failed", roomId, err);
    return null;
  }
}

/** Cache-miss fallback: queries Supabase for a room not currently in the in-memory Map. */
async function tryRehydrateOne(roomId) {
  const row = await fetchRoomRow(roomId);
  if (!row) return null;
  const room = rowToRoom(row);
  if (Date.now() - room.createdAt > roomExpiryMs(room)) {
    deleteRoomRow(roomId); // stale — the sweep hasn't reached it yet, don't resurrect it
    return null;
  }
  rooms.set(room.id, room);
  scheduleAutoEnd(room);
  return room;
}

/**
 * Bulk-loads still-live rooms from Supabase at boot. Non-blocking — never
 * delays server.listen(). Each room's own expiresAfterHours decides
 * whether it's actually still live (no single global cutoff, since rooms
 * can have different expiry windows) — this only bounds the initial fetch
 * to a generous 30 days as a sanity limit, not the real expiry check.
 */
async function rehydrateRoomsOnBoot() {
  if (!supabase) return;
  const outerBoundIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  try {
    const { data, error } = await supabase.from("interview_rooms").select("*").gt("created_at", outerBoundIso);
    if (error) {
      console.warn("[interview-relay] boot rehydrate failed", error.message);
      return;
    }
    for (const row of data || []) {
      if (rooms.has(row.id)) continue;
      const room = rowToRoom(row);
      if (Date.now() - room.createdAt > roomExpiryMs(room)) {
        deleteRoomRow(row.id); // expired per its own window — don't resurrect it
        continue;
      }
      rooms.set(row.id, room);
      scheduleAutoEnd(room);
    }
    console.log(`[interview-relay] rehydrated ${data?.length ?? 0} room(s) from Supabase`);
  } catch (err) {
    console.warn("[interview-relay] boot rehydrate failed", err);
  }
}

/** Debounced (~900ms) per-room state write, so rapid typing doesn't hammer the DB. */
function schedulePersist(room) {
  if (!supabase) return;
  const existing = pendingPersists.get(room.id);
  if (existing) clearTimeout(existing);
  pendingPersists.set(room.id, setTimeout(() => {
    pendingPersists.delete(room.id);
    persistRoomState(room);
  }, PERSIST_DEBOUNCE_MS));
}

function clearPendingPersist(roomId) {
  const t = pendingPersists.get(roomId);
  if (t) {
    clearTimeout(t);
    pendingPersists.delete(roomId);
  }
}

/**
 * (Re)schedules a room's auto-end for when its time limit runs out, based on
 * room.state.testStartedAt. No-op if the room has no limit or hasn't
 * started yet. If the deadline has already passed — e.g. a room rehydrated
 * after the process was down past its limit — ends it immediately instead
 * of scheduling, so auto-end stays correct across a restart rather than
 * just resetting the clock.
 */
function scheduleAutoEnd(room) {
  clearAutoEndTimer(room.id);
  if (!room.timeLimitMinutes || !room.state.testStartedAt) return;
  const deadline = room.state.testStartedAt + room.timeLimitMinutes * 60 * 1000;
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    endInterviewRoom(room.id, "timeout");
    return;
  }
  autoEndTimers.set(room.id, setTimeout(() => endInterviewRoom(room.id, "timeout"), remaining));
}

function clearAutoEndTimer(roomId) {
  const t = autoEndTimers.get(roomId);
  if (t) {
    clearTimeout(t);
    autoEndTimers.delete(roomId);
  }
}

/**
 * The single place an interview room ever gets ended, however it's
 * triggered (interviewer clicking End, candidate clicking End test, or the
 * time-limit timer firing) — notifies both sides, tears down sockets, and
 * removes all durable/pending state for the room. Has no `await` before
 * `rooms.delete()`, so a manual end and an auto-end racing each other can't
 * double-fire: whichever call's synchronous prefix runs first wins, the
 * second sees `room` as undefined and just re-runs the already-idempotent
 * cleanup tail.
 */
async function endInterviewRoom(roomId, reason) {
  const room = rooms.get(roomId);
  if (room) {
    toCandidate(room, { type: "ended", reason });
    toInterviewers(room, { type: "ended", reason });
    closeAll(room.candidateSocket);
    room.interviewerSockets.forEach(closeAll);
  }
  rooms.delete(roomId);
  clearPendingPersist(roomId);
  clearAutoEndTimer(roomId);
  // Deliberately NOT deleting the Supabase row here. interview_rooms is what
  // Interview History lists from (fetchInterviewRoomsHistory) — hard-deleting
  // on end meant every interview vanished from history the moment it
  // actually finished, which defeats the whole feature. The row still
  // expires naturally via the TTL sweep on its own expiresAfterHours window
  // (the "link stays valid for" setting chosen at creation time), same as
  // any room nobody ever explicitly ended.
}

function roomSummary(room) {
  return {
    roomId: room.id,
    title: room.title,
    candidateTitle: room.candidateTitle ?? null,
    problemIds: room.problemIds,
    flutterRound: room.flutterRound,
    flutterGistId: room.flutterGistId,
    flutterPrompt: room.flutterPrompt,
    webuiRound: room.webuiRound,
    webuiPrompt: room.webuiPrompt,
    timeLimitMinutes: room.timeLimitMinutes,
    expiresAfterHours: room.expiresAfterHours,
    isTemplate: !!room.isTemplate,
    testStartedAt: room.state.testStartedAt ?? null,
    createdAt: room.createdAt,
    candidateConnected: room.state.candidateConnected,
    candidateName: room.state.candidateName,
    candidateEmail: room.state.candidateEmail,
    candidateCollege: room.state.candidateCollege,
    candidateYear: room.state.candidateYear,
    candidateBranch: room.state.candidateBranch,
    candidatePhone: room.state.candidatePhone,
    interviewerCount: room.interviewerSockets.size,
  };
}

app.post("/api/interviews", (req, res) => {
  const { title, candidateTitle, problemIds = [], flutterRound, flutterGistId, flutterPrompt, webuiRound, webuiPrompt, timeLimitMinutes, expiresAfterHours, isTemplate } = req.body || {};
  if (!Array.isArray(problemIds)) {
    return res.status(400).json({ error: "problemIds must be an array" });
  }
  if (problemIds.length === 0 && !flutterRound && !webuiRound) {
    return res.status(400).json({ error: "pick at least one problem, or include a Flutter or Web UI round" });
  }
  // Blank/0/omitted means "no limit" (valid); anything else must be a positive number.
  if (timeLimitMinutes != null && timeLimitMinutes !== "" && !(Number.isFinite(Number(timeLimitMinutes)) && Number(timeLimitMinutes) > 0)) {
    return res.status(400).json({ error: "timeLimitMinutes must be a positive number" });
  }
  // Blank/omitted means "use the default"; anything else must be a positive number.
  if (expiresAfterHours != null && expiresAfterHours !== "" && !(Number.isFinite(Number(expiresAfterHours)) && Number(expiresAfterHours) > 0)) {
    return res.status(400).json({ error: "expiresAfterHours must be a positive number" });
  }
  const room = makeRoom({ title, candidateTitle, problemIds, flutterRound, flutterGistId, flutterPrompt, webuiRound, webuiPrompt, timeLimitMinutes, expiresAfterHours, isTemplate });
  res.json(roomSummary(room));
});

// Forks a reusable template room into a brand-new, fully independent room
// for one candidate — the only legitimate way a template ever turns into a
// real, joinable session (see the upgrade handler's matching guard below).
app.post("/api/interviews/:roomId/fork", async (req, res) => {
  let room = rooms.get(req.params.roomId);
  if (!room) room = await tryRehydrateOne(req.params.roomId);
  if (!room) return res.status(404).json({ error: "interview not found" });
  if (!room.isTemplate) return res.status(400).json({ error: "this interview is not a reusable link" });
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) return res.status(400).json({ error: "name is required" });
  const forked = makeRoom({
    title: room.title,
    candidateTitle: room.candidateTitle,
    problemIds: room.problemIds,
    flutterRound: room.flutterRound,
    flutterGistId: room.flutterGistId,
    flutterPrompt: room.flutterPrompt,
    webuiRound: room.webuiRound,
    webuiPrompt: room.webuiPrompt,
    timeLimitMinutes: room.timeLimitMinutes,
    expiresAfterHours: room.expiresAfterHours,
    isTemplate: false,
  });
  res.json(roomSummary(forked));
});

app.get("/api/interviews", (_req, res) => {
  const list = [...rooms.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(roomSummary);
  res.json({ interviews: list });
});

app.get("/api/interviews/:roomId", async (req, res) => {
  let room = rooms.get(req.params.roomId);
  if (!room) room = await tryRehydrateOne(req.params.roomId);
  if (!room) return res.status(404).json({ error: "interview not found" });
  res.json(roomSummary(room));
});

app.delete("/api/interviews/:roomId", async (req, res) => {
  await endInterviewRoom(req.params.roomId, "manual");
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// AI-generated-code detection + cross-candidate similarity (admin-triggered,
// on-demand from InterviewHistory.jsx's detail view). Same "gracefully
// degrade if unconfigured" posture as Supabase above.
//
// Unlike every other route in this file, these two require the caller to be
// a real admin — every other route here is deliberately unauthenticated (an
// accepted tradeoff), but check-ai makes an external Gemini API call per
// invocation, so a leaked/guessed submission UUID must not be enough to
// burn through the free-tier quota (or worse, once/if this ever moves to a
// paid tier).
// ---------------------------------------------------------------------------

/**
 * Verifies the caller's Supabase session really belongs to an admin, by
 * running the same is_admin() security-definer function every RLS policy
 * in this schema already trusts (supabase/migrations/0001_init.sql) — but
 * via a per-request client built from the caller's own JWT (anon key, not
 * service role), so the query runs as that user and respects auth.uid().
 */
async function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: "missing Authorization bearer token" });
  if (!process.env.SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return res.status(503).json({ error: "admin verification not configured" });
  }
  try {
    const callerClient = createClient(process.env.SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data, error } = await callerClient.rpc("is_admin");
    if (error) {
      console.warn("[interview-relay] admin check failed", error.message);
      return res.status(401).json({ error: "could not verify session" });
    }
    if (!data) return res.status(403).json({ error: "admin access required" });
    next();
  } catch (err) {
    console.warn("[interview-relay] admin check failed", err);
    res.status(401).json({ error: "could not verify session" });
  }
}

async function fetchSubmissionRow(submissionId) {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.from("interview_submissions").select("*").eq("id", submissionId).maybeSingle();
    if (error) {
      console.warn("[interview-relay] fetch submission failed", submissionId, error.message);
      return null;
    }
    return data;
  } catch (err) {
    console.warn("[interview-relay] fetch submission failed", submissionId, err);
    return null;
  }
}

function normalizeCode(code) {
  return (code || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function bigrams(str) {
  const set = new Set();
  for (let i = 0; i < str.length - 1; i++) set.add(str.slice(i, i + 2));
  return set;
}

/** Dice coefficient over character bigrams — cheap, dependency-free, catches
 * straightforward copy-paste between candidates. Not resilient to
 * variable-renaming-level obfuscation; accepted as "good enough" for a
 * small interview batch, not a research-grade plagiarism system. */
function diceCoefficient(codeA, codeB) {
  const a = bigrams(normalizeCode(codeA));
  const b = bigrams(normalizeCode(codeB));
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const bg of a) if (b.has(bg)) overlap++;
  return (2 * overlap) / (a.size + b.size);
}

function buildAiCheckPrompt(code, language) {
  return `You are helping an interviewer spot AI-generated code submissions in a live coding interview. Judge whether the following ${language} submission looks AI-generated (e.g. ChatGPT/Copilot-style: generic variable names, boilerplate comments, unusually polished/idiomatic for the apparent skill level) versus organically human-written (messier, iterative, personal style).

Reply with ONLY a JSON object, no other text, no markdown fences: {"score": <0-100 integer, 0=clearly human, 100=clearly AI-generated>, "reasoning": "<one concise sentence>"}

Code:
${code}`;
}

function parseAiCheckResponse(text) {
  const cleaned = (text || "").trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  const parsed = JSON.parse(cleaned);
  const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score))));
  const reasoning = typeof parsed.reasoning === "string" ? parsed.reasoning.slice(0, 500) : "";
  if (!Number.isFinite(score)) throw new Error("invalid score in AI response");
  return { score, reasoning };
}

function isGeminiOverloaded(err) {
  try {
    return JSON.parse(err?.message || "")?.error?.code === 503;
  } catch {
    return /503|UNAVAILABLE|high demand/i.test(err?.message || "");
  }
}

/** Gemini's free tier genuinely returns transient 503s under load (confirmed
 * empirically, not hypothetical) — a couple of short retries smooths that
 * over instead of failing the admin's click on a random blip. */
async function generateContentWithRetry(params, retries = 2) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await gemini.models.generateContent(params);
    } catch (err) {
      if (isGeminiOverloaded(err) && attempt < retries) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
}

app.post("/api/interviews/submissions/:submissionId/check-ai", requireAdmin, async (req, res) => {
  if (!supabase) return res.status(503).json({ error: "persistence not configured" });
  if (!gemini) return res.status(503).json({ error: "GEMINI_API_KEY not configured" });
  const submission = await fetchSubmissionRow(req.params.submissionId);
  if (!submission) return res.status(404).json({ error: "submission not found" });
  try {
    const response = await generateContentWithRetry({
      model: "gemini-3.8-flash",
      contents: buildAiCheckPrompt(submission.code, submission.language),
    });
    const { score, reasoning } = parseAiCheckResponse(response.text);
    const ai_checked_at = new Date().toISOString();
    const { error } = await supabase
      .from("interview_submissions")
      .update({ ai_score: score, ai_reasoning: reasoning, ai_checked_at })
      .eq("id", submission.id);
    if (error) console.warn("[interview-relay] ai check persist failed", submission.id, error.message);
    res.json({ score, reasoning, aiCheckedAt: ai_checked_at });
  } catch (err) {
    console.warn("[interview-relay] check-ai failed", submission.id, err);
    res.status(502).json({ error: "AI check failed" });
  }
});

app.post("/api/interviews/submissions/:submissionId/check-similarity", requireAdmin, async (req, res) => {
  if (!supabase) return res.status(503).json({ error: "persistence not configured" });
  const submission = await fetchSubmissionRow(req.params.submissionId);
  if (!submission) return res.status(404).json({ error: "submission not found" });
  try {
    const { data, error } = await supabase
      .from("interview_submissions")
      .select("id, room_id, room_title, candidate_name, code, created_at")
      .eq("problem_id", submission.problem_id)
      .neq("room_id", submission.room_id)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return res.status(502).json({ error: error.message });
    const matches = (data || [])
      .map(({ code, ...rest }) => ({ ...rest, score: diceCoefficient(submission.code, code) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
    res.json({ matches }); // not persisted — pool grows over time, would go stale
  } catch (err) {
    console.warn("[interview-relay] check-similarity failed", submission.id, err);
    res.status(502).json({ error: "similarity check failed" });
  }
});

// ---------------------------------------------------------------------------
// AI contest review — "what went wrong for me in this contest".
//
// POST /api/contests/:contestId/review  (signed-in user; body {userId} is admin-only)
// Reads the user's own in-window contest submissions (code, verdicts, timing),
// asks Gemini for specific, kind feedback, and caches the result so each
// person costs one model call. Participants get the review; "originality"
// signals (big rewrites between attempts, near-copies of other participants'
// code) go to a separate admin-only table and are NEVER sent to the user —
// AI-authorship guesses are unreliable, so they're hints for a human, not a verdict.
// Only available once the contest has ended, so it can't be used to get hints mid-contest.
// ---------------------------------------------------------------------------

async function getCaller(req) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token || !process.env.SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  try {
    const client = createClient(process.env.SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error } = await client.auth.getUser(token);
    if (error || !userData?.user) return null;
    const { data: isAdmin } = await client.rpc("is_admin");
    return { id: userData.user.id, isAdmin: !!isAdmin };
  } catch {
    return null;
  }
}

const trunc = (text, n) => (text && text.length > n ? text.slice(0, n) + "\n…(truncated)" : text || "");

function reviewPrompt(contest, problems) {
  const blocks = problems.map((p) => {
    const attempts = p.attempts.map((a) =>
      `Attempt ${a.n} — ${a.verdict}${a.total != null ? ` (${a.passed ?? "?"}/${a.total} tests)` : ""}, ${a.minutesIn} min into the contest, ${a.language}\n\`\`\`\n${a.code}\n\`\`\``
    ).join("\n\n");
    return `### Problem ${p.position}: ${p.title} (${p.difficulty}) — outcome: ${p.outcome}\nStatement:\n${p.statement}\n\nThe participant's submissions, oldest first:\n${attempts || "(no submissions)"}`;
  }).join("\n\n---\n\n");
  return `You are a kind, precise coding coach reviewing one participant's performance in a programming contest called "${contest.title}". Verdict codes: AC accepted, WA wrong answer, TLE time limit exceeded, RE runtime error, CE compile error.

For each problem, look at their attempts and say concretely what went wrong: the actual logic mistake (e.g. off-by-one, missed edge case such as empty/single-element/negative input, wrong greedy assumption, integer overflow, O(n^2) where O(n log n) was needed, mishandled input format, forgot to reset state). Reference what you see in their code. Do not paste a full corrected solution — give the key idea or a tiny snippet. If they solved it first try, note what they did well. If a problem has no submissions, say so briefly and suggest how to start.

Be encouraging and specific; avoid generic advice. Never accuse the participant of cheating or of using AI.

Reply with ONLY a JSON object (no markdown fences) of this shape:
{"summary": "<2-3 sentence overview>",
 "strengths": ["..."],
 "problems": [{"position": <number>, "title": "...", "outcome": "solved|unsolved", "mistakes": [{"kind": "logic|edge-case|performance|input-output|syntax|approach|other", "what": "<what went wrong, specific>", "fix": "<how to fix or avoid it>"}], "takeaway": "<one line>"}],
 "practice": ["<3-5 specific topics or problem types to practise>"],
 "admin_note": "<one sentence for the organisers ONLY: does the final accepted code look like the participant's own progression of attempts, or like a sudden different (possibly pasted or externally generated) solution? Say 'nothing unusual' if fine.>"}

${blocks}`;
}

let reviewQueue = Promise.resolve();
const reviewsInFlight = new Map();

async function buildContestReview(contestId, userId) {
  const { data: contest } = await supabase.from("contests").select("id, title, starts_at, ends_at").eq("id", contestId).maybeSingle();
  if (!contest) return { status: 404, error: "contest not found" };
  if (new Date(contest.ends_at).getTime() > Date.now()) return { status: 403, error: "reviews open after the contest ends" };

  const { data: cps } = await supabase
    .from("contest_problems")
    .select("position, problem_id, problems(id, title, difficulty, statement)")
    .eq("contest_id", contestId)
    .order("position", { ascending: true });
  const { data: subs } = await supabase
    .from("submissions")
    .select("problem_id, language, code, verdict, passed, total, created_at")
    .eq("contest_id", contestId)
    .eq("user_id", userId)
    .eq("kind", "submit")
    .gte("created_at", contest.starts_at)
    .lte("created_at", contest.ends_at)
    .order("created_at", { ascending: true });
  if (!subs || subs.length === 0) return { status: 404, error: "no submissions from this user in this contest" };

  const startMs = new Date(contest.starts_at).getTime();
  const signals = [];
  const problems = (cps || []).filter((cp) => cp.problems).map((cp) => {
    const mine = subs.filter((x) => x.problem_id === cp.problem_id);
    const firstAc = mine.findIndex((x) => x.verdict === "AC");
    const solved = firstAc !== -1;
    // keep the prompt small: first 3 + last 2 attempts when there are many
    const kept = mine.length > 5 ? [...mine.slice(0, 3), ...mine.slice(-2)] : mine;
    const attempts = kept.map((a) => ({
      n: mine.indexOf(a) + 1,
      verdict: a.verdict, passed: a.passed, total: a.total, language: a.language,
      minutesIn: Math.max(0, Math.round((new Date(a.created_at).getTime() - startMs) / 60000)),
      code: trunc(a.code, 4500),
    }));
    if (mine.length) {
      const wrongBefore = solved ? firstAc : mine.length;
      const sig = { problemId: cp.problem_id, title: cp.problems.title, attempts: mine.length, wrongBeforeAccept: wrongBefore, solved };
      if (solved && firstAc > 0) sig.rewriteSimilarity = Number(diceCoefficient(mine[firstAc - 1].code, mine[firstAc].code).toFixed(2));
      signals.push(sig);
    }
    return {
      position: cp.position + 1, problemId: cp.problem_id, title: cp.problems.title, difficulty: cp.problems.difficulty,
      statement: trunc(cp.problems.statement, 1800), outcome: solved ? "solved" : "unsolved", attempts,
      finalCode: (mine[solved ? firstAc : mine.length - 1] || {}).code || "",
    };
  });

  // near-copies of other participants' final code (admin-only signal)
  for (const p of problems) {
    const sig = signals.find((x) => x.problemId === p.problemId);
    if (!sig || !p.finalCode) continue;
    const { data: others } = await supabase
      .from("submissions").select("code, user_id")
      .eq("contest_id", contestId).eq("problem_id", p.problemId).eq("kind", "submit").eq("verdict", "AC")
      .neq("user_id", userId).limit(200);
    let best = 0;
    for (const o of others || []) best = Math.max(best, diceCoefficient(p.finalCode, o.code));
    sig.maxSimilarityToOthers = Number(best.toFixed(2));
  }

  const response = await generateContentWithRetry({ model: "gemini-3.8-flash", contents: reviewPrompt(contest, problems) });
  const cleaned = (response.text || "").trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  const parsed = JSON.parse(cleaned);
  const list = (v, n) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, n) : []);
  const review = {
    summary: typeof parsed.summary === "string" ? parsed.summary.slice(0, 800) : "",
    strengths: list(parsed.strengths, 5),
    problems: (Array.isArray(parsed.problems) ? parsed.problems : []).slice(0, 12).map((p) => ({
      position: Number(p.position) || null,
      title: String(p.title || "").slice(0, 200),
      outcome: p.outcome === "solved" ? "solved" : "unsolved",
      mistakes: (Array.isArray(p.mistakes) ? p.mistakes : []).slice(0, 5).map((m) => ({
        kind: String(m.kind || "other").slice(0, 30), what: String(m.what || "").slice(0, 600), fix: String(m.fix || "").slice(0, 600),
      })),
      takeaway: String(p.takeaway || "").slice(0, 300),
    })),
    practice: list(parsed.practice, 6),
    originalityHints: [],
  };
  // gentle, non-accusatory hint (the strong signals stay admin-only)
  for (const sig of signals) {
    if (sig.solved && sig.wrongBeforeAccept >= 2 && sig.rewriteSimilarity != null && sig.rewriteSimilarity < 0.4) {
      review.originalityHints.push(`On "${sig.title}" your accepted solution looks very different from your earlier attempts. That's great if you rethought the approach — just make sure you can explain every line, and try solving it again from scratch without looking.`);
    }
  }

  await supabase.from("contest_reviews").upsert({ contest_id: contestId, user_id: userId, review, model: "gemini-3.8-flash" });
  await supabase.from("contest_review_flags").upsert({
    contest_id: contestId, user_id: userId, signals,
    admin_note: typeof parsed.admin_note === "string" ? parsed.admin_note.slice(0, 500) : null,
  });
  return { status: 200, review };
}

app.post("/api/contests/:contestId/review", async (req, res) => {
  if (!supabase) return res.status(503).json({ error: "persistence not configured" });
  if (!gemini) return res.status(503).json({ error: "GEMINI_API_KEY not configured" });
  const caller = await getCaller(req);
  if (!caller) return res.status(401).json({ error: "sign in required" });
  const { contestId } = req.params;
  const targetId = req.body?.userId && caller.isAdmin ? req.body.userId : caller.id;

  const cached = await supabase.from("contest_reviews").select("review, created_at").eq("contest_id", contestId).eq("user_id", targetId).maybeSingle();
  if (cached.data) return res.json({ review: cached.data.review, createdAt: cached.data.created_at, cached: true });

  const key = `${contestId}:${targetId}`;
  try {
    if (!reviewsInFlight.has(key)) {
      // one Gemini call at a time keeps us inside the free tier's per-minute limit
      const job = reviewQueue.then(() => buildContestReview(contestId, targetId));
      reviewQueue = job.catch(() => {});
      reviewsInFlight.set(key, job);
      job.finally(() => reviewsInFlight.delete(key)).catch(() => {});
    }
    const result = await reviewsInFlight.get(key);
    if (result.status !== 200) return res.status(result.status).json({ error: result.error });
    res.json({ review: result.review, cached: false });
  } catch (err) {
    console.warn("[interview-relay] contest review failed", key, err);
    res.status(502).json({ error: "couldn't generate the review right now — try again in a minute" });
  }
});

function closeAll(ws) {
  if (ws && ws.readyState === ws.OPEN) ws.close();
}

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, "http://localhost");
  const match = url.pathname.match(/^\/ws\/interview\/([^/]+)$/);
  const role = url.searchParams.get("role");
  if (!match || (role !== "candidate" && role !== "interviewer")) {
    socket.destroy();
    return;
  }
  const roomId = match[1];
  (async () => {
    let room = rooms.get(roomId);
    if (!room) room = await tryRehydrateOne(roomId);
    // A template room is never itself a live session — the only legitimate
    // path onto a real one is fork-then-redirect (see the /fork route).
    if (!room || socket.destroyed || (role === "candidate" && room.isTemplate)) {
      if (!socket.destroyed) socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, { room, role });
    });
  })();
});

wss.on("connection", (ws, { room, role }) => {
  if (role === "candidate") {
    room.candidateSocket = ws;
    room.state.candidateConnected = true;
    toInterviewers(room, { type: "presence", role: "candidate", connected: true });
  } else {
    room.interviewerSockets.add(ws);
    toCandidate(room, {
      type: "presence",
      role: "interviewer",
      connected: true,
      count: room.interviewerSockets.size,
    });
  }

  ws.send(JSON.stringify({ type: "snapshot", state: room.state }));

  ws.on("message", (raw) => {
    if (role !== "candidate") return; // only the candidate socket may mutate state
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    applyCandidateMessage(room, msg);
    toInterviewers(room, msg);
    schedulePersist(room);
  });

  ws.on("close", () => {
    if (role === "candidate") {
      room.candidateSocket = null;
      room.state.candidateConnected = false;
      toInterviewers(room, { type: "presence", role: "candidate", connected: false });
    } else {
      room.interviewerSockets.delete(ws);
      toCandidate(room, {
        type: "presence",
        role: "interviewer",
        connected: room.interviewerSockets.size > 0,
        count: room.interviewerSockets.size,
      });
    }
  });
});

function applyCandidateMessage(room, msg) {
  switch (msg?.type) {
    case "name":
      room.state.candidateName = msg.name;
      room.state.candidateEmail = msg.email ?? null;
      room.state.candidateCollege = msg.college ?? null;
      room.state.candidateYear = msg.year ?? null;
      room.state.candidateBranch = msg.branch ?? null;
      room.state.candidatePhone = msg.phone ?? null;
      // First time this room's candidate has ever identified themselves:
      // if a time limit is set, this is when the countdown starts (not
      // room-creation time — the candidate usually joins some time later).
      if (!room.state.testStartedAt && room.timeLimitMinutes) {
        room.state.testStartedAt = Date.now();
        scheduleAutoEnd(room);
        const timing = { type: "timing", testStartedAt: room.state.testStartedAt, timeLimitMinutes: room.timeLimitMinutes };
        toCandidate(room, timing);
        toInterviewers(room, timing);
      }
      break;
    case "code":
      room.state.codeByProblem[msg.problemId] = msg.code;
      room.state.language = msg.language;
      break;
    case "activeProblem":
      room.state.activeProblemId = msg.problemId;
      break;
    case "result":
      room.state.lastResultByProblem[msg.problemId] = msg.result;
      if (msg.result?.kind === "submit") {
        persistInterviewSubmission(room, msg.problemId, msg.result); // fire-and-forget, never blocks relay
      }
      break;
    case "webuiCode":
      room.state.webui = { html: msg.html ?? "", css: msg.css ?? "", js: msg.js ?? "" };
      break;
    default:
      break;
  }
}

function toInterviewers(room, msg) {
  const data = JSON.stringify(msg);
  for (const ws of room.interviewerSockets) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

function toCandidate(room, msg) {
  const ws = room.candidateSocket;
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

// Sweep stale rooms every 30 minutes so long-idle interviews don't leak
// memory. Each room has its own expiresAfterHours now (not one global
// cutoff), so this checks per-room in memory, then separately reconciles
// Supabase the same way rehydrateRoomsOnBoot does — fetching rows and
// filtering expiry client-side, since a single-column `.lt()` query can't
// express "compare to a per-row expiry window."
setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (now - room.createdAt > roomExpiryMs(room)) {
      rooms.delete(id);
      clearPendingPersist(id);
      clearAutoEndTimer(id);
    }
  }
  if (supabase) {
    (async () => {
      try {
        const { data, error } = await supabase.from("interview_rooms").select("id, created_at, expires_after_hours");
        if (error) {
          console.warn("[interview-relay] TTL sweep failed", error.message);
          return;
        }
        const expiredIds = (data || [])
          .filter((row) => now - new Date(row.created_at).getTime() > (row.expires_after_hours ?? DEFAULT_ROOM_TTL_HOURS) * 60 * 60 * 1000)
          .map((row) => row.id);
        if (expiredIds.length === 0) return;
        const { error: deleteError } = await supabase.from("interview_rooms").delete().in("id", expiredIds);
        if (deleteError) console.warn("[interview-relay] TTL sweep failed", deleteError.message);
      } catch (err) {
        console.warn("[interview-relay] TTL sweep failed", err);
      }
    })();
  }
}, 30 * 60 * 1000);

rehydrateRoomsOnBoot();

server.listen(PORT, () => {
  console.log(`Interview relay server listening on http://localhost:${PORT}`);
});
