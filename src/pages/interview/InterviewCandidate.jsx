import React, { useState, useEffect, useMemo, useRef } from "react";
import { Play, Send, Loader2, Wifi, WifiOff, Zap, Smartphone, Globe, CheckCircle2, X } from "lucide-react";
import { fetchAllProblems } from "../../lib/db.js";
import { getInterview, endInterview, forkInterview, dartpadEmbedUrl, buildWebUIDoc } from "../../interview/interviewApi.js";
import { useInterviewSocket } from "../../interview/useInterviewSocket.js";
import { useCountdown } from "../../interview/countdown.js";
import {
  LANG, LANG_BY_CATEGORY, starterFor, judge0RunBatch, classifyVerdict,
  ProblemDescription, CodeArea, ResultsView, Tab,
} from "../ProblemPage.jsx";

const FLUTTER_TAB = "__flutter__";
const WEBUI_TAB = "__webui__";
const DEFAULT_WEBUI = {
  html: `<div class="card">\n  <h1>Hello!</h1>\n  <p>Start building.</p>\n</div>`,
  css: `.card {\n  font-family: sans-serif;\n  padding: 24px;\n  border-radius: 12px;\n  background: #f4f4f5;\n}`,
  js: `// your code here`,
};

export default function InterviewCandidate({ roomId }) {
  const [room, setRoom] = useState(null);
  const [roomError, setRoomError] = useState(null);
  const [problemsById, setProblemsById] = useState(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [college, setCollege] = useState("");
  const [year, setYear] = useState("");
  const [branch, setBranch] = useState("");
  const [phone, setPhone] = useState("");
  const [joined, setJoined] = useState(false);
  const [forking, setForking] = useState(false);
  const [forkError, setForkError] = useState(null);

  // Read once, like App.jsx's own one-time route parse — this app has no
  // client-side router, so a freshly-forked room (see handleTemplateJoin
  // below) has to arrive here via a real navigation, and this is how the
  // candidate's details survive that trip without asking them to re-enter them.
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const nameFromFork = params.get("name");
  const emailFromFork = params.get("email");
  const collegeFromFork = params.get("college");
  const yearFromFork = params.get("year");
  const branchFromFork = params.get("branch");
  const phoneFromFork = params.get("phone");

  useEffect(() => {
    getInterview(roomId)
      .then((r) => {
        setRoom(r);
        if (nameFromFork) {
          setName(nameFromFork);
          setEmail(emailFromFork || "");
          setCollege(collegeFromFork || "");
          setYear(yearFromFork || "");
          setBranch(branchFromFork || "");
          setPhone(phoneFromFork || "");
          setJoined(true);
        }
      })
      .catch((e) => setRoomError(e.message));
    fetchAllProblems()
      .then((list) => setProblemsById(Object.fromEntries(list.map((p) => [p.id, p]))))
      .catch(() => setProblemsById({}));
  }, [roomId, nameFromFork, emailFromFork, collegeFromFork, yearFromFork, branchFromFork, phoneFromFork]);

  async function handleTemplateJoin(details) {
    setForking(true);
    setForkError(null);
    try {
      const forked = await forkInterview(roomId, details.name);
      const q = new URLSearchParams(details).toString();
      window.location.replace(`/interview/${forked.roomId}/candidate?${q}`);
    } catch (e) {
      setForkError(e.message);
      setForking(false);
    }
  }

  if (roomError) return <CenteredMessage title="This interview link isn't valid" detail={roomError} />;
  if (!room || !problemsById) return <CenteredMessage title="Loading interview…" spinner />;

  const details = { name, email, college, year, branch, phone };

  if (!joined) {
    return (
      <NameGate
        title={room.candidateTitle || room.title}
        details={details}
        setters={{ setName, setEmail, setCollege, setYear, setBranch, setPhone }}
        onJoin={() => (room.isTemplate ? handleTemplateJoin(details) : setJoined(true))}
        joining={forking}
        error={forkError}
      />
    );
  }

  return <CandidateWorkspace room={room} problemsById={problemsById} candidateDetails={details} roomId={roomId} />;
}

const CANDIDATE_FIELDS = [
  { key: "name", placeholder: "Your name", type: "text" },
  { key: "email", placeholder: "Your email", type: "email" },
  { key: "college", placeholder: "Your college", type: "text" },
  { key: "year", placeholder: "Year (e.g. 3rd Year)", type: "text" },
  { key: "branch", placeholder: "Branch (e.g. Computer Science)", type: "text" },
  { key: "phone", placeholder: "Phone number", type: "tel" },
];

function NameGate({ title, details, setters, onJoin, joining, error }) {
  const canJoin = CANDIDATE_FIELDS.every(({ key }) => details[key].trim())
    && details.email.trim().includes("@")
    && !joining;
  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "var(--bg-app)" }}>
      <div className="card p-8 w-full max-w-sm text-center">
        <div
          className="w-12 h-12 rounded-xl mx-auto mb-4 flex items-center justify-center"
          style={{ background: "linear-gradient(135deg, #13B9FD 0%, #0553B1 100%)" }}
        >
          <Zap size={22} color="white" strokeWidth={2.5} fill="white" />
        </div>
        <div className="text-lg font-bold mb-1" style={{ color: "var(--text-primary)" }}>{title}</div>
        <p className="text-sm mb-5" style={{ color: "var(--text-secondary)" }}>
          Enter your details so the interviewer knows it's you, then start solving.
        </p>
        {CANDIDATE_FIELDS.map(({ key, placeholder, type }, i) => (
          <input
            key={key}
            autoFocus={i === 0}
            type={type}
            value={details[key]}
            onChange={(e) => setters[`set${key[0].toUpperCase()}${key.slice(1)}`](e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && canJoin) onJoin(); }}
            placeholder={placeholder}
            className={`input-field text-center ${i === CANDIDATE_FIELDS.length - 1 ? "mb-4" : "mb-3"}`}
          />
        ))}
        {error && <p className="text-xs mb-3" style={{ color: "#b91c1c" }}>{error}</p>}
        <button
          className="btn-primary w-full justify-center"
          disabled={!canJoin}
          onClick={onJoin}
        >
          {joining ? "Starting your session…" : "Start interview"}
        </button>
      </div>
    </div>
  );
}

function CandidateWorkspace({ room, problemsById, candidateDetails, roomId }) {
  const { name: candidateName } = candidateDetails;
  const problems = room.problemIds.map((id) => problemsById[id]).filter(Boolean);
  const [activeId, setActiveId] = useState(
    problems[0]?.id ?? (room.flutterRound ? FLUTTER_TAB : room.webuiRound ? WEBUI_TAB : undefined)
  );
  const isFlutterTab = activeId === FLUTTER_TAB;
  const isWebUITab = activeId === WEBUI_TAB;
  const activeProblem = (isFlutterTab || isWebUITab) ? null : problemsById[activeId];

  const [language, setLanguage] = useState("python");
  const [codeByProblem, setCodeByProblem] = useState({});
  const [running, setRunning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [resultsByProblem, setResultsByProblem] = useState({});
  const [activeTab, setActiveTab] = useState("problem");
  const [interviewerCount, setInterviewerCount] = useState(0);
  const [webuiCode, setWebuiCode] = useState(DEFAULT_WEBUI);
  const [webuiEditor, setWebuiEditor] = useState("html");
  const [endReason, setEndReason] = useState(null);
  const [ending, setEnding] = useState(false);
  const [testStartedAt, setTestStartedAt] = useState(room.testStartedAt ?? null);
  const interviewEnded = endReason !== null;

  const { connected, send, stop } = useInterviewSocket(roomId, "candidate", (msg) => {
    if (msg.type === "presence" && msg.role === "interviewer") {
      setInterviewerCount(msg.count || 0);
    } else if (msg.type === "ended") {
      setEndReason(msg.reason || "manual");
    } else if (msg.type === "timing") {
      setTestStartedAt(msg.testStartedAt);
    } else if (msg.type === "snapshot" && msg.state?.testStartedAt) {
      setTestStartedAt(msg.state.testStartedAt);
    }
  });

  // Stop retrying to reconnect once the interview has ended (however it
  // ended) — the room is gone, so there's nothing left to reconnect to.
  useEffect(() => {
    if (interviewEnded) stop();
  }, [interviewEnded, stop]);

  async function handleEndTest() {
    if (!window.confirm("End your interview now? This can't be undone.")) return;
    setEnding(true);
    try {
      await endInterview(roomId);
      setEndReason("manual");
      stop();
    } catch {
      setEnding(false);
    }
  }

  const timeRemaining = useCountdown(testStartedAt, room.timeLimitMinutes);

  const sentNameRef = useRef(false);
  useEffect(() => {
    if (connected && !sentNameRef.current) {
      send({ type: "name", ...candidateDetails });
      sentNameRef.current = true;
    }
  }, [connected, candidateDetails, send]);

  const code = (isFlutterTab || isWebUITab) ? "" : (codeByProblem[activeId] ?? starterFor(activeProblem, language));

  useEffect(() => {
    if (isFlutterTab || isWebUITab) return;
    const starter = starterFor(activeProblem, language);
    setCodeByProblem((prev) => ({ ...prev, [activeId]: starter }));
    send({ type: "code", problemId: activeId, language, code: starter });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, activeId]);

  useEffect(() => {
    send({ type: "activeProblem", problemId: activeId });
  }, [activeId, send]);

  // Re-sync the interviewer with whatever's currently on screen once the
  // socket (re)connects — covers the initial connect race and any reconnect.
  useEffect(() => {
    if (!connected) return;
    if (room.webuiRound) send({ type: "webuiCode", ...webuiCode });
    if (isFlutterTab || isWebUITab) return;
    send({ type: "activeProblem", problemId: activeId });
    send({ type: "code", problemId: activeId, language, code: codeByProblem[activeId] ?? starterFor(activeProblem, language) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  const webuiDebounceRef = useRef(null);
  function updateWebui(part, value) {
    setWebuiCode((prev) => {
      const next = { ...prev, [part]: value };
      clearTimeout(webuiDebounceRef.current);
      webuiDebounceRef.current = setTimeout(() => send({ type: "webuiCode", ...next }), 250);
      return next;
    });
  }

  const debounceRef = useRef(null);
  function setCode(next) {
    setCodeByProblem((prev) => ({ ...prev, [activeId]: next }));
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      send({ type: "code", problemId: activeId, language, code: next });
    }, 250);
  }

  const results = resultsByProblem[activeId] || null;

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
      const result = { kind: "run", tests: sampleResults };
      setResultsByProblem((prev) => ({ ...prev, [activeId]: result }));
      send({ type: "result", problemId: activeId, result });
    } catch (e) {
      const result = { kind: "error", message: e.message };
      setResultsByProblem((prev) => ({ ...prev, [activeId]: result }));
      send({ type: "result", problemId: activeId, result });
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
      const result = {
        kind: "submit", tests: allResults, passed, total: activeProblem.tests.length,
        verdict: allPassed ? "AC" : allResults[firstFailIndex]?.verdict || "WA",
        time: maxTime, memory: maxMem,
      };
      setResultsByProblem((prev) => ({ ...prev, [activeId]: result }));
      send({ type: "result", problemId: activeId, result });
    } catch (e) {
      const result = { kind: "error", message: e.message };
      setResultsByProblem((prev) => ({ ...prev, [activeId]: result }));
      send({ type: "result", problemId: activeId, result });
    } finally {
      setSubmitting(false);
    }
  }

  if (!activeProblem && !isFlutterTab && !isWebUITab) return <CenteredMessage title="No problems assigned to this interview" />;
  if (interviewEnded) return <ThankYouScreen candidateName={candidateName} reason={endReason} />;

  return (
    <div className="min-h-screen" style={{ background: "var(--bg-app)" }}>
      <header
        className="sticky top-0 z-40 px-4 h-12 flex items-center justify-between"
        style={{ background: "rgba(255,255,255,0.9)", backdropFilter: "blur(8px)", borderBottom: "1px solid var(--border)" }}
      >
        <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          <Zap size={16} style={{ color: "var(--accent)" }} /> {room.candidateTitle || room.title}
        </div>
        <div className="flex items-center gap-3 text-xs" style={{ color: "var(--text-muted)" }}>
          <span>{candidateName}</span>
          {timeRemaining && (
            <span
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md font-mono font-semibold"
              style={{ background: "#f4f4f5", color: "var(--text-primary)" }}
            >
              {timeRemaining}
            </span>
          )}
          <ConnectionBadge connected={connected} label={connected ? (interviewerCount > 0 ? `${interviewerCount} interviewer watching` : "Live") : "Reconnecting…"} />
          <button
            onClick={handleEndTest}
            disabled={ending}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold transition-colors disabled:opacity-50"
            style={{ background: "#fee2e2", color: "#b91c1c" }}
          >
            <X size={12} /> {ending ? "Ending…" : "End test"}
          </button>
        </div>
      </header>

      {problems.length + (room.flutterRound ? 1 : 0) + (room.webuiRound ? 1 : 0) > 1 && (
        <div className="flex gap-1.5 px-4 pt-3">
          {problems.map((p, i) => (
            <button
              key={p.id}
              onClick={() => setActiveId(p.id)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
              style={{
                background: activeId === p.id ? "var(--accent)" : "white",
                color: activeId === p.id ? "white" : "var(--text-secondary)",
                border: "1px solid " + (activeId === p.id ? "var(--accent)" : "var(--border)"),
              }}
            >
              Problem {i + 1}
            </button>
          ))}
          {room.flutterRound && (
            <button
              onClick={() => setActiveId(FLUTTER_TAB)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
              style={{
                background: isFlutterTab ? "var(--accent)" : "white",
                color: isFlutterTab ? "white" : "var(--text-secondary)",
                border: "1px solid " + (isFlutterTab ? "var(--accent)" : "var(--border)"),
              }}
            >
              <Smartphone size={12} /> Flutter
            </button>
          )}
          {room.webuiRound && (
            <button
              onClick={() => setActiveId(WEBUI_TAB)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
              style={{
                background: isWebUITab ? "var(--accent)" : "white",
                color: isWebUITab ? "white" : "var(--text-secondary)",
                border: "1px solid " + (isWebUITab ? "var(--accent)" : "var(--border)"),
              }}
            >
              <Globe size={12} /> Web UI
            </button>
          )}
        </div>
      )}

      <div className="max-w-[1400px] mx-auto px-4 py-4">
        {isFlutterTab ? (
          <FlutterPanel room={room} />
        ) : isWebUITab ? (
          <WebUIPanel
            room={room}
            webuiCode={webuiCode}
            activeEditor={webuiEditor}
            setActiveEditor={setWebuiEditor}
            onChange={updateWebui}
          />
        ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.1fr] gap-4">
          <div className="card overflow-hidden flex flex-col" style={{ minHeight: "calc(100vh - 180px)" }}>
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
            <CodeArea code={code} setCode={setCode} blockClipboard />
          </div>
        </div>
        )}
      </div>
    </div>
  );
}

function WebUIPanel({ room, webuiCode, activeEditor, setActiveEditor, onChange }) {
  const previewDoc = useDebouncedWebUIDoc(webuiCode);

  return (
    <div className="space-y-3">
      {room.webuiPrompt && (
        <div className="rounded-lg p-3 flex items-start gap-2.5" style={{ background: "#faf5ff", border: "1px solid #e9d5ff" }}>
          <Globe size={16} style={{ color: "#7c3aed" }} className="flex-shrink-0 mt-0.5" />
          <div className="text-xs" style={{ color: "#581c87" }}>{room.webuiPrompt}</div>
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card overflow-hidden flex flex-col" style={{ background: "#0f172a", borderColor: "#0f172a", minHeight: "60vh" }}>
          <div className="flex" style={{ borderBottom: "1px solid #1e293b" }}>
            {["html", "css", "js"].map((k) => (
              <button
                key={k}
                onClick={() => setActiveEditor(k)}
                className="px-4 py-2 text-xs font-semibold uppercase tracking-wider transition-colors"
                style={{
                  color: activeEditor === k ? "#e2e8f0" : "#64748b",
                  borderBottom: activeEditor === k ? "2px solid var(--accent)" : "2px solid transparent",
                }}
              >
                {k}
              </button>
            ))}
          </div>
          <CodeArea code={webuiCode[activeEditor]} setCode={(v) => onChange(activeEditor, v)} blockClipboard />
        </div>

        <div className="card overflow-hidden flex flex-col" style={{ minHeight: "60vh" }}>
          <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider" style={{ borderBottom: "1px solid var(--border)", color: "var(--text-muted)" }}>
            Live preview
          </div>
          <iframe
            title="Web UI preview"
            srcDoc={previewDoc}
            sandbox="allow-scripts"
            className="flex-1"
            style={{ width: "100%", border: "none", background: "white" }}
          />
        </div>
      </div>
    </div>
  );
}

function useDebouncedWebUIDoc(webuiCode) {
  const [doc, setDoc] = useState(() => buildWebUIDoc(webuiCode));
  useEffect(() => {
    const t = setTimeout(() => setDoc(buildWebUIDoc(webuiCode)), 300);
    return () => clearTimeout(t);
  }, [webuiCode]);
  return doc;
}

function FlutterPanel({ room }) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg p-3 flex items-start gap-2.5" style={{ background: "#e0f2fe", border: "1px solid #bae6fd" }}>
        <Smartphone size={16} style={{ color: "#0369a1" }} className="flex-shrink-0 mt-0.5" />
        <div className="text-xs" style={{ color: "#0c4a6e" }}>
          {room.flutterPrompt || "Write and run a Flutter widget below."}
          {" "}Your interviewer is watching your screen (DartPad doesn't support live code sync), so make sure
          screen sharing is on.
        </div>
      </div>
      <div className="card overflow-hidden" style={{ minHeight: "calc(100vh - 170px)" }}>
        <iframe
          src={dartpadEmbedUrl(room.flutterGistId)}
          title="DartPad"
          style={{ width: "100%", height: "calc(100vh - 170px)", border: "none" }}
        />
      </div>
    </div>
  );
}

function ConnectionBadge({ connected, label }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md font-medium"
      style={{ background: connected ? "#ecfdf5" : "#fef2f2", color: connected ? "#047857" : "#b91c1c" }}
    >
      {connected ? <Wifi size={11} /> : <WifiOff size={11} />} {label}
    </span>
  );
}

function ThankYouScreen({ candidateName, reason }) {
  const timedOut = reason === "timeout";
  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "var(--bg-app)" }}>
      <div className="card p-8 w-full max-w-sm text-center">
        <div
          className="w-14 h-14 rounded-full mx-auto mb-4 flex items-center justify-center"
          style={{ background: "#d1fae5" }}
        >
          <CheckCircle2 size={28} color="#059669" strokeWidth={2} />
        </div>
        <div className="text-lg font-bold mb-1.5" style={{ color: "var(--text-primary)" }}>
          {timedOut ? "Time's up!" : `Thank you${candidateName ? `, ${candidateName}` : ""}!`}
        </div>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          {timedOut
            ? "Your time for this interview has ended. Thank you for taking part — you can safely close this tab."
            : "Thank you for taking the interview. This session has ended — you can safely close this tab."}
        </p>
      </div>
    </div>
  );
}

function CenteredMessage({ title, detail, spinner }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "var(--bg-app)" }}>
      <div className="text-center">
        {spinner && <Loader2 size={24} className="animate-spin mx-auto mb-3" style={{ color: "var(--accent)" }} />}
        <div className="text-base font-semibold mb-1" style={{ color: "var(--text-primary)" }}>{title}</div>
        {detail && <div className="text-sm" style={{ color: "var(--text-secondary)" }}>{detail}</div>}
      </div>
    </div>
  );
}
