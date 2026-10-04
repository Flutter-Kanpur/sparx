// Data-access layer over the Supabase `contests` / `contest_problems` tables
// and the `contest_id`-tagged rows in `submissions` (see
// supabase/migrations/0003_contests.sql). Reuses db.js's insertSubmission /
// markSolved rather than duplicating them — a contest submission is a
// submission in every sense, just scoped to a contest.

import { supabase } from "./supabaseClient.js";
import { insertSubmission, markSolved } from "./db.js";

function mapContestRow(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description || "",
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    meetupUrl: row.meetup_url || null,
    requiresAccess: !!row.requires_access,
  };
}

/** "upcoming" | "live" | "ended" — purely derived from starts_at/ends_at, no stored status column. */
export function contestStatus(contest, now = new Date()) {
  const t = now.getTime();
  if (t < new Date(contest.startsAt).getTime()) return "upcoming";
  if (t > new Date(contest.endsAt).getTime()) return "ended";
  return "live";
}

export async function createContest({ title, description, startsAt, endsAt, problemIds, meetupUrl, rsvpRequired }, userId) {
  const { data: contest, error } = await supabase
    .from("contests")
    .insert({
      title,
      description: description || null,
      starts_at: startsAt,
      ends_at: endsAt,
      created_by: userId,
      meetup_url: meetupUrl || null,
      requires_access: !!rsvpRequired,
    })
    .select()
    .single();
  if (error) throw error;

  const rows = problemIds.map((problemId, i) => ({
    contest_id: contest.id,
    problem_id: problemId,
    position: i,
  }));
  const { error: linkError } = await supabase.from("contest_problems").insert(rows);
  if (linkError) throw linkError;

  return mapContestRow(contest);
}

export async function fetchContests() {
  const { data, error } = await supabase
    .from("contests")
    .select("*")
    .order("starts_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(mapContestRow);
}

export function contestUrl(contestId) {
  return `${window.location.origin}/contest/${contestId}`;
}

export async function fetchContestSummary(contestId) {
  const { data, error } = await supabase.from("contests").select("*").eq("id", contestId).single();
  if (error) throw error;
  return mapContestRow(data);
}

export async function fetchContest(contestId) {
  const [{ data: contestRow, error: contestError }, { data: linkRows, error: linkError }] = await Promise.all([
    supabase.from("contests").select("*").eq("id", contestId).single(),
    supabase
      .from("contest_problems")
      .select("position, points, problems(*)")
      .eq("contest_id", contestId)
      .order("position", { ascending: true }),
  ]);
  if (contestError) throw contestError;
  if (linkError) throw linkError;

  const problems = (linkRows || [])
    .filter((r) => r.problems)
    .map((r) => ({
      id: r.problems.id,
      title: r.problems.title,
      vibe: r.problems.vibe,
      difficulty: r.problems.difficulty,
      tags: r.problems.tags || [],
      companies: r.problems.companies || [],
      statement: r.problems.statement,
      examples: r.problems.examples || [],
      tests: r.problems.tests || [],
      starter: r.problems.starter || {},
      sourceUrl: r.problems.source_url || null,
      points: r.points,
    }));

  return { ...mapContestRow(contestRow), problems };
}

/** Whether the signed-in user may open/submit in this contest (true for open contests, admins, and RSVP'd users). */
export async function hasContestAccess(contestId) {
  const { data, error } = await supabase.rpc("has_contest_access", { p_contest_id: contestId });
  if (error) throw error;
  return !!data;
}

/** Admin only: turn RSVP on/off for an existing contest and set its Meetup link. */
export async function updateContestRsvpSettings(contestId, { requiresAccess, meetupUrl }) {
  const { error } = await supabase
    .from("contests")
    .update({ requires_access: !!requiresAccess, meetup_url: meetupUrl || null })
    .eq("id", contestId);
  if (error) throw error;
}

export async function rsvpContest(contestId) {
  const { data, error } = await supabase.rpc("rsvp_contest", { p_contest_id: contestId });
  if (error) throw error;
  return !!data;
}

export async function cancelRsvp(contestId) {
  const { error } = await supabase.rpc("cancel_rsvp", { p_contest_id: contestId });
  if (error) throw error;
}

export async function fetchRsvpCount(contestId) {
  const { data, error } = await supabase.rpc("contest_rsvp_count", { p_contest_id: contestId });
  if (error) throw error;
  return data || 0;
}

/** Admin only: everyone who RSVP'd, with email. */
export async function fetchContestRsvps(contestId) {
  const { data, error } = await supabase.rpc("get_contest_rsvps", { p_contest_id: contestId });
  if (error) throw error;
  return (data || []).map((r) => ({
    userId: r.user_id, username: r.username, name: r.name, email: r.email, createdAt: r.created_at, revoked: r.revoked,
  }));
}

export async function setRsvpRevoked(contestId, userId, revoked) {
  const { error } = await supabase.from("contest_rsvps").update({ revoked }).eq("contest_id", contestId).eq("user_id", userId);
  if (error) throw error;
}

export async function deleteContest(contestId) {
  const { error } = await supabase.from("contests").delete().eq("id", contestId);
  if (error) throw error;
}

export async function submitContestSolution({
  userId, contestId, problemId, language, code, verdict, passed, total, timeMs, memoryKb,
}) {
  await insertSubmission({
    userId, problemId, kind: "submit", language, code, verdict, passed, total, timeMs, memoryKb, contestId,
  });
  if (verdict === "AC") {
    await markSolved(userId, problemId);
  }
}

export async function fetchContestLeaderboard(contestId) {
  const { data, error } = await supabase.rpc("get_contest_leaderboard", { p_contest_id: contestId });
  if (error) throw error;
  return (data || []).map((row) => ({
    userId: row.user_id,
    username: row.username,
    name: row.name,
    solvedCount: row.solved_count,
    totalPenalty: Number(row.total_penalty),
    rank: row.rank,
  }));
}

/** LeetCode-style standings: one entry per participant with per-problem cells, already rank-ordered. */
export async function fetchContestStandings(contestId) {
  const { data, error } = await supabase.rpc("get_contest_standings", { p_contest_id: contestId });
  if (error) throw error;
  const byUser = new Map();
  for (const row of data || []) {
    let entry = byUser.get(row.user_id);
    if (!entry) {
      entry = {
        userId: row.user_id,
        username: row.username,
        name: row.name,
        countryCode: row.country_code,
        rank: Number(row.rank),
        score: row.score,
        finishSeconds: row.finish_seconds,
        cells: [],
      };
      byUser.set(row.user_id, entry);
    }
    entry.cells.push({
      problemId: row.problem_id,
      position: row.position,
      points: row.points,
      solved: row.solved,
      solveSeconds: row.solve_seconds,
      elapsedSeconds: row.elapsed_seconds ?? row.solve_seconds,
      wrongCount: row.wrong_count,
    });
  }
  return [...byUser.values()];
}

/** Per-problem verdict history for one user within one contest — used to mark solved/attempted tabs. */
export async function fetchMyContestSubmissions(userId, contestId) {
  const { data, error } = await supabase
    .from("submissions")
    .select("problem_id, verdict, created_at")
    .eq("user_id", userId)
    .eq("contest_id", contestId)
    .order("created_at", { ascending: true });
  if (error) throw error;

  const byProblem = {};
  for (const row of data || []) {
    const entry = (byProblem[row.problem_id] ||= { attempts: 0, solved: false, firstAcAt: null });
    entry.attempts++;
    if (row.verdict === "AC") {
      entry.solved = true;
      entry.firstAcAt ||= row.created_at;
    }
  }
  return byProblem;
}

/** The signed-in user's submit history for one contest question, newest first (includes the submitted code). */
export async function fetchMyProblemSubmissions(userId, contestId, problemId) {
  const { data, error } = await supabase
    .from("submissions")
    .select("id, language, code, verdict, passed, total, time_ms, memory_kb, created_at")
    .eq("user_id", userId)
    .eq("contest_id", contestId)
    .eq("problem_id", problemId)
    .eq("kind", "submit")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

/** Starts this user's clock for a question (idempotent). Resolves to the start time in ms, or null. */
export async function startContestProblem(contestId, problemId) {
  const { data, error } = await supabase.rpc("start_contest_problem", { p_contest_id: contestId, p_problem_id: problemId });
  if (error || !data) return null;
  return new Date(data).getTime();
}

/** { [problemId]: startedAtMs } for the signed-in user. */
export async function fetchMyProblemStarts(userId, contestId) {
  const { data, error } = await supabase
    .from("contest_problem_starts")
    .select("problem_id, started_at")
    .eq("user_id", userId)
    .eq("contest_id", contestId);
  if (error) throw error;
  return Object.fromEntries((data || []).map((r) => [r.problem_id, new Date(r.started_at).getTime()]));
}

/** 604 -> "10 min 4 sec", 45 -> "45 sec", 3725 -> "1 hr 2 min 5 sec". */
export function formatTaken(seconds) {
  if (seconds == null) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts = [];
  if (h) parts.push(`${h} hr`);
  if (m || h) parts.push(`${m} min`);
  parts.push(`${s} sec`);
  return parts.join(" ");
}
