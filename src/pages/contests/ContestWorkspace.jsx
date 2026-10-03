import React, { useState, useEffect } from "react";
import { Play, Send, Loader2, Trophy, ArrowLeft, Lock, Check, CalendarPlus, Link2 } from "lucide-react";
import { useAuth } from "../../lib/auth.jsx";
import { fetchContest, submitContestSolution, fetchMyContestSubmissions, contestStatus, contestUrl, hasContestAccess, rsvpContest, fetchRsvpCount } from "../../lib/contestsApi.js";
import { useCountdown } from "../../hooks/useCountdown.js";
import { googleCalendarUrl, downloadIcs } from "../../lib/calendar.js";
import {
  LANG, LANG_BY_CATEGORY, starterFor, judge0Run, classifyVerdict,
  ProblemDescription, CodeArea, ResultsView, Tab,
} from "../ProblemPage.jsx";

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

  const [language, setLanguage] = useState("python");
  const [codeByProblem, setCodeByProblem] = useState({});
  const [running, setRunning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [resultsByProblem, setResultsByProblem] = useState({});
  const [activeTab, setActiveTab] = useState("problem");

  const readOnly = status !== "live";
  const code = codeByProblem[activeId] ?? (activeProblem ? starterFor(activeProblem, language) : "");
  const results = resultsByProblem[activeId] || null;

  useEffect(() => {
    if (!activeProblem || readOnly) return;
    setCodeByProblem((prev) => ({ ...prev, [activeId]: starterFor(activeProblem, language) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, activeId]);

  function setCode(next) {
    setCodeByProblem((prev) => ({ ...prev, [activeId]: next }));
  }

  async function handleRun() {
    setRunning(true); setActiveTab("results");
    setResultsByProblem((prev) => ({ ...prev, [activeId]: null }));
    try {
      const sampleResults = [];
      for (let i = 0; i < activeProblem.examples.length; i++) {
        const ex = activeProblem.examples[i];
        const stdin = ex.input === "(none)" ? "" : ex.input;
        const r = await judge0Run({
          sourceCode: code, languageId: LANG[language].id, stdin, expectedOutput: ex.output,
        });
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
      for (let i = 0; i < activeProblem.tests.length; i++) {
        const t = activeProblem.tests[i];
        const r = await judge0Run({
          sourceCode: code, languageId: LANG[language].id, stdin: t.input, expectedOutput: t.expected,
        });
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

      submitContestSolution({
        userId: user.id, contestId: contest.id, problemId: activeProblem.id, language, code,
        verdict, passed, total: activeProblem.tests.length, timeMs: maxTime * 1000, memoryKb: maxMem,
      }).then(() => {
        setSolvedByProblem((prev) => ({
          ...prev,
          [activeProblem.id]: { attempts: (prev[activeProblem.id]?.attempts || 0) + 1, solved: prev[activeProblem.id]?.solved || allPassed },
        }));
      }).catch(() => {});

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

      {status === "ended" && (
        <div className="max-w-[1400px] mx-auto px-4 pt-3">
          <div className="rounded-lg p-3 flex items-center gap-2.5 text-xs" style={{ background: "#f4f4f5", color: "var(--text-secondary)" }}>
            <Lock size={13} /> This contest has ended — view only. Check the leaderboard for final standings.
          </div>
        </div>
      )}

      {problems.length > 1 && (
        <div className="flex gap-1.5 px-4 pt-3">
          {problems.map((p, i) => {
            const solved = solvedByProblem[p.id]?.solved;
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
                {solved && <Check size={12} strokeWidth={3} />}
                Problem {i + 1}
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
            </div>
            <div className="p-6 overflow-y-auto flex-1">
              {activeTab === "problem" ? (
                <ProblemDescription problem={activeProblem} />
              ) : (
                <ResultsView results={results} running={running || submitting} />
              )}
            </div>
          </div>

          <div className="card overflow-hidden flex flex-col" style={{ background: "#0f172a", borderColor: "#0f172a", minHeight: "60vh" }}>
            <div className="px-3 py-2 flex items-center justify-between gap-2 flex-wrap" style={{ borderBottom: "1px solid #1e293b" }}>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                disabled={readOnly}
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
                  disabled={readOnly || running || submitting}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors disabled:opacity-40"
                  style={{ background: "#1e293b", color: "#e2e8f0", border: "1px solid #334155" }}
                >
                  {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} strokeWidth={2.5} fill="currentColor" />}
                  Run
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={readOnly || running || submitting}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-white transition-colors disabled:opacity-40"
                  style={{ background: "#059669" }}
                >
                  {submitting ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} strokeWidth={2.5} />}
                  Submit
                </button>
              </div>
            </div>
            <CodeArea code={code} setCode={setCode} readOnly={readOnly} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ContestHeader({ contest, status, onBack, onOpenLeaderboard }) {
  const { formatted, isPast } = useCountdown(contest.endsAt);
  return (
    <header
      className="sticky top-0 z-40 px-4 h-12 flex items-center justify-between"
      style={{ background: "rgba(255,255,255,0.9)", backdropFilter: "blur(8px)", borderBottom: "1px solid var(--border)" }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <button onClick={onBack} className="btn-ghost !px-2 !py-1 text-xs flex-shrink-0"><ArrowLeft size={13} /></button>
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
