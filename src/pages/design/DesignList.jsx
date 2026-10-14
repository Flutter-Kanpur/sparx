import React, { useEffect, useState } from "react";
import { Boxes, CheckCircle2, CircleDashed, PencilLine } from "lucide-react";
import { useAuth } from "../../lib/auth.jsx";
import { DESIGN_QUESTIONS, SECTIONS } from "../../design/questions.js";
import { loadProgress, loadLocalProgress, filledSections } from "../../design/designApi.js";

const DIFF = {
  easy: { label: "Easy", bg: "#ecfdf5", fg: "#047857" },
  medium: { label: "Medium", bg: "#fffbeb", fg: "#b45309" },
  hard: { label: "Hard", bg: "#fef2f2", fg: "#b91c1c" },
};

export default function DesignList({ onOpen }) {
  const { user } = useAuth();
  const [progress, setProgress] = useState({});
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    const ids = DESIGN_QUESTIONS.map((q) => q.id);
    setProgress(loadLocalProgress(user.id, ids)); // instant; the account copy (if newer) follows
    loadProgress(user.id, ids).then(setProgress);
  }, [user.id]);

  const questions = DESIGN_QUESTIONS.filter((q) => filter === "all" || q.difficulty === filter);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center gap-2 mb-1">
        <Boxes size={22} style={{ color: "var(--accent)" }} />
        <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>System Design Practice</h1>
      </div>
      <p className="text-sm mb-6" style={{ color: "var(--text-secondary)" }}>
        Pick a question, write your own design section by section, check yourself against a rubric, then compare with a model answer.
      </p>

      <div className="flex gap-1.5 mb-5">
        {["all", "easy", "medium", "hard"].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors"
            style={{
              background: filter === f ? "var(--accent)" : "white",
              color: filter === f ? "white" : "var(--text-secondary)",
              border: "1px solid " + (filter === f ? "var(--accent)" : "var(--border)"),
            }}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {questions.map((q) => {
          const st = progress[q.id];
          const filled = st ? filledSections(st, SECTIONS) : 0;
          const checked = st ? Object.values(st.selfCheck || {}).filter(Boolean).length : 0;
          const d = DIFF[q.difficulty];
          const status = st?.revealed ? "done" : filled > 0 ? "progress" : "new";
          return (
            <button
              key={q.id}
              onClick={() => onOpen(q)}
              className="card p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>{q.title}</div>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0" style={{ background: d.bg, color: d.fg }}>{d.label}</span>
              </div>
              <p className="text-sm mt-2 line-clamp-2" style={{ color: "var(--text-secondary)" }}>{q.prompt}</p>
              <div className="flex flex-wrap gap-1.5 mt-3">
                {q.topics.map((t) => (
                  <span key={t} className="text-[11px] px-2 py-0.5 rounded-md" style={{ background: "#f4f4f5", color: "var(--text-muted)" }}>{t}</span>
                ))}
              </div>
              <div className="flex items-center gap-1.5 mt-4 text-xs font-medium" style={{ color: status === "done" ? "#047857" : status === "progress" ? "var(--accent)" : "var(--text-muted)" }}>
                {status === "done" ? <CheckCircle2 size={14} /> : status === "progress" ? <PencilLine size={14} /> : <CircleDashed size={14} />}
                {status === "done"
                  ? `Completed · self-check ${checked}/${q.rubric.length}`
                  : status === "progress"
                  ? `In progress · ${filled}/${SECTIONS.length} sections`
                  : "Not started"}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
