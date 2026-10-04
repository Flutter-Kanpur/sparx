import React, { useState, useEffect, useRef } from "react";
import {
  Play, Send, Check, X, ArrowLeft, ExternalLink, Loader2,
  Terminal, FileText, ListChecks, ChevronDown,
} from "lucide-react";
import { DifficultyPill, CompanyBadges } from "./ProblemsList.jsx";
import { useAuth } from "../lib/auth.jsx";
import { insertSubmission, markSolved as markSolvedInDb } from "../lib/db.js";

const JUDGE0_URL = "https://ce.judge0.com";

// Language map. Each entry has Judge0 language ID, file ext, display name,
// and a `category` used to group entries in the language picker.
//
// Note: the public Judge0 CE instance is version-pinned. Newer languages
// like Dart may not be available there — self-host Judge0 if you need them.
export const LANG = {
  // Core
  python:     { id: 71, name: "python",     ext: "py",    display: "Python 3.8",     category: "Core" },
  cpp:        { id: 54, name: "c++",        ext: "cpp",   display: "C++ (GCC 9.2)",  category: "Core" },
  java:       { id: 62, name: "java",       ext: "java",  display: "Java 13",        category: "Core" },
  javascript: { id: 63, name: "javascript", ext: "js",    display: "Node.js 12",     category: "Core" },
  c:          { id: 50, name: "c",          ext: "c",     display: "C (GCC 9.2)",    category: "Core" },

  // Web
  typescript: { id: 74, name: "typescript", ext: "ts",    display: "TypeScript 3.7", category: "Web" },
  go:         { id: 60, name: "go",         ext: "go",    display: "Go 1.13",        category: "Web" },
  rust:       { id: 73, name: "rust",       ext: "rs",    display: "Rust 1.40",      category: "Web" },
  php:        { id: 68, name: "php",        ext: "php",   display: "PHP 7.4",        category: "Web" },
  ruby:       { id: 72, name: "ruby",       ext: "rb",    display: "Ruby 2.7",       category: "Web" },

  // App
  dart:       { id: 90, name: "dart",       ext: "dart",  display: "Dart 2.19",      category: "App" },
  kotlin:     { id: 78, name: "kotlin",     ext: "kt",    display: "Kotlin 1.3",     category: "App" },
  swift:      { id: 83, name: "swift",      ext: "swift", display: "Swift 5.2",      category: "App" },
  csharp:     { id: 51, name: "c#",         ext: "cs",    display: "C# (Mono 6.6)",  category: "App" },
};

// Fallback starter code for each language — used when a problem's starter
// object doesn't include code for the selected language.
const DEFAULT_STARTERS = {
  python: `# Read input from stdin, print to stdout\nimport sys\ndata = sys.stdin.read().strip()\n\n# your code here\nprint(data)`,
  cpp: `#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios_base::sync_with_stdio(false);\n    cin.tie(NULL);\n\n    // your code here\n\n    return 0;\n}`,
  java: `import java.util.*;\nimport java.io.*;\n\npublic class Main {\n    public static void main(String[] args) throws IOException {\n        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));\n        // your code here\n    }\n}`,
  javascript: `const data = require('fs').readFileSync(0, 'utf8').trim();\n// your code here\nconsole.log(data);`,
  c: `#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n\nint main() {\n    // your code here\n    return 0;\n}`,
  typescript: `// TypeScript on Judge0 compiles to JS, runs on Node.\nconst data: string = require('fs').readFileSync(0, 'utf8').trim();\n\n// your code here\nconsole.log(data);`,
  go: `package main\n\nimport (\n    "bufio"\n    "fmt"\n    "os"\n)\n\nfunc main() {\n    reader := bufio.NewReader(os.Stdin)\n    _ = reader\n    _ = fmt.Println\n\n    // your code here\n}`,
  rust: `use std::io::{self, Read};\n\nfn main() {\n    let mut input = String::new();\n    io::stdin().read_to_string(&mut input).unwrap();\n\n    // your code here\n    print!("{}", input.trim());\n}`,
  php: `<?php\n$input = trim(stream_get_contents(STDIN));\n\n// your code here\necho $input;\n`,
  ruby: `input = STDIN.read.strip\n\n# your code here\nputs input`,
  dart: `import 'dart:io';\n\nvoid main() {\n  final input = stdin.readLineSync() ?? '';\n\n  // your code here\n  print(input);\n}`,
  kotlin: `import java.io.BufferedReader\nimport java.io.InputStreamReader\n\nfun main() {\n    val br = BufferedReader(InputStreamReader(System.\`in\`))\n    val line = br.readLine() ?: ""\n\n    // your code here\n    println(line)\n}`,
  swift: `import Foundation\n\nlet line = readLine() ?? ""\n\n// your code here\nprint(line)`,
  csharp: `using System;\nusing System.IO;\n\nclass Program {\n    static void Main() {\n        string input = Console.In.ReadToEnd().Trim();\n\n        // your code here\n        Console.WriteLine(input);\n    }\n}`,
};

export function starterFor(problem, language) {
  return problem.starter?.[language] ?? DEFAULT_STARTERS[language] ?? "// write your code here";
}

// Build {category: [lang_key, ...]} preserving insertion order.
export const LANG_BY_CATEGORY = Object.entries(LANG).reduce((acc, [key, val]) => {
  if (!acc[val.category]) acc[val.category] = [];
  acc[val.category].push(key);
  return acc;
}, {});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Retries rate limits / gateway errors with a short backoff, and reports the
// real HTTP status instead of letting it look like a timeout.
async function judge0Fetch(url, options, attempts = 4) {
  let last = "network error";
  for (let a = 0; a < attempts; a++) {
    try {
      const res = await fetch(url, options);
      if (res.ok) return res;
      last = res.status;
      if (![429, 502, 503, 504].includes(res.status)) break;
    } catch (e) {
      last = e.message;
    }
    await sleep(800 * (a + 1));
  }
  throw new Error(last === 429 ? "judge0 is rate-limiting requests (429) — wait a moment and try again" : `judge0 request failed (${last})`);
}

const JSON_HEADERS = { "Content-Type": "application/json" };
const J0_FIELDS = "token,status,stdout,stderr,compile_output,time,memory";

export async function judge0Run({ sourceCode, languageId, stdin, expectedOutput, cpuTimeLimit = 2 }) {
  const createRes = await judge0Fetch(`${JUDGE0_URL}/submissions?base64_encoded=false&wait=false`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      source_code: sourceCode,
      language_id: languageId,
      stdin: stdin || "",
      expected_output: expectedOutput || null,
      cpu_time_limit: cpuTimeLimit,
    }),
  });
  const { token } = await createRes.json();
  for (let i = 0; i < 25; i++) {
    await sleep(600 + i * 80);
    const r = await judge0Fetch(`${JUDGE0_URL}/submissions/${token}?base64_encoded=false`);
    const result = await r.json();
    if (result.status?.id > 2) return result;
  }
  throw new Error("timeout — judge0 took too long");
}

/**
 * Runs one program against many inputs with Judge0's batch endpoints: one
 * request to create every job and one poll for all of them, instead of a
 * create + poll loop per test. Results come back in the same order as `cases`
 * ({ stdin, expectedOutput }[]). Public Judge0 caps a batch at 20, so larger
 * sets are sent in chunks.
 */
export async function judge0RunBatch({ sourceCode, languageId, cases, cpuTimeLimit = 2 }) {
  const out = new Array(cases.length);
  for (let start = 0; start < cases.length; start += 20) {
    const chunk = cases.slice(start, start + 20);
    const createRes = await judge0Fetch(`${JUDGE0_URL}/submissions/batch?base64_encoded=false`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        submissions: chunk.map((c) => ({
          source_code: sourceCode,
          language_id: languageId,
          stdin: c.stdin || "",
          expected_output: c.expectedOutput || null,
          cpu_time_limit: cpuTimeLimit,
        })),
      }),
    });
    const created = await createRes.json();
    if (!Array.isArray(created) || created.some((c) => !c.token)) {
      throw new Error("judge0 rejected the submission batch");
    }
    const tokens = created.map((c) => c.token).join(",");

    let results = null;
    let delay = 700;
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      await sleep(delay);
      delay = Math.min(delay + 300, 2500);
      const res = await judge0Fetch(`${JUDGE0_URL}/submissions/batch?tokens=${tokens}&base64_encoded=false&fields=${J0_FIELDS}`);
      const { submissions } = await res.json();
      if (submissions.every((x) => x.status?.id > 2)) { results = submissions; break; }
    }
    if (!results) throw new Error("timeout — judge0 took too long");
    results.forEach((r, i) => { out[start + i] = r; });
  }
  return out;
}

export function classifyVerdict(j0Status, expected, stdout) {
  if (!j0Status) return "RE";
  const id = j0Status.id;
  if (id === 3) {
    if (expected != null && stdout != null) {
      const a = (stdout || "").trimEnd();
      const b = (expected || "").trimEnd();
      return a === b ? "AC" : "WA";
    }
    return "AC";
  }
  if (id === 4) return "WA";
  if (id === 5) return "TLE";
  if (id === 6) return "CE";
  if (id >= 7 && id <= 12) return "RE";
  return "RE";
}

export default function ProblemPage({ problem, onBack, onSolved }) {
  const { user } = useAuth();
  const [language, setLanguage] = useState("python");
  const [code, setCode] = useState(starterFor(problem, "python"));
  const [running, setRunning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState(null);
  const [activeTab, setActiveTab] = useState("problem");
  const [customInput, setCustomInput] = useState("");
  const [customOutput, setCustomOutput] = useState(null);

  useEffect(() => { setCode(starterFor(problem, language)); }, [language, problem.id]);

  async function handleRun() {
    setRunning(true); setResults(null); setActiveTab("results"); setCustomOutput(null);
    try {
      const sampleResults = [];
      const batch = await judge0RunBatch({
        sourceCode: code, languageId: LANG[language].id,
        cases: problem.examples.map((ex) => ({ stdin: ex.input === "(none)" ? "" : ex.input, expectedOutput: ex.output })),
      });
      for (let i = 0; i < problem.examples.length; i++) {
        const ex = problem.examples[i];
        const r = batch[i];
        const verdict = classifyVerdict(r.status, ex.output, r.stdout);
        sampleResults.push({
          index: i + 1, input: ex.input, expected: ex.output,
          actual: (r.stdout || "").trimEnd(),
          stderr: r.stderr || r.compile_output || "",
          verdict, time: r.time, memory: r.memory, isSample: true,
        });
      }
      setResults({ kind: "run", tests: sampleResults });
    } catch (e) {
      setResults({ kind: "error", message: e.message });
    } finally {
      setRunning(false);
    }
  }

  async function handleSubmit() {
    setSubmitting(true); setResults(null); setActiveTab("results");
    try {
      const allResults = [];
      let passed = 0, firstFailIndex = null, maxTime = 0, maxMem = 0;
      const batch = await judge0RunBatch({
        sourceCode: code, languageId: LANG[language].id,
        cases: problem.tests.map((t) => ({ stdin: t.input, expectedOutput: t.expected })),
      });
      for (let i = 0; i < problem.tests.length; i++) {
        const t = problem.tests[i];
        const r = batch[i];
        const verdict = classifyVerdict(r.status, t.expected, r.stdout);
        const time = parseFloat(r.time || "0");
        const mem = r.memory || 0;
        if (time > maxTime) maxTime = time;
        if (mem > maxMem) maxMem = mem;
        allResults.push({
          index: i + 1, input: t.input, expected: t.expected,
          actual: (r.stdout || "").trimEnd(),
          stderr: r.stderr || r.compile_output || "",
          verdict, isSample: i < problem.examples.length,
        });
        if (verdict === "AC") passed++;
        else { firstFailIndex = i; break; }
      }
      const allPassed = passed === problem.tests.length;
      const verdict = allPassed ? "AC" : allResults[firstFailIndex]?.verdict || "WA";

      if (user) {
        insertSubmission({
          userId: user.id, problemId: problem.id, kind: "submit", language, code,
          verdict, passed, total: problem.tests.length, timeMs: maxTime * 1000, memoryKb: maxMem,
        }).catch(() => {});
        if (allPassed) {
          markSolvedInDb(user.id, problem.id).catch(() => {});
        }
      }
      if (allPassed) onSolved(problem.id);

      setResults({
        kind: "submit", tests: allResults, passed, total: problem.tests.length,
        verdict, time: maxTime, memory: maxMem,
      });
    } catch (e) {
      setResults({ kind: "error", message: e.message });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCustomRun() {
    setRunning(true); setCustomOutput({ loading: true });
    try {
      const r = await judge0Run({
        sourceCode: code, languageId: LANG[language].id, stdin: customInput,
      });
      setCustomOutput({
        stdout: r.stdout || "", stderr: r.stderr || r.compile_output || "",
        time: r.time, memory: r.memory, status: r.status?.description,
      });
    } catch (e) {
      setCustomOutput({ stderr: e.message });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="max-w-[1400px] mx-auto px-6 py-5">
      <button
        onClick={onBack}
        className="btn-ghost mb-4"
      >
        <ArrowLeft size={14} /> Back to problems
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.1fr] gap-4">
        {/* LEFT: problem statement + results */}
        <div
          className="card overflow-hidden flex flex-col"
          style={{ minHeight: "calc(100vh - 180px)" }}
        >
          <div className="flex border-b" style={{ borderColor: "var(--border)" }}>
            <Tab
              icon={<FileText size={14} />}
              active={activeTab === "problem"}
              onClick={() => setActiveTab("problem")}
              label="Description"
            />
            <Tab
              icon={<ListChecks size={14} />}
              active={activeTab === "results"}
              onClick={() => setActiveTab("results")}
              label="Submission"
              badge={results?.kind === "submit" && results.verdict === "AC" ? "ac" :
                     results?.kind === "submit" ? "fail" : null}
            />
          </div>

          <div className="p-6 overflow-y-auto flex-1">
            {activeTab === "problem" ? (
              <ProblemDescription problem={problem} />
            ) : (
              <ResultsView results={results} running={running || submitting} />
            )}
          </div>
        </div>

        {/* RIGHT: code editor + custom input */}
        <div className="flex flex-col gap-3">
          <div
            className="card overflow-hidden flex flex-col flex-1"
            style={{
              background: "#0f172a",
              borderColor: "#0f172a",
              minHeight: "60vh",
            }}
          >
            <div
              className="px-3 py-2 flex items-center justify-between gap-2 flex-wrap"
              style={{ borderBottom: "1px solid #1e293b" }}
            >
              <div className="flex items-center gap-2">
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="text-xs font-medium px-2.5 py-1 rounded-md cursor-pointer focus:outline-none"
                  style={{
                    background: "#1e293b",
                    color: "#e2e8f0",
                    border: "1px solid #334155",
                  }}
                >
                  {Object.entries(LANG_BY_CATEGORY).map(([cat, keys]) => (
                    <optgroup key={cat} label={cat}>
                      {keys.map((k) => (
                        <option key={k} value={k}>{LANG[k].display}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <div className="hidden sm:flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium"
                     style={{ background: "#1e293b20", color: "#64748b" }}>
                  <Terminal size={11} /> Judge0
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleRun}
                  disabled={running || submitting}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background: "#1e293b", color: "#e2e8f0", border: "1px solid #334155" }}
                  onMouseEnter={(e) => { if (!running && !submitting) e.currentTarget.style.background = "#334155"; }}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "#1e293b")}
                >
                  {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} strokeWidth={2.5} fill="currentColor" />}
                  Run
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={running || submitting}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background: "#059669" }}
                  onMouseEnter={(e) => { if (!running && !submitting) e.currentTarget.style.background = "#047857"; }}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "#059669")}
                >
                  {submitting ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} strokeWidth={2.5} />}
                  Submit
                </button>
              </div>
            </div>
            <CodeArea code={code} setCode={setCode} />
          </div>

          <div className="card p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                Custom Input
              </div>
              <button
                onClick={handleCustomRun}
                disabled={running || submitting}
                className="btn-ghost text-xs disabled:opacity-40"
              >
                <Play size={11} fill="currentColor" /> Run with input
              </button>
            </div>
            <textarea
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              placeholder="Paste your test input here..."
              spellCheck={false}
              className="w-full bg-transparent text-sm font-mono focus:outline-none resize-none"
              style={{ color: "var(--text-primary)", minHeight: "60px" }}
            />
            {customOutput && (
              <div
                className="mt-3 pt-3 text-xs font-mono"
                style={{ borderTop: "1px dashed var(--border)" }}
              >
                {customOutput.loading ? (
                  <div className="flex items-center gap-2" style={{ color: "var(--text-muted)" }}>
                    <Loader2 size={12} className="animate-spin" /> Running…
                  </div>
                ) : (
                  <>
                    {customOutput.stdout && (
                      <pre className="whitespace-pre-wrap" style={{ color: "var(--text-primary)" }}>
                        {customOutput.stdout}
                      </pre>
                    )}
                    {customOutput.stderr && (
                      <pre className="whitespace-pre-wrap text-red-600 mt-1">
                        {customOutput.stderr}
                      </pre>
                    )}
                    {customOutput.time && (
                      <div className="text-[11px] mt-1.5" style={{ color: "var(--text-muted)" }}>
                        {customOutput.time}s · {customOutput.memory}kb · {customOutput.status}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function Tab({ icon, label, active, onClick, badge }) {
  return (
    <button
      onClick={onClick}
      className="px-5 py-3 text-sm font-medium flex items-center gap-2 relative transition-colors"
      style={{
        color: active ? "var(--text-primary)" : "var(--text-secondary)",
        background: active ? "white" : "transparent",
        borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
        marginBottom: "-1px",
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "#fafafa"; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
    >
      {icon}
      {label}
      {badge === "ac" && <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#10b981" }} />}
      {badge === "fail" && <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#ef4444" }} />}
    </button>
  );
}

export function ProblemDescription({ problem }) {
  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap mb-3">
        <h2 className="text-2xl font-bold capitalize" style={{ color: "var(--text-primary)" }}>
          {problem.title}
        </h2>
        <DifficultyPill difficulty={problem.difficulty} />
        {problem.companies?.length > 0 && <CompanyBadges companies={problem.companies} max={6} />}
      </div>
      {problem.sourceUrl && (
        <a
          href={problem.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-medium mb-4 hover:underline"
          style={{ color: "var(--accent)" }}
        >
          <ExternalLink size={12} /> Original source
        </a>
      )}
      <div className="flex flex-wrap gap-1.5 mb-5">
        {problem.tags.map((t) => (
          <span
            key={t}
            className="text-[11px] font-medium px-2 py-0.5 rounded-md"
            style={{ background: "#f4f4f5", color: "var(--text-secondary)" }}
          >
            {t}
          </span>
        ))}
      </div>

      <pre className="whitespace-pre-wrap text-sm leading-relaxed font-sans"
           style={{ color: "var(--text-primary)" }}>
        {problem.statement}
      </pre>

      <div className="mt-7">
        <div className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--text-muted)" }}>
          Examples
        </div>
        <div className="space-y-3">
          {problem.examples.map((ex, i) => (
            <div
              key={i}
              className="rounded-lg p-4"
              style={{ background: "#f9fafb", border: "1px solid var(--border)" }}
            >
              <div className="text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--text-muted)" }}>
                Example {i + 1}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm font-mono">
                <div>
                  <div className="text-[11px] font-semibold mb-1" style={{ color: "var(--text-secondary)" }}>Input</div>
                  <pre className="whitespace-pre-wrap p-2 rounded" style={{ background: "white", border: "1px solid var(--border)", color: "var(--text-primary)" }}>
                    {ex.input}
                  </pre>
                </div>
                <div>
                  <div className="text-[11px] font-semibold mb-1" style={{ color: "var(--text-secondary)" }}>Output</div>
                  <pre className="whitespace-pre-wrap p-2 rounded" style={{ background: "white", border: "1px solid var(--border)", color: "var(--text-primary)" }}>
                    {ex.output}
                  </pre>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function CodeArea({ code, setCode, readOnly = false, blockClipboard = false }) {
  const taRef = useRef(null);
  const lineCount = code.split("\n").length;

  function handleKeyDown(e) {
    if (readOnly) return;
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = taRef.current;
      const start = ta.selectionStart, end = ta.selectionEnd;
      const newVal = code.substring(0, start) + "    " + code.substring(end);
      setCode(newVal);
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = start + 4; });
    }
  }

  // Anti-cheat for live interviews only (see blockClipboard call sites) —
  // blocks Ctrl+C/V/X and the right-click menu's Copy/Paste, not just the
  // keyboard shortcuts.
  function blockClipboardEvent(e) {
    e.preventDefault();
  }

  return (
    <div className="flex-1 overflow-hidden flex">
      <div
        className="px-3 py-3 text-right select-none flex-shrink-0 font-mono"
        style={{
          color: "#475569",
          fontSize: "13px",
          lineHeight: "1.65",
          borderRight: "1px solid #1e293b",
        }}
      >
        {Array.from({ length: lineCount }, (_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <textarea
        ref={taRef}
        value={code}
        onChange={(e) => !readOnly && setCode(e.target.value)}
        onKeyDown={handleKeyDown}
        onCopy={blockClipboard ? blockClipboardEvent : undefined}
        onCut={blockClipboard ? blockClipboardEvent : undefined}
        onPaste={blockClipboard ? blockClipboardEvent : undefined}
        onContextMenu={blockClipboard ? blockClipboardEvent : undefined}
        readOnly={readOnly}
        spellCheck={false}
        className="flex-1 bg-transparent p-3 resize-none focus:outline-none font-mono"
        style={{
          fontSize: "13px",
          lineHeight: "1.65",
          color: "#e2e8f0",
          caretColor: readOnly ? "transparent" : "#6366f1",
          cursor: readOnly ? "default" : "text",
        }}
      />
    </div>
  );
}

export function ResultsView({ results, running }) {
  if (running) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <Loader2 size={28} className="animate-spin" style={{ color: "var(--accent)" }} />
        <div className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>Running your code…</div>
        <div className="text-xs" style={{ color: "var(--text-muted)" }}>Submitting to Judge0 sandbox</div>
      </div>
    );
  }
  if (!results) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
        <ListChecks size={32} style={{ color: "var(--text-muted)" }} strokeWidth={1.5} />
        <div className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Hit <span className="font-semibold">Run</span> to test on examples, or <span className="font-semibold">Submit</span> for the full test suite.
        </div>
      </div>
    );
  }
  if (results.kind === "error") {
    return (
      <div className="rounded-lg p-4" style={{ background: "#fef2f2", border: "1px solid #fecaca" }}>
        <div className="text-sm font-semibold mb-1" style={{ color: "#b91c1c" }}>Execution failed</div>
        <div className="text-xs font-mono" style={{ color: "#7f1d1d" }}>{results.message}</div>
        <div className="text-xs mt-2" style={{ color: "var(--text-secondary)" }}>
          If this persists, the public Judge0 instance may be rate-limiting. Wait a moment and try again.
        </div>
      </div>
    );
  }

  const isSubmit = results.kind === "submit";
  const allPassed = isSubmit && results.verdict === "AC";

  return (
    <div className="space-y-4">
      {isSubmit && (
        <div
          className="rounded-lg p-5"
          style={{
            background: allPassed ? "#ecfdf5" : "#fef2f2",
            border: `1px solid ${allPassed ? "#a7f3d0" : "#fecaca"}`,
          }}
        >
          <div className="flex items-center gap-2 mb-1">
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center"
              style={{ background: allPassed ? "#10b981" : "#ef4444" }}
            >
              {allPassed ? <Check size={14} color="white" strokeWidth={3} /> : <X size={14} color="white" strokeWidth={3} />}
            </div>
            <div className="text-base font-bold" style={{ color: allPassed ? "#047857" : "#b91c1c" }}>
              {allPassed ? "Accepted" : verdictHeadline(results.verdict)}
            </div>
          </div>
          <div className="text-sm" style={{ color: allPassed ? "#065f46" : "#7f1d1d" }}>
            {results.passed} / {results.total} test cases passed
            {results.time > 0 && ` · ${(results.time * 1000).toFixed(0)}ms · ${Math.round(results.memory)}kb`}
          </div>
          {!allPassed && (
            <div className="text-xs mt-2" style={{ color: "#991b1b" }}>
              {verdictAdvice(results.verdict)}
            </div>
          )}
        </div>
      )}

      {!isSubmit && (
        <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
          Example results
        </div>
      )}

      <div className="space-y-2">
        {results.tests.map((t) => (
          <TestRow key={t.index} test={t} />
        ))}
      </div>
    </div>
  );
}

function TestRow({ test }) {
  const passed = test.verdict === "AC";
  const [expanded, setExpanded] = useState(!passed);
  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{
        background: passed ? "#f0fdf4" : "#fef2f2",
        border: `1px solid ${passed ? "#bbf7d0" : "#fecaca"}`,
      }}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2"
      >
        <div className="flex items-center gap-2">
          <div
            className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: passed ? "#10b981" : "#ef4444" }}
          >
            {passed ? <Check size={11} color="white" strokeWidth={3} /> : <X size={11} color="white" strokeWidth={3} />}
          </div>
          <span className="text-sm font-medium" style={{ color: passed ? "#065f46" : "#7f1d1d" }}>
            Test {test.index} · {verdictLabel(test.verdict)}
          </span>
        </div>
        <ChevronDown
          size={14}
          style={{
            color: passed ? "#10b981" : "#ef4444",
            transform: expanded ? "rotate(180deg)" : "none",
            transition: "transform 0.15s",
          }}
        />
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-1.5 text-xs font-mono">
          {test.input && test.input !== "" && test.input !== "(none)" && (
            <Row label="Input" value={truncate(test.input, 200)} />
          )}
          <Row label="Expected" value={truncate(test.expected, 200)} />
          <Row label="Output" value={truncate(test.actual || "(empty)", 200)} highlight={!passed} />
          {test.stderr && (
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>
                Stderr
              </div>
              <pre className="whitespace-pre-wrap p-2 rounded text-[11px]" style={{ background: "#0f172a", color: "#fca5a5" }}>
                {truncate(test.stderr, 400)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value, highlight }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: "var(--text-muted)" }}>
        {label}
      </div>
      <pre
        className="whitespace-pre-wrap p-2 rounded text-[12px]"
        style={{
          background: "white",
          border: "1px solid var(--border)",
          color: highlight ? "#b91c1c" : "var(--text-primary)",
        }}
      >
        {value}
      </pre>
    </div>
  );
}

function truncate(s, n) {
  if (!s) return s;
  return s.length > n ? s.slice(0, n) + "..." : s;
}

function verdictLabel(v) {
  return ({
    AC: "Accepted", WA: "Wrong Answer", TLE: "Time Limit Exceeded",
    RE: "Runtime Error", CE: "Compilation Error", MLE: "Memory Limit Exceeded",
  })[v] || v;
}

function verdictHeadline(v) {
  return ({
    WA: "Wrong Answer", TLE: "Time Limit Exceeded", RE: "Runtime Error",
    CE: "Compilation Error", MLE: "Memory Limit Exceeded",
  })[v] || "Failed";
}

function verdictAdvice(v) {
  return ({
    WA: "Your output doesn't match the expected output. Inspect the failing test case.",
    TLE: "Your solution is too slow. Consider a more efficient algorithm.",
    RE: "Your code crashed during execution. Check for index errors, division by zero, etc.",
    CE: "Your code didn't compile. Read the stderr below.",
    MLE: "Too much memory used. Use smaller data structures.",
  })[v] || "";
}
