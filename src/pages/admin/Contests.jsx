import React, { useState, useEffect, useCallback } from "react";
import { Trophy, X, Loader2, Users2 } from "lucide-react";
import { fetchAllProblems } from "../../lib/db.js";
import { useAuth } from "../../lib/auth.jsx";
import { createContest, fetchContests, deleteContest, contestStatus, fetchContestRsvps, setRsvpRevoked, fetchRsvpCount, updateContestRsvpSettings, contestUrl } from "../../lib/contestsApi.js";

function toInputValue(date) {
  // datetime-local wants "YYYY-MM-DDTHH:MM" in local time, no timezone.
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function Contests() {
  const { user } = useAuth();
  const [problems, setProblems] = useState([]);
  const [problemsLoading, setProblemsLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState(() => toInputValue(new Date(Date.now() + 10 * 60 * 1000)));
  const [endsAt, setEndsAt] = useState(() => toInputValue(new Date(Date.now() + 100 * 60 * 1000)));
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [created, setCreated] = useState(false);
  const [rsvpRequired, setRsvpRequired] = useState(false);
  const [meetupUrl, setMeetupUrl] = useState("");
  const [counts, setCounts] = useState({});
  const [openRsvps, setOpenRsvps] = useState(null);
  const [editingId, setEditingId] = useState(null);

  const [contests, setContests] = useState([]);
  const [listLoading, setListLoading] = useState(true);

  useEffect(() => {
    fetchAllProblems().then(setProblems).catch(() => {}).finally(() => setProblemsLoading(false));
  }, []);

  const refresh = useCallback(() => {
    fetchContests()
      .then((list) => {
        setContests(list);
        list.filter((c) => c.requiresAccess).forEach((c) =>
          fetchRsvpCount(c.id).then((n) => setCounts((prev) => ({ ...prev, [c.id]: n }))).catch(() => {}));
      })
      .catch(() => {})
      .finally(() => setListLoading(false));
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function validate() {
    if (selected.size === 0) return "Pick at least one problem.";
    if (!title.trim()) return "Title is required.";
    const s = new Date(startsAt);
    const e = new Date(endsAt);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return "Start and end time are required.";
    if (e <= s) return "End time must be after start time.";
    return null;
  }

  async function handleCreate() {
    const err = validate();
    if (err) {
      setCreateError(err);
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      await createContest(
        {
          title: title.trim(),
          description: description.trim() || null,
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
          problemIds: [...selected],
          meetupUrl: meetupUrl.trim() || null,
          rsvpRequired,
        },
        user.id
      );
      setSelected(new Set());
      setTitle("");
      setDescription("");
      setRsvpRequired(false);
      setMeetupUrl("");
      setCreated(true);
      setTimeout(() => setCreated(false), 1800);
      refresh();
    } catch (e) {
      setCreateError(e.message);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id) {
    if (!confirm("Delete this contest? This can't be undone.")) return;
    await deleteContest(id).catch(() => {});
    refresh();
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="card p-5">
        <div className="text-sm font-semibold mb-1" style={{ color: "var(--text-primary)" }}>New weekly contest</div>
        <p className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>
          Pick problems and a fixed start/end window. Problems lock the moment the window closes —
          ranked by problems solved, then total time + a 5-minute penalty per wrong submission.
        </p>

        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Contest title — e.g. Weekly Contest 12"
          className="input-field mb-3"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)"
          rows={2}
          className="input-field mb-4"
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          <label className="block">
            <div className="text-xs font-semibold mb-1" style={{ color: "var(--text-secondary)" }}>Starts at</div>
            <input
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className="input-field"
            />
          </label>
          <label className="block">
            <div className="text-xs font-semibold mb-1" style={{ color: "var(--text-secondary)" }}>Ends at</div>
            <input
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              className="input-field"
            />
          </label>
        </div>

        <div className="rounded-lg p-3 mb-4" style={{ background: "#fafafa", border: "1px solid var(--border)" }}>
          <label className="flex items-center gap-2 text-sm font-medium cursor-pointer" style={{ color: "var(--text-primary)" }}>
            <input type="checkbox" checked={rsvpRequired} onChange={(e) => setRsvpRequired(e.target.checked)} />
            RSVP required to take part
          </label>
          <p className="text-xs mt-1 mb-2" style={{ color: "var(--text-muted)" }}>
            Only users who RSVP can open the problems and submit. You can review the RSVP list and revoke anyone
            who isn't on your Meetup attendee list.
          </p>
          <input
            value={meetupUrl}
            onChange={(e) => setMeetupUrl(e.target.value)}
            placeholder="Meetup event URL (optional — shown on the RSVP screen)"
            className="input-field"
          />
        </div>

        {problemsLoading ? (
          <div className="flex justify-center py-8"><Loader2 size={18} className="animate-spin" style={{ color: "var(--accent)" }} /></div>
        ) : problems.length === 0 ? (
          <div className="text-sm text-center py-8" style={{ color: "var(--text-muted)" }}>
            No problems yet — add some from Content → Problems first.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4 max-h-72 overflow-y-auto pr-1">
            {problems.map((p) => (
              <label
                key={p.id}
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm cursor-pointer"
                style={{
                  background: selected.has(p.id) ? "var(--accent-soft)" : "#fafafa",
                  border: "1px solid " + (selected.has(p.id) ? "var(--accent)" : "var(--border)"),
                }}
              >
                <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                <span className="capitalize flex-1" style={{ color: "var(--text-primary)" }}>{p.title}</span>
                <span className="text-[10px] font-semibold uppercase" style={{ color: "var(--text-muted)" }}>{p.difficulty}</span>
              </label>
            ))}
          </div>
        )}

        {createError && <div className="text-xs mb-3" style={{ color: "#b91c1c" }}>{createError}</div>}
        {created && <div className="text-xs mb-3" style={{ color: "#047857" }}>Contest created.</div>}

        <button className="btn-primary" disabled={creating} onClick={handleCreate}>
          <Trophy size={14} />
          {creating ? "Creating…" : `Create contest (${selected.size} problem${selected.size === 1 ? "" : "s"})`}
        </button>
      </div>

      <div className="card p-5">
        <div className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Contests</div>
        {listLoading ? (
          <div className="flex justify-center py-8"><Loader2 size={18} className="animate-spin" style={{ color: "var(--accent)" }} /></div>
        ) : contests.length === 0 ? (
          <div className="text-sm py-6 text-center" style={{ color: "var(--text-muted)" }}>No contests yet.</div>
        ) : (
          <div className="space-y-2">
            {contests.map((c) => (
              <div key={c.id} style={{ border: "1px solid var(--border)" }} className="rounded-lg">
              <div className="p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                    {c.title}
                    <StatusPill status={contestStatus(c)} />
                    {c.requiresAccess && (
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-medium" style={{ background: "#fef3c7", color: "#92400e" }}>
                        RSVP · {counts[c.id] ?? 0} going
                      </span>
                    )}
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                    {new Date(c.startsAt).toLocaleString()} → {new Date(c.endsAt).toLocaleString()}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {c.requiresAccess && (
                    <button onClick={() => setOpenRsvps(openRsvps === c.id ? null : c.id)} className="btn-ghost text-xs !px-2 !py-1">
                      <Users2 size={12} /> RSVPs
                    </button>
                  )}
                  <button
                    onClick={() => navigator.clipboard?.writeText(contestUrl(c.id))}
                    className="btn-ghost text-xs !px-2 !py-1"
                    title="Copy shareable contest link"
                  >
                    Copy link
                  </button>
                  <button onClick={() => setEditingId(editingId === c.id ? null : c.id)} className="btn-ghost text-xs !px-2 !py-1">
                    RSVP settings
                  </button>
                  <a
                    href="#"
                    onClick={(e) => e.preventDefault()}
                    className="btn-ghost text-xs !px-2 !py-1"
                    title="Leaderboard (open from the Contests tab as a signed-in user)"
                  >
                    <Users2 size={12} /> Standings
                  </a>
                  <button onClick={() => handleDelete(c.id)} className="btn-ghost text-xs !px-2 !py-1" title="Delete contest">
                    <X size={12} /> Delete
                  </button>
                </div>
              </div>
              {editingId === c.id && (
                <RsvpSettings contest={c} onSaved={() => { setEditingId(null); refresh(); }} />
              )}
              {openRsvps === c.id && <RsvpPanel contestId={c.id} onChange={refresh} />}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function StatusPill({ status }) {
  const palette = {
    upcoming: { bg: "#f4f4f5", text: "var(--text-muted)", dot: "#a1a1aa", label: "upcoming" },
    live: { bg: "#ecfdf5", text: "#047857", dot: "#10b981", label: "live" },
    ended: { bg: "#f4f4f5", text: "var(--text-muted)", dot: "#71717a", label: "ended" },
  };
  const p = palette[status] || palette.upcoming;
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium"
      style={{ background: p.bg, color: p.text }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: p.dot }} />
      {p.label}
    </span>
  );
}

function RsvpPanel({ contestId, onChange }) {
  const [rows, setRows] = useState(null);

  const load = useCallback(() => {
    fetchContestRsvps(contestId).then(setRows).catch(() => setRows([]));
  }, [contestId]);
  useEffect(load, [load]);

  async function toggle(r) {
    await setRsvpRevoked(contestId, r.userId, !r.revoked).catch(() => {});
    load();
    onChange();
  }

  function copyCsv() {
    const csv = ["name,username,email,rsvp_at,status", ...(rows || []).map((r) =>
      [r.name, r.username, r.email, r.createdAt, r.revoked ? "revoked" : "going"].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
    navigator.clipboard?.writeText(csv);
  }

  return (
    <div className="px-3 pb-3 pt-1 border-t" style={{ borderColor: "var(--border)" }}>
      {rows === null ? (
        <div className="flex justify-center py-4"><Loader2 size={16} className="animate-spin" style={{ color: "var(--accent)" }} /></div>
      ) : rows.length === 0 ? (
        <div className="text-xs py-3 text-center" style={{ color: "var(--text-muted)" }}>No RSVPs yet.</div>
      ) : (
        <>
          <div className="flex justify-end mb-1">
            <button onClick={copyCsv} className="btn-ghost text-xs !px-2 !py-1">Copy CSV</button>
          </div>
          <div className="max-h-64 overflow-y-auto divide-y" style={{ borderColor: "var(--border)" }}>
            {rows.map((r) => (
              <div key={r.userId} className="flex items-center gap-3 py-2 text-xs" style={{ opacity: r.revoked ? 0.5 : 1 }}>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate" style={{ color: "var(--text-primary)" }}>{r.name || r.username}</div>
                  <div className="truncate" style={{ color: "var(--text-muted)" }}>{r.email}</div>
                </div>
                <div style={{ color: "var(--text-muted)" }}>{new Date(r.createdAt).toLocaleDateString()}</div>
                <button onClick={() => toggle(r)} className="btn-ghost text-xs !px-2 !py-1">{r.revoked ? "Restore" : "Revoke"}</button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function RsvpSettings({ contest, onSaved }) {
  const [required, setRequired] = useState(contest.requiresAccess);
  const [url, setUrl] = useState(contest.meetupUrl || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await updateContestRsvpSettings(contest.id, { requiresAccess: required, meetupUrl: url.trim() });
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="px-3 pb-3 pt-3 border-t" style={{ borderColor: "var(--border)" }}>
      <label className="flex items-center gap-2 text-sm font-medium cursor-pointer mb-2" style={{ color: "var(--text-primary)" }}>
        <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
        RSVP required to take part
      </label>
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="Meetup event URL (optional — shown on the RSVP screen)"
        className="input-field mb-2"
      />
      {error && <div className="text-xs mb-2" style={{ color: "#b91c1c" }}>{error}</div>}
      <button className="btn-primary text-xs" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save"}</button>
    </div>
  );
}
