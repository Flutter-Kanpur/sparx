import React, { useEffect, useState } from "react";
import { X, Loader2, Sparkles, CheckCircle2, AlertTriangle, Lightbulb } from "lucide-react";
import { requestContestReview } from "../../lib/contestsApi.js";

const KIND = {
  logic: ["Logic", "#fef2f2", "#b91c1c"],
  "edge-case": ["Edge case", "#fff7ed", "#c2410c"],
  performance: ["Performance", "#fefce8", "#a16207"],
  "input-output": ["Input / output", "#f0f9ff", "#0369a1"],
  syntax: ["Syntax", "#f5f3ff", "#6d28d9"],
  approach: ["Approach", "#fdf2f8", "#be185d"],
};

export default function ContestReviewModal({ contest, userId, personName, onClose }) {
  const [review, setReview] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    requestContestReview(contest.id, { userId })
      .then((r) => { if (!cancelled) setReview(r); })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [contest.id, userId]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto" style={{ background: "rgba(15,23,42,0.6)" }} onClick={onClose}>
      <div className="card max-w-3xl w-full p-6 my-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2 text-base font-bold" style={{ color: "var(--text-primary)" }}>
              <Sparkles size={16} style={{ color: "var(--accent)" }} /> {personName ? `AI review — ${personName}` : "Your AI contest review"}
            </div>
            <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{contest.title}</div>
          </div>
          <button className="btn-ghost !px-2 !py-1" onClick={onClose}><X size={16} /></button>
        </div>

        {!review && !error && (
          <div className="py-14 text-center">
            <Loader2 size={24} className="animate-spin mx-auto mb-3" style={{ color: "var(--accent)" }} />
            <div className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>Reading the submissions…</div>
            <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>This takes 10–30 seconds the first time; it's saved afterwards.</div>
          </div>
        )}

        {error && (
          <div className="rounded-lg p-4 text-sm" style={{ background: "#fef2f2", color: "#b91c1c", border: "1px solid #fecaca" }}>{error}</div>
        )}

        {review && (
          <div className="space-y-5">
            <p className="text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>{review.summary}</p>

            {review.strengths.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#047857" }}>
                  <CheckCircle2 size={14} /> What went well
                </div>
                <ul className="space-y-1 text-sm list-disc pl-5" style={{ color: "var(--text-secondary)" }}>
                  {review.strengths.map((t, i) => <li key={i}>{t}</li>)}
                </ul>
              </div>
            )}

            {review.problems.map((p, i) => (
              <div key={i} className="rounded-xl p-4" style={{ border: "1px solid var(--border)" }}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{p.position ? `Problem ${p.position}: ` : ""}{p.title}</span>
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: p.outcome === "solved" ? "#ecfdf5" : "#fef2f2", color: p.outcome === "solved" ? "#047857" : "#b91c1c" }}>
                    {p.outcome === "solved" ? "Solved" : "Not solved"}
                  </span>
                </div>
                {p.mistakes.length === 0 && <div className="text-sm" style={{ color: "var(--text-muted)" }}>No mistakes to point out here.</div>}
                <div className="space-y-3">
                  {p.mistakes.map((m, j) => {
                    const [label, bg, fg] = KIND[m.kind] || ["Note", "#f4f4f5", "#52525b"];
                    return (
                      <div key={j}>
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: bg, color: fg }}>{label}</span>
                        <div className="text-sm mt-1.5" style={{ color: "var(--text-primary)" }}>{m.what}</div>
                        <div className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}><b>Fix:</b> {m.fix}</div>
                      </div>
                    );
                  })}
                </div>
                {p.takeaway && <div className="text-xs mt-3 pt-3" style={{ borderTop: "1px solid var(--border)", color: "var(--text-muted)" }}>Takeaway: {p.takeaway}</div>}
              </div>
            ))}

            {review.originalityHints.length > 0 && (
              <div className="rounded-lg p-3 text-sm flex gap-2" style={{ background: "#fffbeb", color: "#92400e", border: "1px solid #fde68a" }}>
                <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
                <div className="space-y-1.5">{review.originalityHints.map((h, i) => <div key={i}>{h}</div>)}</div>
              </div>
            )}

            {review.practice.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--accent)" }}>
                  <Lightbulb size={14} /> What to practise next
                </div>
                <ul className="space-y-1 text-sm list-disc pl-5" style={{ color: "var(--text-secondary)" }}>
                  {review.practice.map((t, i) => <li key={i}>{t}</li>)}
                </ul>
              </div>
            )}

            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              Written by AI from your submissions, so it can occasionally be wrong — use it as a starting point, not a verdict.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
