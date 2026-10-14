import React, { useEffect, useRef, useState, useCallback } from "react";
import { ArrowLeft, Lightbulb, Lock, Eye, CheckCircle2, Loader2, Cloud } from "lucide-react";
import { useAuth } from "../../lib/auth.jsx";
import { SECTIONS } from "../../design/questions.js";
import { loadAnswer, loadLocalAnswer, saveAnswer, filledSections } from "../../design/designApi.js";

const DIFF = { easy: ["Easy", "#ecfdf5", "#047857"], medium: ["Medium", "#fffbeb", "#b45309"], hard: ["Hard", "#fef2f2", "#b91c1c"] };

function Bullets({ title, items }) {
  return (
    <div className="mb-4">
      <div className="text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--text-muted)" }}>{title}</div>
      <ul className="space-y-1 text-sm list-disc pl-5" style={{ color: "var(--text-secondary)" }}>
        {items.map((t, i) => <li key={i}>{t}</li>)}
      </ul>
    </div>
  );
}

export default function DesignQuestion({ question, onBack }) {
  const { user } = useAuth();
  const [state, setState] = useState(null);
  const [tab, setTab] = useState("answer");
  const [saveStatus, setSaveStatus] = useState("saved"); // saving | saved | local
  const [confirmReveal, setConfirmReveal] = useState(false);
  const timer = useRef(null);
  const latest = useRef(null);

  const edited = useRef(false);
  useEffect(() => {
    let cancelled = false;
    edited.current = false;
    const local = loadLocalAnswer(user.id, question.id);
    if (local) { setState(local); latest.current = local; }
    loadAnswer(user.id, question.id).then((s) => {
      // the account copy replaces the on-screen one only if the user has not started typing meanwhile
      if (!cancelled && !edited.current && (!latest.current || s.updatedAt > (latest.current.updatedAt || 0))) { setState(s); latest.current = s; }
    });
    return () => { cancelled = true; };
  }, [user.id, question.id]);

  // debounced autosave; flush on leave so nothing typed is lost
  const persist = useCallback(async () => {
    if (!latest.current) return;
    setSaveStatus("saving");
    const ok = await saveAnswer(user.id, question.id, latest.current);
    setSaveStatus(ok ? "saved" : "local");
  }, [user.id, question.id]);

  function update(patch) {
    edited.current = true;
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setState(next);
    setSaveStatus("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(persist, 900);
  }

  useEffect(() => () => { clearTimeout(timer.current); if (latest.current) saveAnswer(user.id, question.id, latest.current); }, [user.id, question.id]);

  if (!state) {
    return <div className="flex justify-center py-24"><Loader2 size={24} className="animate-spin" style={{ color: "var(--accent)" }} /></div>;
  }

  const [dLabel, dBg, dFg] = DIFF[question.difficulty];
  const filled = filledSections(state, SECTIONS);
  const checked = question.rubric.filter((r) => state.selfCheck[r.id]).length;
  const hints = question.hints;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
      <button onClick={onBack} className="btn-ghost mb-4"><ArrowLeft size={14} /> All questions</button>

      <div className="flex items-center gap-3 flex-wrap mb-5">
        <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>{question.title}</h1>
        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: dBg, color: dFg }}>{dLabel}</span>
        {question.topics.map((t) => (
          <span key={t} className="text-[11px] px-2 py-0.5 rounded-md" style={{ background: "#f4f4f5", color: "var(--text-muted)" }}>{t}</span>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-5 items-start">
        {/* ---------------- the question ---------------- */}
        <div className="card p-6">
          <p className="text-[15px] leading-relaxed mb-5" style={{ color: "var(--text-primary)" }}>{question.prompt}</p>
          <Bullets title="Functional requirements" items={question.functional} />
          <Bullets title="Non-functional requirements" items={question.nonFunctional} />
          <Bullets title="Scale" items={question.scale} />

          <div className="mt-2 pt-4" style={{ borderTop: "1px solid var(--border)" }}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                <Lightbulb size={15} style={{ color: "#f59e0b" }} /> Hints
              </div>
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>{state.hintsShown}/{hints.length} shown</span>
            </div>
            {hints.slice(0, state.hintsShown).map((h, i) => (
              <div key={i} className="text-sm rounded-lg p-3 mb-2" style={{ background: "#fffbeb", color: "#92400e", border: "1px solid #fde68a" }}>
                <b>Hint {i + 1}.</b> {h}
              </div>
            ))}
            {state.hintsShown < hints.length ? (
              <button className="btn-secondary text-xs" onClick={() => update({ hintsShown: state.hintsShown + 1 })}>
                Show hint {state.hintsShown + 1}
              </button>
            ) : (
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>No more hints.</div>
            )}
          </div>

          {state.revealed && (
            <div className="mt-5 pt-4" style={{ borderTop: "1px solid var(--border)" }}>
              <Bullets title="Follow-up questions to think about" items={question.followUps} />
            </div>
          )}
        </div>

        {/* ---------------- the workspace ---------------- */}
        <div className="card overflow-hidden">
          <div className="flex items-center border-b" style={{ borderColor: "var(--border)" }}>
            {[
              ["answer", `My answer (${filled}/${SECTIONS.length})`],
              ["check", `Self-check (${checked}/${question.rubric.length})`],
              ["model", "Model answer"],
            ].map(([id, label]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className="px-5 py-3 text-sm font-medium flex items-center gap-1.5 transition-colors"
                style={{
                  color: tab === id ? "var(--text-primary)" : "var(--text-secondary)",
                  borderBottom: tab === id ? "2px solid var(--accent)" : "2px solid transparent",
                  marginBottom: -1,
                }}
              >
                {id === "model" && !state.revealed && <Lock size={12} />}
                {label}
              </button>
            ))}
            <div className="ml-auto pr-4 text-[11px] flex items-center gap-1" style={{ color: "var(--text-muted)" }} title={saveStatus === "local" ? "Saved in this browser. It will sync to your account once the database table exists." : undefined}>
              {saveStatus === "saving" ? <><Loader2 size={11} className="animate-spin" /> Saving…</> : saveStatus === "local" ? <><Cloud size={11} /> Saved on this device</> : <><CheckCircle2 size={11} /> Saved</>}
            </div>
          </div>

          <div className="p-5">
            {tab === "answer" && (
              <div className="space-y-5">
                {SECTIONS.map((s, i) => {
                  const text = state.sections[s.id] || "";
                  return (
                    <div key={s.id}>
                      <div className="flex items-baseline justify-between mb-1">
                        <label className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{i + 1}. {s.title}</label>
                        <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{text.trim() ? text.trim().split(/\s+/).length : 0} words</span>
                      </div>
                      <div className="text-xs mb-1.5" style={{ color: "var(--text-muted)" }}>{s.hint}</div>
                      <textarea
                        value={text}
                        onChange={(e) => update({ sections: { ...state.sections, [s.id]: e.target.value } })}
                        rows={Math.max(4, Math.min(14, text.split("\n").length + 2))}
                        className="input-field text-sm leading-relaxed"
                        style={{ resize: "vertical" }}
                        placeholder="Write your thinking here…"
                      />
                    </div>
                  );
                })}
              </div>
            )}

            {tab === "check" && (
              <div>
                <p className="text-sm mb-4" style={{ color: "var(--text-secondary)" }}>
                  Be honest: tick what your answer genuinely covers. Anything unticked is what to study next.
                </p>
                <div className="space-y-2">
                  {question.rubric.map((r) => (
                    <label
                      key={r.id}
                      className="flex items-start gap-3 p-3 rounded-lg cursor-pointer"
                      style={{ background: state.selfCheck[r.id] ? "var(--accent-soft)" : "#fafafa", border: "1px solid var(--border)" }}
                    >
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={!!state.selfCheck[r.id]}
                        onChange={(e) => update({ selfCheck: { ...state.selfCheck, [r.id]: e.target.checked } })}
                      />
                      <div>
                        <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{r.title}</div>
                        <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>{r.detail}</div>
                      </div>
                    </label>
                  ))}
                </div>
                <div className="mt-4 flex items-center gap-3">
                  <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "var(--border)" }}>
                    <div className="h-full rounded-full" style={{ width: `${(checked / question.rubric.length) * 100}%`, background: "var(--accent)" }} />
                  </div>
                  <div className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{checked}/{question.rubric.length}</div>
                </div>
              </div>
            )}

            {tab === "model" && (
              state.revealed ? (
                <div className="space-y-5">
                  {SECTIONS.map((s, i) => (
                    <div key={s.id}>
                      <div className="text-sm font-semibold mb-1" style={{ color: "var(--text-primary)" }}>{i + 1}. {s.title}</div>
                      <div className="text-sm leading-relaxed whitespace-pre-line rounded-lg p-3" style={{ background: "#f0f9ff", color: "var(--text-secondary)", border: "1px solid #bae6fd" }}>
                        {question.model[s.id]}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-10">
                  <Lock size={22} className="mx-auto mb-3" style={{ color: "var(--text-muted)" }} />
                  <div className="text-sm font-semibold mb-1" style={{ color: "var(--text-primary)" }}>The model answer is hidden</div>
                  <p className="text-sm mb-4 max-w-sm mx-auto" style={{ color: "var(--text-secondary)" }}>
                    You learn the most by writing your own first. You have {filled} of {SECTIONS.length} sections filled in.
                  </p>
                  {confirmReveal ? (
                    <div className="flex items-center justify-center gap-2">
                      <button className="btn-primary" onClick={() => { update({ revealed: true }); setConfirmReveal(false); }}><Eye size={14} /> Yes, reveal it</button>
                      <button className="btn-ghost" onClick={() => setConfirmReveal(false)}>Not yet</button>
                    </div>
                  ) : (
                    <button className="btn-secondary" onClick={() => setConfirmReveal(true)}>Reveal model answer</button>
                  )}
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
