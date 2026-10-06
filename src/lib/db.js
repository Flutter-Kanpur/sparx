// Data-access layer over the Supabase `problems` / `submissions` /
// `solved_problems` / `profiles` tables (see supabase/migrations/0001_init.sql).
// Every exported function here does one real query — no mock data, no
// client-side fakery. RLS policies on the tables are the actual security
// boundary, not anything in this file.

import { supabase } from "./supabaseClient.js";

// ---------------------------------------------------------------------------
// problems
// ---------------------------------------------------------------------------

function mapProblemRow(row) {
  return {
    id: row.id,
    title: row.title,
    vibe: row.vibe,
    difficulty: row.difficulty,
    tags: row.tags || [],
    companies: row.companies || [],
    statement: row.statement,
    examples: row.examples || [],
    tests: row.tests || [],
    starter: row.starter || {},
    sourceUrl: row.source_url || null,
    createdAt: row.created_at,
  };
}

function problemToRow(problem, userId) {
  return {
    id: problem.id,
    title: problem.title,
    vibe: problem.vibe || null,
    difficulty: problem.difficulty,
    tags: problem.tags || [],
    companies: problem.companies || [],
    statement: problem.statement,
    examples: problem.examples || [],
    tests: problem.tests || [],
    starter: problem.starter || {},
    source_url: problem.sourceUrl || null,
    created_by: userId,
  };
}

export async function setProblemCompanies(id, companies) {
  const { error } = await supabase.from("problems").update({ companies }).eq("id", id);
  if (error) throw error;
}

/** All problems, oldest first (matches the old hand-written catalog order). */
export async function fetchAllProblems() {
  const { data, error } = await supabase
    .from("problems")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []).map(mapProblemRow);
}

export async function createProblem(problem, userId) {
  const { error } = await supabase.from("problems").insert(problemToRow(problem, userId));
  if (error) throw error;
}

export async function bulkUpsertProblems(problems, userId) {
  const rows = problems.map((p) => problemToRow(p, userId));
  const { error } = await supabase.from("problems").upsert(rows);
  if (error) throw error;
}

// Curated list of tag values that represent a "sheet" (a named, external
// problem list like Striver's SDE Sheet) rather than an ordinary topic tag.
// Adding a new sheet later just means tagging its problems with a new key
// here — no schema change needed, since sheets live in the same `tags`
// column as everything else.
export const SHEET_TAGS = {
  "striver-sde-sheet": "Striver SDE Sheet",
};

/**
 * Global facets for the catalog: difficulty counts, the list of companies
 * present, and the list of sheets present, each with how many problems
 * carry that tag. Computed from every row's (small) difficulty/companies/
 * tags columns rather than a single page, so counts stay accurate
 * regardless of pagination/filters.
 */
export async function fetchCatalogFacets() {
  const { data, error } = await supabase.from("problems").select("difficulty, companies, tags");
  if (error) throw error;

  const counts = { all: data.length, starter: 0, easy: 0, medium: 0, hard: 0 };
  const companyCounts = {};
  const sheetCounts = {};
  for (const row of data) {
    if (row.difficulty in counts) counts[row.difficulty]++;
    for (const c of row.companies || []) companyCounts[c] = (companyCounts[c] || 0) + 1;
    for (const t of row.tags || []) {
      if (t in SHEET_TAGS) sheetCounts[t] = (sheetCounts[t] || 0) + 1;
    }
  }
  const companies = Object.entries(companyCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const sheets = Object.entries(sheetCounts)
    .map(([tag, count]) => ({ tag, label: SHEET_TAGS[tag], count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  return { counts, companies, sheets };
}

export async function deleteProblem(id) {
  const { error } = await supabase.from("problems").delete().eq("id", id);
  if (error) throw error;
}

/** Every problem carrying a given sheet tag (e.g. "striver-sde-sheet"), oldest first. */
export async function fetchSheetProblems(sheetTag) {
  const { data, error } = await supabase
    .from("problems")
    .select("*")
    .contains("tags", [sheetTag])
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []).map(mapProblemRow);
}

// ---------------------------------------------------------------------------
// submissions + solved_problems
// ---------------------------------------------------------------------------

export async function insertSubmission({
  userId, problemId, kind, language, code, verdict, passed, total, timeMs, memoryKb, contestId,
}) {
  const { error } = await supabase.from("submissions").insert({
    user_id: userId,
    problem_id: problemId,
    kind,
    language,
    code,
    verdict,
    passed: passed ?? null,
    total: total ?? null,
    time_ms: timeMs ?? null,
    memory_kb: memoryKb ?? null,
    contest_id: contestId ?? null,
  });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// interview submission history (admin review — see server/index.js's
// persistInterviewSubmission, which writes interview_submissions via the
// service-role key; these are read-only, RLS-gated to admins)
// ---------------------------------------------------------------------------

/** Past interviews, newest first — sourced from interview_rooms directly (not
 * the relay server's in-memory list) so ended/swept rooms still show up. */
export async function fetchInterviewRoomsHistory({ limit = 50 } = {}) {
  const { data, error } = await supabase
    .from("interview_rooms")
    .select("id, title, problem_ids, created_at, candidate_name:state->>candidateName, candidate_email:state->>candidateEmail, candidate_college:state->>candidateCollege, candidate_year:state->>candidateYear, candidate_branch:state->>candidateBranch, candidate_phone:state->>candidatePhone")
    .eq("is_template", false)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

/** Interviews whose room row no longer exists (rooms were hard-deleted when ended, before ended rooms
 * were kept) but whose submissions were saved. Rebuilt from interview_submissions, shaped like the
 * rows of fetchInterviewRoomsHistory plus `archived: true`. `knownRoomIds` are the live/kept rooms. */
export async function fetchArchivedInterviews(knownRoomIds) {
  const { data, error } = await supabase
    .from("interview_submissions")
    .select("room_id, room_title, problem_id, candidate_name, candidate_email, candidate_college, candidate_year, candidate_branch, candidate_phone, created_at")
    .order("created_at", { ascending: true });
  if (error) throw error;
  const byRoom = new Map();
  for (const r of data || []) {
    if (knownRoomIds.has(r.room_id)) continue;
    let room = byRoom.get(r.room_id);
    if (!room) {
      room = { id: r.room_id, title: r.room_title || "Interview", problem_ids: [], created_at: r.created_at, archived: true };
      byRoom.set(r.room_id, room);
    }
    if (r.problem_id && !room.problem_ids.includes(r.problem_id)) room.problem_ids.push(r.problem_id);
    for (const k of ["candidate_name", "candidate_email", "candidate_college", "candidate_year", "candidate_branch", "candidate_phone"]) {
      if (!room[k] && r[k]) room[k] = r[k];
    }
  }
  return [...byRoom.values()].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

/** All submit attempts for one interview room, newest first. */
export async function fetchInterviewSubmissions(roomId) {
  const { data, error } = await supabase
    .from("interview_submissions")
    .select("*")
    .eq("room_id", roomId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

/** Grouped verdict summary across every interview submission, for computing
 * each room's Pass/Fail/Not-started status client-side. One unfiltered
 * select (this admin-only table is small) — matches this file's existing
 * pattern of simple un-aggregated .select() calls with no RPC/view usage. */
export async function fetchInterviewRoomVerdictSummary() {
  const { data, error } = await supabase
    .from("interview_submissions")
    .select("room_id, problem_id, verdict");
  if (error) throw error;
  const byRoom = {};
  for (const row of data || []) {
    const entry = (byRoom[row.room_id] ||= { attempted: new Set(), accepted: new Set() });
    entry.attempted.add(row.problem_id);
    if (row.verdict === "AC") entry.accepted.add(row.problem_id);
  }
  return byRoom;
}

export async function markSolved(userId, problemId) {
  const { error } = await supabase
    .from("solved_problems")
    .upsert({ user_id: userId, problem_id: problemId }, { onConflict: "user_id,problem_id", ignoreDuplicates: true });
  if (error) throw error;
}

export async function fetchSolvedProblemIds(userId) {
  const { data, error } = await supabase
    .from("solved_problems")
    .select("problem_id")
    .eq("user_id", userId);
  if (error) throw error;
  return new Set((data || []).map((r) => r.problem_id));
}

// ---------------------------------------------------------------------------
// profile stats (Profile.jsx)
// ---------------------------------------------------------------------------

function isoDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function dayKey(iso) {
  return iso.slice(0, 10);
}

/** Longest run of consecutive calendar days ending "today or yesterday", plus the longest run ever. */
function computeStreaks(dayStrings) {
  const days = [...new Set(dayStrings)].sort(); // ascending "YYYY-MM-DD"
  if (days.length === 0) return { current: 0, max: 0 };

  let max = 1, run = 1;
  for (let i = 1; i < days.length; i++) {
    const prev = new Date(days[i - 1]);
    const cur = new Date(days[i]);
    const diff = Math.round((cur - prev) / 86400000);
    run = diff === 1 ? run + 1 : 1;
    if (run > max) max = run;
  }

  const today = dayKey(new Date().toISOString());
  const yesterday = dayKey(isoDaysAgo(1));
  const last = days[days.length - 1];
  let current = 0;
  if (last === today || last === yesterday) {
    current = 1;
    for (let i = days.length - 1; i > 0; i--) {
      const diff = Math.round((new Date(days[i]) - new Date(days[i - 1])) / 86400000);
      if (diff === 1) current++;
      else break;
    }
  }
  return { current, max };
}

export async function fetchUserStats(userId) {
  const DIFFICULTIES = ["starter", "easy", "medium", "hard"];
  const [
    totalSubmitRes, acRes, solvedRes, recentRes, activityRes, rankRes, ...difficultyCountRes
  ] = await Promise.all([
    supabase.from("submissions").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("kind", "submit"),
    supabase.from("submissions").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("kind", "submit").eq("verdict", "AC"),
    supabase.from("solved_problems").select("problem_id, solved_at, problems(difficulty)").eq("user_id", userId),
    supabase.from("submissions")
      .select("id, problem_id, language, verdict, time_ms, memory_kb, created_at, problems(title)")
      .eq("user_id", userId).eq("kind", "submit")
      .order("created_at", { ascending: false }).limit(8),
    supabase.from("submissions").select("created_at").eq("user_id", userId).eq("kind", "submit").gte("created_at", isoDaysAgo(370)),
    supabase.rpc("my_rank"),
    // Catalog size per difficulty, counted in the database (the old code counted
    // whatever page of problems happened to be loaded in the browser).
    ...DIFFICULTIES.map((d) => supabase.from("problems").select("id", { count: "exact", head: true }).eq("difficulty", d)),
  ]);

  if (totalSubmitRes.error) throw totalSubmitRes.error;
  if (acRes.error) throw acRes.error;
  if (solvedRes.error) throw solvedRes.error;
  if (recentRes.error) throw recentRes.error;
  if (activityRes.error) throw activityRes.error;

  const solvedByDifficulty = { starter: 0, easy: 0, medium: 0, hard: 0 };
  for (const row of solvedRes.data || []) {
    const d = row.problems?.difficulty;
    if (d && d in solvedByDifficulty) solvedByDifficulty[d]++;
  }
  const totalSolved = (solvedRes.data || []).length;

  const totalByDifficulty = { starter: 0, easy: 0, medium: 0, hard: 0 };
  DIFFICULTIES.forEach((d, i) => { totalByDifficulty[d] = difficultyCountRes[i]?.count || 0; });

  const totalSubmissions = totalSubmitRes.count || 0;
  const acCount = acRes.count || 0;
  const acceptanceRate = totalSubmissions > 0 ? acCount / totalSubmissions : 0;

  const { current, max } = computeStreaks((solvedRes.data || []).map((r) => dayKey(r.solved_at)));

  const recentSubmissions = (recentRes.data || []).map((r) => ({
    id: r.id,
    problemId: r.problem_id,
    problemTitle: r.problems?.title || r.problem_id,
    language: r.language,
    verdict: r.verdict,
    runtime: r.time_ms != null ? Math.round(Number(r.time_ms)) : null,
    memory: r.memory_kb != null ? Number(r.memory_kb) : null,
    submittedAt: r.created_at,
  }));

  const countsByDay = {};
  for (const r of activityRes.data || []) {
    const k = dayKey(r.created_at);
    countsByDay[k] = (countsByDay[k] || 0) + 1;
  }
  const heatmap = [];
  for (let i = 370; i >= 0; i--) {
    const iso = isoDaysAgo(i);
    const k = dayKey(iso);
    const count = countsByDay[k] || 0;
    let level = 0;
    if (count >= 1) level = 1;
    if (count >= 2) level = 2;
    if (count >= 4) level = 3;
    if (count >= 6) level = 4;
    heatmap.push({ date: k, level, count });
  }

  return {
    stats: {
      solved: { ...solvedByDifficulty, total: totalSolved },
      solvedTotals: totalByDifficulty,
      totalSubmissions,
      acceptanceRate,
      currentStreak: current,
      maxStreak: max,
      rank: rankRes.data ?? null,
    },
    recentSubmissions,
    heatmap,
  };
}

// ---------------------------------------------------------------------------
// users (admin/Users.jsx)
// ---------------------------------------------------------------------------

/** Platform-wide ranking by total problems solved — top `limit` only.
 * Mirrors fetchContestLeaderboard's row-mapping convention exactly. */
export async function fetchGlobalLeaderboard({ limit = 100 } = {}) {
  const { data, error } = await supabase.rpc("get_global_leaderboard", { p_limit: limit });
  if (error) throw error;
  return (data || []).map((row) => ({
    userId: row.user_id,
    username: row.username,
    name: row.name,
    countryCode: row.country_code ?? null,
    solvedCount: row.solved_count,
    firstTryCount: row.first_try_count,
    topicCount: row.topic_count,
    score: row.score,
    rank: row.rank,
  }));
}

export async function fetchAllUsers() {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, name, role, created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function updateUserRole(userId, role) {
  const { error } = await supabase.from("profiles").update({ role }).eq("id", userId);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// admin dashboard (Dashboard.jsx)
// ---------------------------------------------------------------------------

export async function fetchAdminStats() {
  const [
    totalProblemsRes, totalUsersRes, problemsThisWeekRes, newUsersThisWeekRes,
    submissionsTodayRes, activeUsersRes,
  ] = await Promise.all([
    supabase.from("problems").select("id", { count: "exact", head: true }),
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.from("problems").select("id", { count: "exact", head: true }).gte("created_at", isoDaysAgo(7)),
    supabase.from("profiles").select("id", { count: "exact", head: true }).gte("created_at", isoDaysAgo(7)),
    supabase.from("submissions").select("id", { count: "exact", head: true }).gte("created_at", dayKey(new Date().toISOString())),
    supabase.from("submissions").select("user_id").gte("created_at", isoDaysAgo(1)),
  ]);

  for (const r of [totalProblemsRes, totalUsersRes, problemsThisWeekRes, newUsersThisWeekRes, submissionsTodayRes, activeUsersRes]) {
    if (r.error) throw r.error;
  }

  const activeUsers = new Set((activeUsersRes.data || []).map((r) => r.user_id)).size;

  return {
    totalProblems: totalProblemsRes.count || 0,
    totalUsers: totalUsersRes.count || 0,
    problemsThisWeek: problemsThisWeekRes.count || 0,
    newUsersThisWeek: newUsersThisWeekRes.count || 0,
    submissionsToday: submissionsTodayRes.count || 0,
    activeUsers,
  };
}

export async function fetchRecentActivity(limit = 8) {
  const [subsRes, signupsRes, problemsRes] = await Promise.all([
    supabase.from("submissions")
      .select("id, kind, verdict, problem_id, created_at, profiles(username), problems(title)")
      .order("created_at", { ascending: false }).limit(limit),
    supabase.from("profiles").select("id, username, created_at").order("created_at", { ascending: false }).limit(limit),
    supabase.from("problems").select("id, title, created_at, profiles!problems_created_by_fkey(username)").order("created_at", { ascending: false }).limit(limit),
  ]);
  if (subsRes.error) throw subsRes.error;
  if (signupsRes.error) throw signupsRes.error;
  if (problemsRes.error) throw problemsRes.error;

  const events = [
    ...(subsRes.data || []).map((s) => ({
      id: `sub-${s.id}`, type: "submission", actor: s.profiles?.username || "someone",
      target: s.problems?.title || s.problem_id, verdict: s.verdict, at: s.created_at,
    })),
    ...(signupsRes.data || []).map((u) => ({
      id: `signup-${u.id}`, type: "signup", actor: u.username || "someone", at: u.created_at,
    })),
    ...(problemsRes.data || []).map((p) => ({
      id: `upload-${p.id}`, type: "upload", actor: p.profiles?.username || "admin", target: p.title, at: p.created_at,
    })),
  ];
  events.sort((a, b) => new Date(b.at) - new Date(a.at));
  return events.slice(0, limit);
}

/** Per-problem submission counts + acceptance rate, keyed by problem id. */
export async function fetchProblemStats() {
  const { data, error } = await supabase.from("submissions").select("problem_id, verdict").eq("kind", "submit");
  if (error) throw error;
  const map = {};
  for (const row of data || []) {
    const s = (map[row.problem_id] ||= { submissions: 0, accepted: 0 });
    s.submissions++;
    if (row.verdict === "AC") s.accepted++;
  }
  return map;
}
