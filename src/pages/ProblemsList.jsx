import React, { useState, useMemo, useEffect } from "react";
import {
  Search, ChevronRight, Check, CircleDot, ChevronLeft,
  ChevronsLeft, ChevronsRight, Loader2, Filter, X, Trophy, ChevronDown } from "lucide-react";
import { fetchContests, contestStatus } from "../lib/contestsApi.js";
import { useCountdown } from "../hooks/useCountdown.js";

export default function ProblemsList({
  onOpen, onOpenContests, onOpenSheet, solved, problems, loading, error, source,
  page, totalPages, totalRows, pageSize, onGoToPage,
  facets, difficultyFilter, companyFilter, sheetFilter, onDifficultyChange, onCompanyChange, onSheetChange,
}) {
  const [search, setSearch] = useState("");
  const isApi = source === "api";
  const counts = facets.counts;
  const companies = facets.companies;
  const sheets = facets.sheets || [];

  // Difficulty/company are applied server-side (so counts and pagination
  // stay correct across the whole filtered set) — search stays client-side
  // over just the current page.
  const filtered = useMemo(() => {
    if (!search.trim()) return problems;
    const q = search.toLowerCase();
    return problems.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.tags.some((t) => t.toLowerCase().includes(q))
    );
  }, [problems, search]);

  return (
    <div className="max-w-7xl mx-auto px-6 py-10">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
          Problem Set
        </h1>
        <p className="mt-1.5 text-sm" style={{ color: "var(--text-secondary)" }}>
          {isApi
            ? `${totalRows.toLocaleString()} problems available. Real-time judging with Judge0 sandbox.`
            : `${problems.length} problems in the built-in set. Real-time judging with Judge0 sandbox.`}
        </p>
        <div className="mt-3 flex items-center gap-2 text-xs">
          <Badge
            color={isApi ? "emerald" : "amber"}
            dot
            label={isApi ? "Live · Supabase" : "Offline fallback (Supabase not configured)"}
          />
          {error && <Badge color="red" label={`Database error: ${error.slice(0, 50)}`} />}
        </div>
      </div>

      <BannerRow onOpenContests={onOpenContests} />

      {sheets.length > 0 && (
        <div className="flex items-center gap-1 mb-5 border-b overflow-x-auto" style={{ borderColor: "var(--border)" }}>
          <SheetTab active={sheetFilter === "all"} onClick={() => onSheetChange("all")} label="All Problems" />
          {sheets.map((s) => (
            <SheetTab
              key={s.tag}
              active={sheetFilter === s.tag}
              onClick={() => (onOpenSheet ? onOpenSheet(s.tag) : onSheetChange(s.tag))}
              label={s.label}
              count={s.count}
            />
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6 items-start">
        <div className="min-w-0">
          {/* Toolbar */}
          <div className="card p-4 mb-5 flex flex-col md:flex-row md:items-center gap-3">
            <div className="relative flex-1">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2"
                style={{ color: "var(--text-muted)" }}
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search problems by title or tag…"
                className="input-field pl-9"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-zinc-100"
                >
                  <X size={14} style={{ color: "var(--text-muted)" }} />
                </button>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <Filter size={14} style={{ color: "var(--text-muted)" }} className="mr-1" />
              <FilterPill active={difficultyFilter === "all"} onClick={() => onDifficultyChange("all")} label="All" count={counts.all} />
              <FilterPill active={difficultyFilter === "starter"} onClick={() => onDifficultyChange("starter")} label="Starter" count={counts.starter} />
              <FilterPill active={difficultyFilter === "easy"} onClick={() => onDifficultyChange("easy")} label="Easy" count={counts.easy} color="emerald" />
              <FilterPill active={difficultyFilter === "medium"} onClick={() => onDifficultyChange("medium")} label="Medium" count={counts.medium} color="amber" />
              {counts.hard > 0 && (
                <FilterPill active={difficultyFilter === "hard"} onClick={() => onDifficultyChange("hard")} label="Hard" count={counts.hard} color="red" />
              )}
              {companies.length > 0 && (
                <div className="relative">
                  <select
                    value={companyFilter}
                    onChange={(e) => onCompanyChange(e.target.value)}
                    className="text-xs font-semibold pl-3 pr-8 py-1.5 rounded-lg cursor-pointer focus:outline-none appearance-none"
                    style={{
                      background: companyFilter === "all" ? "white" : "var(--accent)",
                      color: companyFilter === "all" ? "var(--text-secondary)" : "white",
                      border: `1px solid ${companyFilter === "all" ? "var(--border)" : "var(--accent)"}`,
                    }}
                  >
                    <option value="all">All companies</option>
                    {companies.map((c) => (
                      <option key={c.name} value={c.name}>{c.name} ({c.count})</option>
                    ))}
                  </select>
                  <ChevronDown
                    size={14}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                    style={{ color: companyFilter === "all" ? "var(--text-muted)" : "white" }}
                  />
                </div>
              )}
            </div>
          </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="hidden md:grid grid-cols-[60px_60px_1fr_auto_120px_60px] gap-4 px-5 py-3 text-[11px] font-semibold uppercase tracking-wider"
             style={{
               background: "#fafafa",
               borderBottom: "1px solid var(--border)",
               color: "var(--text-muted)",
             }}>
          <div>#</div>
          <div>Status</div>
          <div>Title</div>
          <div className="text-right pr-4">Tags</div>
          <div>Difficulty</div>
          <div></div>
        </div>

        {loading && problems.length === 0 ? (
          <div className="divide-y" style={{ borderColor: "var(--border)" }}>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="px-5 py-4 animate-pulse">
                <div className="h-4 bg-zinc-100 rounded w-1/3"></div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <div className="text-sm" style={{ color: "var(--text-secondary)" }}>
              No problems matched your filters.
            </div>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: "var(--border)" }}>
            {filtered.map((p, i) => {
              const isSolved = solved.has(p.id);
              const number = isApi ? (page - 1) * pageSize + i + 1 : i + 1;
              return (
                <button
                  key={p.id}
                  onClick={() => onOpen(p)}
                  className="w-full text-left group transition-colors"
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#fafafa")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <div className="grid grid-cols-[1fr_auto] md:grid-cols-[60px_60px_1fr_auto_120px_60px] gap-3 md:gap-4 px-5 py-3.5 items-center">
                    <div className="hidden md:block text-sm font-mono" style={{ color: "var(--text-muted)" }}>
                      {String(number).padStart(3, "0")}
                    </div>
                    <div className="hidden md:flex items-center justify-center">
                      {isSolved ? (
                        <div
                          className="w-6 h-6 rounded-full flex items-center justify-center"
                          style={{ background: "#d1fae5" }}
                        >
                          <Check size={12} color="#059669" strokeWidth={3} />
                        </div>
                      ) : (
                        <CircleDot size={18} style={{ color: "var(--text-muted)" }} strokeWidth={1.5} />
                      )}
                    </div>
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="text-sm font-semibold capitalize truncate" style={{ color: "var(--text-primary)" }}>
                          {p.title}
                        </div>
                        {p.companies?.length > 0 && (
                          <CompanyBadges companies={p.companies} />
                        )}
                      </div>
                      <div className="md:hidden flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
                        <DifficultyPill difficulty={p.difficulty} small />
                        {isSolved && <span className="text-emerald-600 font-medium">Solved</span>}
                      </div>
                    </div>
                    <div className="hidden md:flex flex-wrap gap-1 justify-end pr-2 max-w-[260px]">
                      {p.tags.slice(0, 3).map((t) => (
                        <span
                          key={t}
                          className="text-[11px] font-medium px-2 py-0.5 rounded-md"
                          style={{ background: "#f4f4f5", color: "var(--text-secondary)" }}
                        >
                          {t}
                        </span>
                      ))}
                      {p.tags.length > 3 && (
                        <span className="text-[11px] font-medium px-2 py-0.5 rounded-md"
                              style={{ color: "var(--text-muted)" }}>
                          +{p.tags.length - 3}
                        </span>
                      )}
                    </div>
                    <div className="hidden md:block">
                      <DifficultyPill difficulty={p.difficulty} />
                    </div>
                    <div className="flex justify-end">
                      <ChevronRight
                        size={18}
                        style={{ color: "var(--text-muted)" }}
                        className="transition-transform group-hover:translate-x-0.5"
                      />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

          {/* Pagination */}
          {isApi && filtered.length > 0 && (
            <Pager page={page} totalPages={totalPages} totalRows={totalRows} pageSize={pageSize} loading={loading} onGoToPage={onGoToPage} />
          )}
        </div>

        <Sidebar
          solvedCount={solved.size}
          totalCount={counts.all}
          companies={companies}
          companyFilter={companyFilter}
          onCompanyChange={onCompanyChange}
          onOpenContests={onOpenContests}
        />
      </div>
    </div>
  );
}

function BannerRow({ onOpenContests }) {
  const banners = [
    { id: "contests", src: "/banners/contests.webp", alt: "Weekly Contests — solve a timed set, climb the leaderboard", onClick: onOpenContests },
    { id: "interviews", src: "/banners/interviews.webp", alt: "Live mock interviews — real-time code and verdict sharing" },
    { id: "catalog", src: "/banners/catalog.webp", alt: "280+ problems tagged by topic and company" },
    { id: "community", src: "/banners/community.webp", alt: "Built by Flutter Kanpur — a student-run community" },
  ];

  return (
    <div className="flex gap-3 overflow-x-auto pb-1 mb-6 -mx-1 px-1" style={{ scrollbarWidth: "thin" }}>
      {banners.map((b) => (
        <button
          key={b.id}
          onClick={b.onClick}
          disabled={!b.onClick}
          className="flex-shrink-0 w-80 rounded-2xl overflow-hidden transition-transform"
          style={{ cursor: b.onClick ? "pointer" : "default", aspectRatio: "16 / 9" }}
          onMouseEnter={(e) => { if (b.onClick) e.currentTarget.style.transform = "translateY(-2px)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; }}
        >
          <img src={b.src} alt={b.alt} className="w-full h-full object-cover" />
        </button>
      ))}
    </div>
  );
}

function Sidebar({ solvedCount, totalCount, companies, companyFilter, onCompanyChange, onOpenContests }) {
  return (
    <aside className="hidden lg:flex flex-col gap-4">
      <ProgressCard solvedCount={solvedCount} totalCount={totalCount} />
      <ContestCard onOpenContests={onOpenContests} />
      {companies.length > 0 && (
        <TrendingCompanies companies={companies} companyFilter={companyFilter} onCompanyChange={onCompanyChange} />
      )}
    </aside>
  );
}

function ProgressCard({ solvedCount, totalCount }) {
  const pct = totalCount > 0 ? Math.round((solvedCount / totalCount) * 100) : 0;
  return (
    <div className="card p-4">
      <div className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-muted)" }}>
        Your progress
      </div>
      <div className="flex items-baseline gap-1.5 mb-2">
        <span className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>{solvedCount}</span>
        <span className="text-sm" style={{ color: "var(--text-muted)" }}>/ {totalCount} solved</span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "#f4f4f5" }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--accent)" }} />
      </div>
    </div>
  );
}

function ContestCard({ onOpenContests }) {
  const [contest, setContest] = useState(undefined); // undefined = loading, null = none

  useEffect(() => {
    let cancelled = false;
    fetchContests()
      .then((list) => {
        if (cancelled) return;
        const live = list.find((c) => contestStatus(c) === "live");
        const upcoming = list
          .filter((c) => contestStatus(c) === "upcoming")
          .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt))[0];
        setContest(live || upcoming || null);
      })
      .catch(() => setContest(null));
    return () => { cancelled = true; };
  }, []);

  if (contest === undefined) {
    return (
      <div className="card p-4 flex justify-center py-6">
        <Loader2 size={16} className="animate-spin" style={{ color: "var(--accent)" }} />
      </div>
    );
  }
  if (!contest) return null;

  return <ContestCardBody contest={contest} onOpenContests={onOpenContests} />;
}

function ContestCardBody({ contest, onOpenContests }) {
  const status = contestStatus(contest);
  const target = status === "live" ? contest.endsAt : contest.startsAt;
  const { formatted } = useCountdown(target);

  return (
    <button onClick={onOpenContests} className="card p-4 text-left transition-colors hover:bg-zinc-50">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--accent)" }}>
        <Trophy size={13} /> {status === "live" ? "Live now" : "Up next"}
      </div>
      <div className="text-sm font-semibold mb-1" style={{ color: "var(--text-primary)" }}>{contest.title}</div>
      <div className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>
        {status === "live" ? `${formatted} left` : `starts in ${formatted}`}
      </div>
    </button>
  );
}

function TrendingCompanies({ companies, companyFilter, onCompanyChange }) {
  const top = companies.slice(0, 6);
  return (
    <div className="card p-4">
      <div className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--text-muted)" }}>
        Trending companies
      </div>
      <div className="flex flex-col gap-1">
        {top.map((c) => (
          <button
            key={c.name}
            onClick={() => onCompanyChange(companyFilter === c.name ? "all" : c.name)}
            className="flex items-center justify-between px-2 py-1.5 rounded-lg text-sm transition-colors"
            style={{
              background: companyFilter === c.name ? "var(--accent-soft)" : "transparent",
              color: companyFilter === c.name ? "var(--accent)" : "var(--text-secondary)",
            }}
            onMouseEnter={(e) => { if (companyFilter !== c.name) e.currentTarget.style.background = "#fafafa"; }}
            onMouseLeave={(e) => { if (companyFilter !== c.name) e.currentTarget.style.background = "transparent"; }}
          >
            <span className="font-medium">{c.name}</span>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>{c.count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Pager({ page, totalPages, totalRows, pageSize, loading, onGoToPage }) {
  const firstIndex = (page - 1) * pageSize + 1;
  const lastIndex = Math.min(page * pageSize, totalRows);
  return (
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
      <div className="text-xs" style={{ color: "var(--text-muted)" }}>
        Showing <span className="font-medium" style={{ color: "var(--text-secondary)" }}>
          {firstIndex.toLocaleString()}–{lastIndex.toLocaleString()}
        </span> of {totalRows.toLocaleString()}
      </div>
      <div className="flex items-center gap-1">
        <PagerBtn disabled={loading || page <= 1} onClick={() => onGoToPage(1)}>
          <ChevronsLeft size={14} />
        </PagerBtn>
        <PagerBtn disabled={loading || page <= 1} onClick={() => onGoToPage(page - 1)}>
          <ChevronLeft size={14} />
        </PagerBtn>
        <div className="px-3 py-1.5 text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
          {page} / {totalPages}
        </div>
        <PagerBtn disabled={loading || page >= totalPages} onClick={() => onGoToPage(page + 1)}>
          <ChevronRight size={14} />
        </PagerBtn>
        <PagerBtn disabled={loading || page >= totalPages} onClick={() => onGoToPage(totalPages)}>
          <ChevronsRight size={14} />
        </PagerBtn>
        {loading && <Loader2 size={14} className="animate-spin ml-1" style={{ color: "var(--accent)" }} />}
      </div>
    </div>
  );
}

function PagerBtn({ children, disabled, onClick }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="p-1.5 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      style={{
        background: "white",
        border: "1px solid var(--border)",
        color: "var(--text-secondary)",
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = "#fafafa"; }}
      onMouseLeave={(e) => { if (!disabled) e.currentTarget.style.background = "white"; }}
    >
      {children}
    </button>
  );
}

function SheetTab({ label, count, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className="px-4 py-2.5 text-sm font-medium flex items-center gap-1.5 whitespace-nowrap transition-colors"
      style={{
        color: active ? "var(--accent)" : "var(--text-secondary)",
        borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
        marginBottom: "-1px",
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = "var(--text-primary)"; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = "var(--text-secondary)"; }}
    >
      {label}
      {count != null && (
        <span
          className="text-[10px] px-1.5 py-0.5 rounded"
          style={{ background: active ? "var(--accent-soft)" : "#f4f4f5", color: active ? "var(--accent)" : "var(--text-muted)" }}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function FilterPill({ label, count, active, onClick, color }) {
  const activeColor = {
    emerald: { bg: "#059669", text: "white" },
    amber: { bg: "#d97706", text: "white" },
    red: { bg: "#dc2626", text: "white" },
  }[color] || { bg: "var(--text-primary)", text: "white" };

  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
      style={{
        background: active ? activeColor.bg : "white",
        color: active ? activeColor.text : "var(--text-secondary)",
        border: `1px solid ${active ? activeColor.bg : "var(--border)"}`,
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "#fafafa"; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "white"; }}
    >
      {label}
      <span
        className="text-[10px] px-1.5 py-0.5 rounded"
        style={{
          background: active ? "rgba(255,255,255,0.2)" : "#f4f4f5",
          color: active ? "white" : "var(--text-muted)",
        }}
      >
        {count}
      </span>
    </button>
  );
}

export function DifficultyPill({ difficulty, small }) {
  const palette = {
    starter: { bg: "#dbeafe", text: "#1d4ed8", label: "Starter" },
    easy: { bg: "#d1fae5", text: "#047857", label: "Easy" },
    medium: { bg: "#fef3c7", text: "#b45309", label: "Medium" },
    hard: { bg: "#fee2e2", text: "#b91c1c", label: "Hard" },
  };
  const p = palette[difficulty] || palette.easy;
  return (
    <span
      className="inline-flex items-center font-semibold rounded-full"
      style={{
        background: p.bg,
        color: p.text,
        fontSize: small ? "10px" : "11px",
        padding: small ? "1px 8px" : "2px 10px",
        letterSpacing: "0.02em",
      }}
    >
      {p.label}
    </span>
  );
}

export function CompanyBadges({ companies, max = 2 }) {
  if (!companies || companies.length === 0) return null;
  const shown = companies.slice(0, max);
  const extra = companies.length - shown.length;
  return (
    <div className="flex items-center gap-1 flex-shrink-0">
      {shown.map((c) => (
        <span
          key={c}
          className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
          style={{ background: "#ede9fe", color: "#6d28d9" }}
        >
          {c}
        </span>
      ))}
      {extra > 0 && (
        <span className="text-[10px] font-medium" style={{ color: "var(--text-muted)" }}>+{extra}</span>
      )}
    </div>
  );
}

function Badge({ label, color, dot }) {
  const palette = {
    emerald: { bg: "#d1fae5", text: "#047857", dot: "#10b981" },
    amber: { bg: "#fef3c7", text: "#92400e", dot: "#f59e0b" },
    red: { bg: "#fee2e2", text: "#b91c1c", dot: "#ef4444" },
    indigo: { bg: "#e0e7ff", text: "#4338ca", dot: "#6366f1" },
  };
  const p = palette[color] || palette.indigo;
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium"
      style={{ background: p.bg, color: p.text }}
    >
      {dot && (
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: p.dot }}
        />
      )}
      {label}
    </span>
  );
}
