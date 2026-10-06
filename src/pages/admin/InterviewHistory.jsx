import React, { useState, useEffect, useCallback } from "react";
import { User, Mail, FileText, Loader2, ChevronRight, ArrowLeft, Check, X, Clock, Sparkles, Copy, GraduationCap, Phone } from "lucide-react";
import { fetchInterviewRoomsHistory, fetchArchivedInterviews, fetchInterviewSubmissions, fetchInterviewRoomVerdictSummary, fetchAllProblems } from "../../lib/db.js";
import { checkSubmissionAI, checkSubmissionSimilarity } from "../../interview/interviewApi.js";
import { formatRelativeTime } from "../../utils/time.js";

export default function InterviewHistory() {
  const [rooms, setRooms] = useState(null);
  const [archived, setArchived] = useState([]);
  const [showArchived, setShowArchived] = useState(true);
  const [problems, setProblems] = useState([]);
  const [verdictSummary, setVerdictSummary] = useState(null);
  const [selectedRoomId, setSelectedRoomId] = useState(null);
  const [submissions, setSubmissions] = useState(null);
  const [error, setError] = useState(null);
  const [aiState, setAiState] = useState({});
  const [similarityState, setSimilarityState] = useState({});

  // Polled like Interviews.jsx's "Active interviews" list — a candidate
  // joining/submitting through a reusable link happens after this page has
  // already loaded, so a one-time fetch would otherwise look like nothing
  // was ever recorded until a manual reload.
  const refresh = useCallback(() => {
    fetchInterviewRoomsHistory()
      .then((rs) => {
        setRooms(rs);
        fetchArchivedInterviews(new Set(rs.map((r) => r.id))).then(setArchived).catch(() => {});
      })
      .catch((e) => setError(e.message || String(e)));
    fetchInterviewRoomVerdictSummary().then(setVerdictSummary).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    fetchAllProblems().then(setProblems).catch(() => {});
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    if (!selectedRoomId) return;
    setSubmissions(null);
    fetchInterviewSubmissions(selectedRoomId)
      .then(setSubmissions)
      .catch((e) => setError(e.message || String(e)));
  }, [selectedRoomId]);

  const problemTitle = (id) => problems.find((p) => p.id === id)?.title || id;
  const allRooms = rooms && [...rooms, ...(showArchived ? archived : [])].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const selectedRoom = [...(rooms || []), ...archived].find((r) => r.id === selectedRoomId) || null;

  async function runAiCheck(submissionId) {
    setAiState((prev) => ({ ...prev, [submissionId]: { loading: true } }));
    try {
      const result = await checkSubmissionAI(submissionId);
      setAiState((prev) => ({ ...prev, [submissionId]: { loading: false, result } }));
      setSubmissions((prev) =>
        prev?.map((s) => (s.id === submissionId ? { ...s, ai_score: result.score, ai_reasoning: result.reasoning, ai_checked_at: result.aiCheckedAt } : s))
      );
    } catch (e) {
      setAiState((prev) => ({ ...prev, [submissionId]: { loading: false, error: e.message } }));
    }
  }

  async function runSimilarityCheck(submissionId) {
    setSimilarityState((prev) => ({ ...prev, [submissionId]: { loading: true } }));
    try {
      const result = await checkSubmissionSimilarity(submissionId);
      setSimilarityState((prev) => ({ ...prev, [submissionId]: { loading: false, result } }));
    } catch (e) {
      setSimilarityState((prev) => ({ ...prev, [submissionId]: { loading: false, error: e.message } }));
    }
  }

  if (selectedRoomId) {
    return (
      <div className="max-w-5xl mx-auto">
        <button
          onClick={() => setSelectedRoomId(null)}
          className="flex items-center gap-1.5 text-sm font-medium mb-4"
          style={{ color: "var(--text-secondary)" }}
        >
          <ArrowLeft size={15} /> Back to interview history
        </button>

        <div className="card p-5 mb-4">
          <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {selectedRoom?.title || "Interview"}
          </div>
          <div className="flex items-center gap-3 mt-1.5 text-xs flex-wrap" style={{ color: "var(--text-muted)" }}>
            {selectedRoom?.candidate_name && (
              <span className="inline-flex items-center gap-1"><User size={12} /> {selectedRoom.candidate_name}</span>
            )}
            {selectedRoom?.candidate_email && (
              <span className="inline-flex items-center gap-1"><Mail size={12} /> {selectedRoom.candidate_email}</span>
            )}
            {selectedRoom?.candidate_phone && (
              <span className="inline-flex items-center gap-1"><Phone size={12} /> {selectedRoom.candidate_phone}</span>
            )}
            {selectedRoom?.candidate_college && (
              <span className="inline-flex items-center gap-1"><GraduationCap size={12} /> {selectedRoom.candidate_college}</span>
            )}
            {selectedRoom?.candidate_branch && <span>{selectedRoom.candidate_branch}</span>}
            {selectedRoom?.candidate_year && <span>{selectedRoom.candidate_year}</span>}
            {selectedRoom?.created_at && <span>{formatRelativeTime(selectedRoom.created_at)}</span>}
          </div>
        </div>

        {submissions === null ? (
          <div className="flex justify-center py-12"><Loader2 size={20} className="animate-spin" style={{ color: "var(--accent)" }} /></div>
        ) : submissions.length === 0 ? (
          <div className="card p-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
            No submit attempts recorded for this interview. This means the candidate never clicked Submit on a
            DSA problem — note that the Flutter round (screen-share only) and the Web UI round (no judged tests)
            never produce a submission record here even when the candidate was actively working.
          </div>
        ) : (
          <div className="card overflow-hidden">
            <div className="divide-y" style={{ borderColor: "var(--border)" }}>
              {submissions.map((s) => (
                <div key={s.id} className="px-5 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <VerdictBadge verdict={s.verdict} />
                      <div className="min-w-0">
                        <div className="text-sm font-medium capitalize truncate" style={{ color: "var(--text-primary)" }}>
                          {problemTitle(s.problem_id)}
                        </div>
                        <div className="text-xs flex items-center gap-2 mt-0.5" style={{ color: "var(--text-muted)" }}>
                          <span className="font-mono">{s.language}</span>
                          <span>·</span>
                          <span>{s.passed}/{s.total} passed</span>
                          {s.time_ms != null && (
                            <>
                              <span>·</span>
                              <span>{Math.round(s.time_ms)}ms · {s.memory_kb ? (s.memory_kb / 1024).toFixed(1) : "0"}MB</span>
                            </>
                          )}
                          <span>·</span>
                          <span>{formatRelativeTime(s.created_at)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex-shrink-0 flex items-center gap-2">
                      <AiCheckControl submission={s} state={aiState[s.id]} onCheck={() => runAiCheck(s.id)} />
                      <SimilarityCheckControl state={similarityState[s.id]} onCheck={() => runSimilarityCheck(s.id)} />
                    </div>
                  </div>
                  {aiState[s.id]?.result?.reasoning && (
                    <div className="mt-2 ml-11 text-xs" style={{ color: "var(--text-muted)" }}>
                      "{aiState[s.id].result.reasoning}"
                    </div>
                  )}
                  {similarityState[s.id]?.result && (
                    <SimilarityResults matches={similarityState[s.id].result.matches} />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      <p className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>
        Every past interview room, whether it's still live or has already ended — including ones with zero
        submissions, since "the candidate never submitted anything" is itself the answer to "did they complete it."
      </p>
      {archived.length > 0 && (
        <label className="flex items-center gap-2 text-xs mb-4 cursor-pointer" style={{ color: "var(--text-secondary)" }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          Show {archived.length} archived interview{archived.length === 1 ? "" : "s"} (room deleted when it ended — rebuilt from saved submissions; may include test rooms)
        </label>
      )}

      {error && (
        <div className="card p-4 mb-4 text-sm" style={{ color: "#b91c1c" }}>{error}</div>
      )}

      {rooms === null ? (
        <div className="flex justify-center py-12"><Loader2 size={20} className="animate-spin" style={{ color: "var(--accent)" }} /></div>
      ) : allRooms.length === 0 ? (
        <div className="card p-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>No interviews yet.</div>
      ) : (
        <div className="card overflow-hidden">
          <div className="divide-y" style={{ borderColor: "var(--border)" }}>
            {allRooms.map((r) => (
              <button
                key={r.id}
                onClick={() => setSelectedRoomId(r.id)}
                className="w-full text-left px-5 py-3.5 flex items-center justify-between gap-3 transition-colors"
                onMouseEnter={(e) => (e.currentTarget.style.background = "#fafafa")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                      {r.title}
                    </div>
                    <StatusBadge status={statusForRoom(r, verdictSummary)} />
                    {r.archived && (
                      <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: "#fef3c7", color: "#92400e" }} title="Room was deleted when the interview ended; shown from its saved submissions">
                        Archived
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs flex-wrap" style={{ color: "var(--text-muted)" }}>
                    <span className="inline-flex items-center gap-1">
                      <User size={12} /> {r.candidate_name || "Unnamed candidate"}
                    </span>
                    {r.candidate_email && (
                      <span className="inline-flex items-center gap-1">
                        <Mail size={12} /> {r.candidate_email}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1">
                      <FileText size={12} /> {(r.problem_ids || []).length} problem{(r.problem_ids || []).length === 1 ? "" : "s"}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Clock size={12} /> {formatRelativeTime(r.created_at)}
                    </span>
                  </div>
                </div>
                <ChevronRight size={16} style={{ color: "var(--text-muted)" }} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function VerdictBadge({ verdict }) {
  const isAC = verdict === "AC";
  return (
    <div
      className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
      style={{ background: isAC ? "#d1fae5" : "#fee2e2" }}
      title={verdict}
    >
      {isAC ? <Check size={14} color="#059669" strokeWidth={3} /> : <X size={14} color="#b91c1c" strokeWidth={3} />}
    </div>
  );
}

/** Passed = every DSA problem assigned to this room has an accepted
 * submission; Failed = attempted at least one, not all AC; Not started =
 * zero submissions. Rooms with no DSA problems (Flutter/WebUI-only) always
 * land in "not_started" — problem_ids.every() on an empty array is
 * vacuously true, which would otherwise wrongly show "Passed". */
function statusForRoom(room, verdictSummary) {
  const entry = verdictSummary?.[room.id];
  const problemIds = room.problem_ids || [];
  if (!entry || entry.attempted.size === 0) return "not_started";
  if (problemIds.length > 0 && problemIds.every((id) => entry.accepted.has(id))) return "passed";
  return "failed";
}

function StatusBadge({ status }) {
  const variants = {
    passed: { label: "Passed", background: "#dcfce7", color: "#166534" },
    failed: { label: "Failed", background: "#fee2e2", color: "#b91c1c" },
    not_started: { label: "Not started", background: "#f4f4f5", color: "var(--text-muted)" },
  };
  const v = variants[status] || variants.not_started;
  return (
    <span
      className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0"
      style={{ background: v.background, color: v.color }}
    >
      {v.label}
    </span>
  );
}

function AiCheckControl({ submission, state, onCheck }) {
  const hasCached = submission.ai_checked_at != null;
  if (state?.loading) {
    return (
      <span className="inline-flex items-center gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
        <Loader2 size={12} className="animate-spin" /> Checking…
      </span>
    );
  }
  const score = state?.result?.score ?? submission.ai_score;
  if (score != null) {
    const suspicious = score >= 60;
    return (
      <div className="flex items-center gap-1.5">
        <span
          className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded"
          style={{ background: suspicious ? "#fee2e2" : "#f4f4f5", color: suspicious ? "#b91c1c" : "var(--text-muted)" }}
        >
          <Sparkles size={10} /> AI likelihood: {score}%
        </span>
        <button onClick={onCheck} className="text-[11px] font-medium underline" style={{ color: "var(--text-muted)" }}>
          Re-check
        </button>
      </div>
    );
  }
  return (
    <button onClick={onCheck} className="btn-ghost text-xs !px-2 !py-1">
      <Sparkles size={12} /> Check for AI
    </button>
  );
}

function SimilarityCheckControl({ state, onCheck }) {
  if (state?.loading) {
    return (
      <span className="inline-flex items-center gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
        <Loader2 size={12} className="animate-spin" /> Comparing…
      </span>
    );
  }
  return (
    <button onClick={onCheck} className="btn-ghost text-xs !px-2 !py-1">
      <Copy size={12} /> Check similarity
    </button>
  );
}

function SimilarityResults({ matches }) {
  if (!matches || matches.length === 0) {
    return (
      <div className="mt-2 ml-11 text-xs" style={{ color: "var(--text-muted)" }}>
        No other candidate has submitted this problem yet.
      </div>
    );
  }
  const top = matches.filter((m) => m.score >= 0.3).slice(0, 5);
  if (top.length === 0) {
    return (
      <div className="mt-2 ml-11 text-xs" style={{ color: "var(--text-muted)" }}>
        No meaningfully similar submissions found.
      </div>
    );
  }
  return (
    <div className="mt-2 ml-11 space-y-1">
      {top.map((m) => (
        <div key={m.id} className="text-xs flex items-center gap-2" style={{ color: "var(--text-muted)" }}>
          <span
            className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded"
            style={{ background: m.score >= 0.7 ? "#fee2e2" : "#fef3c7", color: m.score >= 0.7 ? "#b91c1c" : "#92400e" }}
          >
            {Math.round(m.score * 100)}% similar
          </span>
          <span>{m.candidate_name || "Unnamed candidate"} — {m.room_title}</span>
        </div>
      ))}
    </div>
  );
}
