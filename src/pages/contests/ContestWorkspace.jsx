import React, { useState, useEffect, useCallback } from "react";
import { Play, Send, Loader2, Trophy, ArrowLeft, Lock, Check, CalendarPlus, Link2 } from "lucide-react";
import { useAuth } from "../../lib/auth.jsx";
import { fetchContest, submitContestSolution, fetchMyContestSubmissions, contestStatus, contestUrl, hasContestAccess, rsvpContest, fetchRsvpCount, startContestProblem, fetchMyProblemStarts, fetchMyProblemSubmissions, formatTaken } from "../../lib/contestsApi.js";
import { useCountdown } from "../../hooks/useCountdown.js";
import { insertSubmission, markSolved } from "../../lib/db.js";
import ContestLeaderboard from "./ContestLeaderboard.jsx";
import { googleCalendarUrl, downloadIcs } from "../../lib/calendar.js";
import {
  LANG, LANG_BY_CATEGORY, starterFor, judge0RunBatch, classifyVerdict,
  ProblemDescription, CodeArea, ResultsView, Tab,
} from "../ProblemPage.jsx";

// Drafts and the chosen language live in localStorage so they survive leaving
// the page (Standings, Exit, a refresh) — the workspace itself unmounts.
const draftKey = (contestId, problemId, lang) => `sparx:draft:${contestId}:${problemId}:${lang}`;
function readStored(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeStored(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage full or blocked — keep working in memory */ }
}
function initialLanguage() {
  const saved = readStored("sparx:language");
  return saved && LANG[saved] ? saved : "python";
}

export default function ContestWorkspace({ contest: contestSummary, onBack, onOpenLeaderboard }) {
  const { user } = useAuth();
  const [contest, setContest] = useState(null);
  const [error, setError] = useState(null);
  const [solvedByProblem, setSolvedByProblem] = useState({});
  const [access, setAccess] = useState(contestSummary.requiresAccess ? null : true);

  useEffect(() => {
    if (!contestSummary.requiresAccess) return;
    hasContestAccess(contestSummary.id).then(setAccess).catch(() => setAccess(false));
  }, [contestSummary.id, contestSummary.requiresAccess]);

  useEffect(() => {
    if (access !== true) return;
    fetchContest(contestSummary.id).then(setContest).catch((e) => setError(e.message));
    fetchMyContestSubmissions(user.id, contestSummary.id).then(setSolvedByProblem).catch(() => {});
  }, [contestSummary.id, user.id, access]);

  if (access === null) return <CenteredMessage title="Checking access…" spinner onBack={onBack} />;
  if (access === false && contestStatus(contestSummary) === "ended") {
    return (
      <ContestLeaderboard
        contest={contestSummary}
        onBack={onBack}
        backLabel="Back to contests"
        banner="This contest has ended. You didn't RSVP, so its problems weren't open to you during the contest. Here are the final standings — the same problems are available to practice in the Problems list."
      />
    );
  }
  if (access === false) {
    return <RsvpGate contest={contestSummary} onUnlocked={() => setAccess(true)} onBack={onBack} />;
  }
  if (error) return <CenteredMessage title="Couldn't load this contest" detail={error} onBack={onBack} />;
  if (!contest) return <CenteredMessage title="Loading contest…" spinner onBack={onBack} />;

  return (
    <Workspace
      contest={contest}
      solvedByProblem={solvedByProblem}
      setSolvedByProblem={setSolvedByProblem}
      onBack={onBack}
      onOpenLeaderboard={onOpenLeaderboard}
    />
  );
}

function Workspace({ contest, solvedByProblem, setSolvedByProblem, onBack, onOpenLeaderboard }) {
  const { user } = useAuth();
  const status = contestStatus(contest);
  const problems = contest.problems;
  const [activeId, setActiveId] = useState(problems[0]?.id);
  const activeProblem = problems.find((p) => p.id === activeId);

  const [language, setLanguageState] = useState(initialLanguage);
  const [drafts, setDrafts] = useState({});
  const [history, setHistory] = useState({});
  const [saveError, setSaveError] = useState({});
  function setLanguage(next) {
    setLanguageState(next);
    writeStored("sparx:language", next);
  }
  const [running, setRunning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [resultsByProblem, setResultsByProblem] = useState({});
  const [activeTab, setActiveTab] = useState("problem");

  const live = status === "live";
  const practice = status === "ended"; // after the end: keep coding, but nothing counts for the standings
  const [starts, setStarts] = useState({});
  const dKey = draftKey(contest.id, activeId, language);
  const code = drafts[dKey] ?? readStored(dKey) ?? (activeProblem ? starterFor(activeProblem, language) : "");
  const results = resultsByProblem[activeId] || null;

  useEffect(() => {
    fetchMyProblemStarts(user.id, contest.id).then(setStarts).catch(() => {});
  }, [user.id, contest.id]);

  // The per-question clock starts the first time a question is opened (idempotent on the server).
  useEffect(() => {
    if (!live || !activeId) return;
    startContestProblem(contest.id, activeId).then((ts) => {
      setStarts((prev) => (prev[activeId] != null ? prev : { ...prev, [activeId]: ts ?? Date.now() }));
    });
  }, [activeId, live, contest.id]);

  const loadHistory = useCallback((problemId) => {
    fetchMyProblemSubmissions(user.id, contest.id, problemId)
      .then((rows) => setHistory((prev) => ({ ...prev, [problemId]: rows })))
      .catch(() => {});
  }, [user.id, contest.id]);

  useEffect(() => {
    if (activeId) loadHistory(activeId);
  }, [activeId, loadHistory]);

  function setCode(next) {
    setDrafts((prev) => ({ ...prev, [dKey]: next }));
    writeStored(dKey, next);
  }

  function restoreSubmission(row) {
    if (!LANG[row.language]) return;
    const key = draftKey(contest.id, activeId, row.language);
    setLanguage(row.language);
    setDrafts((prev) => ({ ...prev, [key]: row.code }));
    writeStored(key, row.code);
  }

  async function handleRun() {
    setRunning(true); setActiveTab("results");
    setResultsByProblem((prev) => ({ ...prev, [activeId]: null }));
    try {
      const sampleResults = [];
      const batch = await judge0RunBatch({
        sourceCode: code, languageId: LANG[language].id,
        cases: activeProblem.examples.map((ex) => ({ stdin: ex.input === "(none)" ? "" : ex.input, expectedOutput: ex.output })),
      });
      for (let i = 0; i < activeProblem.examples.length; i++) {
        const ex = activeProblem.examples[i];
        const r = batch[i];
        const verdict = classifyVerdict(r.status, ex.output, r.stdout);
        sampleResults.push({
          index: i + 1, input: ex.input, expected: ex.output,
          actual: (r.stdout || "").trimEnd(), stderr: r.stderr || r.compile_output || "",
          verdict, time: r.time, memory: r.memory, isSample: true,
        });
      }
      setResultsByProblem((prev) => ({ ...prev, [activeId]: { kind: "run", tests: sampleResults } }));
    } catch (e) {
      setResultsByProblem((prev) => ({ ...prev, [activeId]: { kind: "error", message: e.message } }));
    } finally {
      setRunning(false);
    }
  }

  async function handleSubmit() {
    setSubmitting(true); setActiveTab("results");
    setResultsByProblem((prev) => ({ ...prev, [activeId]: null }));
    try {
      const allResults = [];
      let passed = 0, firstFailIndex = null, maxTime = 0, maxMem = 0;
      const batch = await judge0RunBatch({
        sourceCode: code, languageId: LANG[language].id,
        cases: activeProblem.tests.map((t) => ({ stdin: t.input, expectedOutput: t.expected })),
      });
      for (let i = 0; i < activeProblem.tests.length; i++) {
        const t = activeProblem.tests[i];
        const r = batch[i];
        const verdict = classifyVerdict(r.status, t.expected, r.stdout);
        const time = parseFloat(r.time || "0");
        const mem = r.memory || 0;
        if (time > maxTime) maxTime = time;
        if (mem > maxMem) maxMem = mem;
        allResults.push({
          index: i + 1, input: t.input, expected: t.expected,
          actual: (r.stdout || "").trimEnd(), stderr: r.stderr || r.compile_output || "",
          verdict, isSample: i < activeProblem.examples.length,
        });
        if (verdict === "AC") passed++;
        else { firstFailIndex = i; break; }
      }
      const allPassed = passed === activeProblem.tests.length;
      const verdict = allPassed ? "AC" : allResults[firstFailIndex]?.verdict || "WA";

      const saved = practice
        // After the contest: an ordinary practice submission, not tied to the contest or its standings.
        ? insertSubmission({
            userId: user.id, problemId: activeProblem.id, kind: "submit", language, code,
            verdict, passed, total: activeProblem.tests.length, timeMs: maxTime * 1000, memoryKb: maxMem,
          }).then(() => (allPassed ? markSolved(user.id, activeProblem.id) : null))
        : submitContestSolution({
            userId: user.id, contestId: contest.id, problemId: activeProblem.id, language, code,
            verdict, passed, total: activeProblem.tests.length, timeMs: maxTime * 1000, memoryKb: maxMem,
          });
      saved.then(() => {
        if (practice) return;
        setSaveError((prev) => ({ ...prev, [activeProblem.id]: false }));
        loadHistory(activeProblem.id);
        setSolvedByProblem((prev) => ({
          ...prev,
          [activeProblem.id]: {
            attempts: (prev[activeProblem.id]?.attempts || 0) + 1,
            solved: prev[activeProblem.id]?.solved || allPassed,
            firstAcAt: prev[activeProblem.id]?.firstAcAt || (allPassed ? new Date().toISOString() : null),
          },
        }));
      }).catch(() => setSaveError((prev) => ({ ...prev, [activeProblem.id]: true })));

      setResultsByProblem((prev) => ({
        ...prev,
        [activeId]: { kind: "submit", tests: allResults, passed, total: activeProblem.tests.length, verdict, time: maxTime, memory: maxMem },
      }));
    } catch (e) {
      setResultsByProblem((prev) => ({ ...prev, [activeId]: { kind: "error", message: e.message } }));
    } finally {
      setSubmitting(false);
    }
  }

  if (status === "upcoming") {
    return <UpcomingScreen contest={contest} onBack={onBack} />;
  }

  if (!activeProblem) return <CenteredMessage title="No problems in this contest" onBack={onBack} />;

  return (
    <div className="min-h-screen" style={{ background: "var(--bg-app)" }}>
      <ContestHeader contest={contest} status={status} onBack={onBack} onOpenLeaderboard={onOpenLeaderboard} />

      {practice && (
        <div className="max-w-[1400px] mx-auto px-4 pt-3">
          <div className="rounded-lg p-3 flex items-center gap-3 text-xs flex-wrap" style={{ background: "var(--accent-soft)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
            <Trophy size={14} style={{ color: "var(--accent)" }} />
            <span className="flex-1 min-w-[240px]">
              <b style={{ color: "var(--text-primary)" }}>Practice mode.</b> This contest has ended. Write, run and submit as much as you like — it won't change the final standings.
            </span>
            <button onClick={onOpenLeaderboard} className="btn-secondary !px-2.5 !py-1 text-xs">View final standings</button>
          </div>
        </div>
      )}

      {problems.length >= 1 && (
        <div className="flex gap-1.5 px-4 pt-3 flex-wrap">
          {problems.map((p, i) => {
            const info = solvedByProblem[p.id];
            const startMs = starts[p.id] ?? new Date(contest.startsAt).getTime();
            const takenSec = info?.firstAcAt ? Math.max(0, Math.round((new Date(info.firstAcAt).getTime() - startMs) / 1000)) : null;
            return (
              <button
                key={p.id}
                onClick={() => setActiveId(p.id)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                style={{
                  background: activeId === p.id ? "var(--accent)" : "white",
                  color: activeId === p.id ? "white" : "var(--text-secondary)",
                  border: "1px solid " + (activeId === p.id ? "var(--accent)" : "var(--border)"),
                }}
              >
                {info?.solved && <Check size={12} strokeWidth={3} />}
                Problem {i + 1}
                {info?.solved ? (
                  <span className="font-mono font-medium opacity-90">· {formatTaken(takenSec)}</span>
                ) : (
                  starts[p.id] != null && live && <QuestionTimer startedAt={starts[p.id]} />
                )}
              </button>
            );
          })}
        </div>
      )}

      <div className="max-w-[1400px] mx-auto px-4 py-4">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.1fr] gap-4">
          <div className="card overflow-hidden flex flex-col" style={{ minHeight: "calc(100vh - 220px)" }}>
            <div className="flex border-b" style={{ borderColor: "var(--border)" }}>
              <Tab icon={null} active={activeTab === "problem"} onClick={() => setActiveTab("problem")} label="Description" />
              <Tab
                icon={null}
                active={activeTab === "results"}
                onClick={() => setActiveTab("results")}
                label="Submission"
                badge={results?.kind === "submit" && results.verdict === "AC" ? "ac" : results?.kind === "submit" ? "fail" : null}
              />
              <Tab
                icon={null}
                active={activeTab === "history"}
                onClick={() => setActiveTab("history")}
                label={`My submissions${history[activeId]?.length ? ` (${history[activeId].length})` : ""}`}
              />
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              {activeTab === "problem" ? (
                <ProblemDescription problem={activeProblem} />
              ) : activeTab === "history" ? (
                <SubmissionHistory rows={history[activeId]} canRestore onRestore={restoreSubmission} />
              ) : (
                <>
                  {saveError[activeId] && (
                    <div className="rounded-lg p-3 mb-4 text-xs" style={{ background: "#fef2f2", color: "#b91c1c", border: "1px solid #fecaca" }}>
                      Your last submission could not be saved, so it may not appear in My submissions or the standings. Check your connection and submit again.
                    </div>
                  )}
                  <ResultsView results={results} running={running || submitting} />
                </>
              )}
            </div>
          </div>

          <div className="card overflow-hidden flex flex-col" style={{ background: "#0f172a", borderColor: "#0f172a", minHeight: "60vh" }}>
            <div className="px-3 py-2 flex items-center justify-between gap-2 flex-wrap" style={{ borderBottom: "1px solid #1e293b" }}>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="text-xs font-medium px-2.5 py-1 rounded-md cursor-pointer focus:outline-none"
                style={{ background: "#1e293b", color: "#e2e8f0", border: "1px solid #334155" }}
              >
                {Object.entries(LANG_BY_CATEGORY).map(([cat, keys]) => (
                  <optgroup key={cat} label={cat}>
                    {keys.map((k) => <option key={k} value={k}>{LANG[k].display}</option>)}
                  </optgroup>
                ))}
              </select>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleRun}
                  disabled={running || submitting}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors disabled:opacity-40"
                  style={{ background: "#1e293b", color: "#e2e8f0", border: "1px solid #334155" }}
                >
                  {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} strokeWidth={2.5} fill="currentColor" />}
                  Run
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={running || submitting}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-white transition-colors disabled:opacity-40"
                  style={{ background: "#059669" }}
                >
                  {submitting ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} strokeWidth={2.5} />}
                  Submit
                </button>
              </div>
            </div>
            <CodeArea code={code} setCode={setCode} />
          </div>
        </div>
      </div>
    </div>
  );
}

function SubmissionHistory({ rows, canRestore, onRestore }) {
  const [open, setOpen] = useState(null);
  if (rows === undefined) {
    return <div className="flex justify-center py-8"><Loader2 size={18} className="animate-spin" style={{ color: "var(--accent)" }} /></div>;
  }
  if (rows.length === 0) {
    return <div className="text-sm text-center py-8" style={{ color: "var(--text-muted)" }}>No submissions for this question yet.</div>;
  }
  return (
    <div className="space-y-2">
      {rows.map((r) => {
        const ac = r.verdict === "AC";
        return (
          <div key={r.id} className="rounded-lg" style={{ border: "1px solid var(--border)" }}>
            <button
              onClick={() => setOpen(open === r.id ? null : r.id)}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-left text-xs"
            >
              <span
                className="px-2 py-0.5 rounded-full font-bold"
                style={{ background: ac ? "#ecfdf5" : "#fef2f2", color: ac ? "#047857" : "#b91c1c" }}
              >
                {ac ? "Accepted" : r.verdict}
              </span>
              <span style={{ color: "var(--text-secondary)" }}>{r.passed ?? "?"}/{r.total ?? "?"} tests</span>
              <span style={{ color: "var(--text-muted)" }}>{LANG[r.language]?.display || r.language}</span>
              <span className="ml-auto" style={{ color: "var(--text-muted)" }}>
                {new Date(r.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            </button>
            {open === r.id && (
              <div className="px-3 pb-3">
                <pre className="text-xs rounded-md p-3 overflow-auto max-h-64" style={{ background: "#0f172a", color: "#e2e8f0" }}>{r.code}</pre>
                <div className="flex items-center justify-between mt-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
                  <span>{r.time_ms != null ? `${Math.round(r.time_ms)} ms` : ""}{r.memory_kb ? ` · ${Math.round(r.memory_kb)} KB` : ""}</span>
                  {canRestore && LANG[r.language] && (
                    <button className="btn-secondary !px-2.5 !py-1 text-xs" onClick={() => onRestore(r)}>Restore to editor</button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function QuestionTimer({ startedAt }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const sec = Math.max(0, Math.floor((now - startedAt) / 1000));
  const m = Math.floor(sec / 60), r = sec % 60;
  return <span className="font-mono font-medium opacity-90">· {String(m).padStart(2, "0")}:{String(r).padStart(2, "0")}</span>;
}

function ContestHeader({ contest, status, onBack, onOpenLeaderboard }) {
  const { formatted, isPast } = useCountdown(contest.endsAt);
  return (
    <header
      className="sticky top-0 z-40 px-4 h-12 flex items-center justify-between"
      style={{ background: "rgba(255,255,255,0.9)", backdropFilter: "blur(8px)", borderBottom: "1px solid var(--border)" }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <button onClick={onBack} className="btn-secondary !px-2.5 !py-1 text-xs flex-shrink-0" title="Leave this page — the contest timer keeps running">
          <ArrowLeft size={13} /> Exit contest
        </button>
        <div className="flex items-center gap-2 text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>
          <Trophy size={15} style={{ color: "var(--accent)" }} /> {contest.title}
        </div>
      </div>
      <div className="flex items-center gap-3 text-xs flex-shrink-0">
        {status === "live" && !isPast && (
          <span className="font-mono font-semibold" style={{ color: "var(--accent)" }}>{formatted} left</span>
        )}
        <button onClick={onOpenLeaderboard} className="btn-ghost !px-2 !py-1 text-xs">
          <Trophy size={12} /> Standings
        </button>
      </div>
    </header>
  );
}

function CopyLinkButton({ contest }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard?.writeText(contestUrl(contest.id));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <button onClick={copy} className="btn-ghost w-full justify-center text-xs mb-1">
      <Link2 size={13} /> {copied ? "Link copied" : "Copy contest link"}
    </button>
  );
}

function UpcomingScreen({ contest, onBack }) {
  const { formatted, isPast } = useCountdown(contest.startsAt);
  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "var(--bg-app)" }}>
      <div className="card p-8 max-w-sm text-center">
        <Trophy size={28} className="mx-auto mb-3" style={{ color: "var(--accent)" }} />
        <div className="text-base font-semibold mb-1" style={{ color: "var(--text-primary)" }}>{contest.title}</div>
        <p className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>
          {isPast ? "Starting…" : "Hasn't started yet."} {contest.problems.length} problem{contest.problems.length === 1 ? "" : "s"}.
        </p>
        <div className="text-2xl font-mono font-bold mb-2" style={{ color: "var(--accent)" }}>{formatted}</div>
        <div className="text-xs mb-5" style={{ color: "var(--text-muted)" }}>
          {new Date(contest.startsAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
        </div>
        <div className="flex gap-2 mb-3">
          <a href={googleCalendarUrl(contest)} target="_blank" rel="noreferrer" className="btn-primary flex-1 justify-center text-xs">
            <CalendarPlus size={14} /> Google Calendar
          </a>
          <button onClick={() => downloadIcs(contest)} className="btn-secondary flex-1 justify-center text-xs">
            <CalendarPlus size={14} /> Apple / Outlook
          </button>
        </div>
        <CopyLinkButton contest={contest} />
        <button className="btn-secondary w-full justify-center" onClick={onBack}>Back to contests</button>
      </div>
    </div>
  );
}

function CenteredMessage({ title, detail, spinner, onBack }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "var(--bg-app)" }}>
      <div className="text-center">
        {spinner && <Loader2 size={24} className="animate-spin mx-auto mb-3" style={{ color: "var(--accent)" }} />}
        <div className="text-base font-semibold mb-1" style={{ color: "var(--text-primary)" }}>{title}</div>
        {detail && <div className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>{detail}</div>}
        {onBack && <button className="btn-secondary" onClick={onBack}>Back</button>}
      </div>
    </div>
  );
}

function RsvpGate({ contest, onUnlocked, onBack }) {
  const [going, setGoing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const ended = contestStatus(contest) === "ended";

  useEffect(() => {
    fetchRsvpCount(contest.id).then(setGoing).catch(() => {});
  }, [contest.id]);

  async function rsvp() {
    setBusy(true);
    setError(null);
    try {
      if (await rsvpContest(contest.id)) onUnlocked();
      else setError("Couldn't RSVP — your RSVP may have been removed by the organisers.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "var(--bg-app)" }}>
      <div className="card p-8 max-w-md w-full text-center">
        <div className="w-12 h-12 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ background: "var(--accent-soft)" }}>
          <Lock size={20} style={{ color: "var(--accent)" }} />
        </div>
        <div className="text-lg font-bold mb-1" style={{ color: "var(--text-primary)" }}>{contest.title}</div>
        <p className="text-sm mb-5" style={{ color: "var(--text-secondary)" }}>
          {ended
            ? "This contest has ended and was open to RSVPs only."
            : "RSVP to take part in this contest. Only people who RSVP can open the problems and submit."}
        </p>
        {contest.meetupUrl && !ended && (
          <a href={contest.meetupUrl} target="_blank" rel="noreferrer" className="btn-secondary w-full justify-center mb-3">
            RSVP on Meetup first
          </a>
        )}
        {!ended && (
          <button className="btn-primary w-full justify-center" disabled={busy} onClick={rsvp}>
            {busy ? "RSVPing…" : "I'm going — RSVP"}
          </button>
        )}
        {going != null && going > 0 && (
          <div className="text-xs mt-3" style={{ color: "var(--text-muted)" }}>{going} going</div>
        )}
        {error && <div className="text-xs mt-3" style={{ color: "#b91c1c" }}>{error}</div>}
        <div className="mt-3"><CopyLinkButton contest={contest} /></div>
        <button type="button" className="btn-ghost" onClick={onBack}>Back</button>
      </div>
    </div>
  );
}
