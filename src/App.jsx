import React, { useState, useEffect, useMemo, useRef } from "react";
import { Zap, User, Shield, LogOut, ChevronDown, Loader2 } from "lucide-react";
import { PROBLEMS as LOCAL_PROBLEMS } from "./problems.js";
import { fetchProblemsSafe, DEFAULT_PAGE_SIZE } from "./api/problemsApi.js";
import { AuthProvider, useAuth } from "./lib/auth.jsx";
import { fetchSolvedProblemIds, fetchCatalogFacets } from "./lib/db.js";

import Auth from "./pages/Auth.jsx";
import ProblemsList from "./pages/ProblemsList.jsx";
import ProblemPage from "./pages/ProblemPage.jsx";
import Profile from "./pages/Profile.jsx";
import AdminApp from "./pages/admin/AdminApp.jsx";
import InterviewCandidate from "./pages/interview/InterviewCandidate.jsx";
import InterviewInterviewer from "./pages/interview/InterviewInterviewer.jsx";
import ContestsList from "./pages/contests/ContestsList.jsx";
import ContestWorkspace from "./pages/contests/ContestWorkspace.jsx";
import { fetchContestSummary } from "./lib/contestsApi.js";
import ContestLeaderboard from "./pages/contests/ContestLeaderboard.jsx";
import GlobalLeaderboard from "./pages/GlobalLeaderboard.jsx";
import SheetDetail from "./pages/sheets/SheetDetail.jsx";

// A candidate/interviewer link (e.g. /interview/ab12cd34/candidate) opens
// straight into that standalone view — no login, no Topbar, no normal app
// state. There's no router library here, so this just reads the URL once
// on load; these pages don't need in-app navigation.
function parseInterviewRoute() {
  if (typeof window === "undefined") return null;
  const m = window.location.pathname.match(/^\/interview\/([^/]+)\/(candidate|interviewer)\/?$/);
  return m ? { roomId: m[1], role: m[2] } : null;
}

export default function App() {
  const interviewRoute = useMemo(parseInterviewRoute, []);
  if (interviewRoute) {
    return interviewRoute.role === "candidate"
      ? <InterviewCandidate roomId={interviewRoute.roomId} />
      : <InterviewInterviewer roomId={interviewRoute.roomId} />;
  }
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  );
}

function AuthGate() {
  const { configured, loading, user } = useAuth();
  if (configured && loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-app)" }}>
        <Loader2 size={24} className="animate-spin" style={{ color: "var(--accent)" }} />
      </div>
    );
  }
  if (!user) return <Auth />;
  return <MainApp />;
}

function ContestLink({ id, onBack, onOpenLeaderboard }) {
  const [contest, setContest] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetchContestSummary(id).then(setContest).catch(() => setFailed(true));
  }, [id]);

  if (failed) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "var(--bg-app)" }}>
        <div className="text-center">
          <div className="text-base font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Contest not found</div>
          <button className="btn-secondary" onClick={onBack}>Back to contests</button>
        </div>
      </div>
    );
  }
  if (!contest) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-app)" }}>
        <Loader2 size={24} className="animate-spin" style={{ color: "var(--accent)" }} />
      </div>
    );
  }
  return <ContestWorkspace contest={contest} onBack={onBack} onOpenLeaderboard={() => onOpenLeaderboard(contest)} />;
}

function MainApp() {
  const { user, profile, isAdmin, signOut } = useAuth();
  const uiUser = {
    name: profile?.name || profile?.username || user.email,
    username: profile?.username || "",
    email: user.email,
    bio: profile?.bio || "",
    location: profile?.location || "",
    github: profile?.github || "",
    joinedAt: profile?.created_at || user.created_at,
  };

  // view: { name: 'list' | 'problem' | 'profile' | 'admin', ... }
  // Shareable links: /contest/<id> opens that contest after login. An OAuth
  // sign-in lands back on "/", so the path is stashed in sessionStorage first.
  const initialView = useMemo(() => {
    try {
      const saved = sessionStorage.getItem("sparx_return_to");
      if (saved) {
        sessionStorage.removeItem("sparx_return_to");
        window.history.replaceState(null, "", saved);
      }
    } catch {
      // sessionStorage unavailable — fall back to the current URL
    }
    const m = window.location.pathname.match(/^\/contest\/([0-9a-f-]{36})\/?$/i);
    return m ? { name: "contestLink", id: m[1] } : { name: "list" };
  }, []);
  const [view, setView] = useState(initialView);
  // Browser history mirrors in-app navigation so the back/forward buttons move
  // between screens instead of leaving the site. Views can hold non-cloneable
  // data, so history entries store only an index into this in-memory stack.
  const viewStack = useRef([initialView]);
  const viewIdx = useRef(0);
  const [solved, setSolved] = useState(new Set());
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    fetchSolvedProblemIds(user.id).then(setSolved).catch(() => {});
  }, [user.id]);

  // ----- problem catalog -----
  const [problems, setProblems] = useState(LOCAL_PROBLEMS);
  const [problemsSource, setProblemsSource] = useState("local");
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [page, setPage] = useState(1);
  const [totalRows, setTotalRows] = useState(0);
  const [difficultyFilter, setDifficultyFilter] = useState("all");
  const [companyFilter, setCompanyFilter] = useState("all");
  const [sheetFilter, setSheetFilter] = useState("all");
  const [facets, setFacets] = useState(null);
  const pageSize = DEFAULT_PAGE_SIZE;
  const totalPages = totalRows > 0 ? Math.max(1, Math.ceil(totalRows / pageSize)) : 1;

  async function loadProblems(targetPage = 1, overrides = {}) {
    const safePage = Math.max(1, Math.floor(targetPage));
    const difficulty = overrides.difficulty ?? difficultyFilter;
    const company = overrides.company ?? companyFilter;
    const sheet = overrides.sheet ?? sheetFilter;
    setLoading(true);
    setFetchError(null);
    const offset = (safePage - 1) * pageSize;
    const result = await fetchProblemsSafe({ limit: pageSize, offset, difficulty, company, sheet });
    const isUnfiltered = difficulty === "all" && company === "all" && sheet === "all";
    const dbIsEmpty = isUnfiltered && result.ok && result.total === 0;
    if (result.ok && !dbIsEmpty) {
      setProblems(result.problems);
      setProblemsSource("api");
      setTotalRows(result.total || 0);
      setPage(safePage);
      if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      setProblems(LOCAL_PROBLEMS);
      setProblemsSource("local");
      setTotalRows(0);
      setPage(1);
      if (!result.ok) setFetchError(result.error);
    }
    setLoading(false);
  }

  function localFacets() {
    const counts = { all: LOCAL_PROBLEMS.length, starter: 0, easy: 0, medium: 0, hard: 0 };
    for (const p of LOCAL_PROBLEMS) if (p.difficulty in counts) counts[p.difficulty]++;
    return { counts, companies: [], sheets: [] };
  }

  useEffect(() => {
    loadProblems(1);
    fetchCatalogFacets()
      .then(setFacets)
      .catch(() => setFacets(localFacets()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleDifficultyChange(difficulty) {
    setDifficultyFilter(difficulty);
    loadProblems(1, { difficulty });
  }

  function handleCompanyChange(company) {
    setCompanyFilter(company);
    loadProblems(1, { company });
  }

  function handleSheetChange(sheet) {
    setSheetFilter(sheet);
    loadProblems(1, { sheet });
  }

  useEffect(() => {
    window.history.replaceState({ sparxIdx: 0 }, "", window.location.pathname);
    function onPop(e) {
      const idx = e.state?.sparxIdx;
      if (idx == null) return;
      viewIdx.current = idx;
      setView(viewStack.current[idx] || { name: "list" });
      setMenuOpen(false);
      window.scrollTo({ top: 0 });
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function go(next) {
    const idx = viewIdx.current + 1;
    viewStack.current = [...viewStack.current.slice(0, idx), next];
    viewIdx.current = idx;
    window.history.pushState({ sparxIdx: idx }, "", next.name === "contest" ? `/contest/${next.contest.id}` : "/");
    setView(next);
    setMenuOpen(false);
  }

  function markSolved(id) {
    setSolved((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }

  const isAdminView = view.name === "admin" && isAdmin;
  // The contest workspace has its own sticky header (back button, live
  // countdown, standings link) — stacking the normal Topbar above it would
  // just duplicate chrome, same reasoning that hides it for the admin panel.
  const hideChrome = isAdminView || view.name === "contest" || view.name === "contestLink";

  async function handleSignOut() {
    await signOut();
    go({ name: "list" });
  }

  return (
    <div className="min-h-screen" style={{ background: "var(--bg-app)" }}>
      {!hideChrome && (
        <Topbar
          user={uiUser}
          isAdmin={isAdmin}
          menuOpen={menuOpen}
          setMenuOpen={setMenuOpen}
          onHome={() => go({ name: "list" })}
          onProfile={() => go({ name: "profile" })}
          onContests={() => go({ name: "contests" })}
          onLeaderboard={() => go({ name: "leaderboard" })}
          onAdmin={() => go({ name: "admin", subview: "dashboard" })}
          onSignOut={handleSignOut}
          currentView={view.name}
        />
      )}

      <main>
        {view.name === "list" && (
          <ProblemsList
            onOpen={(p) => go({ name: "problem", problem: p })}
            onOpenContests={() => go({ name: "contests" })}
            onOpenSheet={(tag) => go({ name: "sheet", sheetTag: tag })}
            solved={solved}
            problems={problems}
            loading={loading}
            error={fetchError}
            source={problemsSource}
            page={page}
            totalPages={totalPages}
            totalRows={totalRows}
            pageSize={pageSize}
            onGoToPage={loadProblems}
            facets={facets || { counts: { all: problems.length, starter: 0, easy: 0, medium: 0, hard: 0 }, companies: [], sheets: [] }}
            difficultyFilter={difficultyFilter}
            companyFilter={companyFilter}
            sheetFilter={sheetFilter}
            onDifficultyChange={handleDifficultyChange}
            onCompanyChange={handleCompanyChange}
            onSheetChange={handleSheetChange}
          />
        )}
        {view.name === "problem" && (
          <ProblemPage
            problem={view.problem}
            onBack={() => go({ name: "list" })}
            onSolved={markSolved}
          />
        )}
        {view.name === "sheet" && (
          <SheetDetail
            sheetTag={view.sheetTag}
            solved={solved}
            onOpen={(p) => go({ name: "problem", problem: p })}
            onBack={() => go({ name: "list" })}
          />
        )}
        {view.name === "profile" && (
          <Profile
            user={uiUser}
            userId={user.id}
            onOpenProblem={(p) => go({ name: "problem", problem: p })}
            problems={problems}
          />
        )}
        {view.name === "contests" && (
          <ContestsList onOpen={(c) => go({ name: "contest", contest: c })} />
        )}
        {view.name === "contestLink" && (
          <ContestLink
            id={view.id}
            onBack={() => go({ name: "contests" })}
            onOpenLeaderboard={(contest) => go({ name: "contestLeaderboard", contest })}
          />
        )}
        {view.name === "contest" && (
          <ContestWorkspace
            contest={view.contest}
            onBack={() => go({ name: "contests" })}
            onOpenLeaderboard={() => go({ name: "contestLeaderboard", contest: view.contest })}
          />
        )}
        {view.name === "contestLeaderboard" && (
          <ContestLeaderboard
            contest={view.contest}
            onBack={() => go({ name: "contest", contest: view.contest })}
          />
        )}
        {view.name === "leaderboard" && <GlobalLeaderboard />}
        {view.name === "admin" && !isAdmin && (
          <NotAdmin onBack={() => go({ name: "list" })} />
        )}
        {view.name === "admin" && isAdmin && (
          <AdminApp
            subview={view.subview}
            onNavigate={(sv) => go({ name: "admin", subview: sv })}
            onExit={() => go({ name: "list" })}
          />
        )}
      </main>

      {!hideChrome && (
        <footer className="mt-16 border-t" style={{ borderColor: "var(--border)" }}>
          <div className="max-w-7xl mx-auto px-6 py-6 flex flex-wrap items-center justify-between gap-3 text-xs"
               style={{ color: "var(--text-muted)" }}>
            <div>© 2026 Sparx · Online Compiler</div>
            <div>
              Powered by{" "}
              <a href="https://github.com/judge0/judge0" target="_blank" rel="noopener noreferrer"
                 className="font-medium hover:text-indigo-600" style={{ color: "var(--text-secondary)" }}>
                Judge0
              </a>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}

function NotAdmin({ onBack }) {
  return (
    <div className="max-w-md mx-auto py-24 text-center px-4">
      <Shield size={28} className="mx-auto mb-3" style={{ color: "var(--text-muted)" }} />
      <div className="text-base font-semibold mb-2" style={{ color: "var(--text-primary)" }}>Admins only</div>
      <p className="text-sm mb-5" style={{ color: "var(--text-secondary)" }}>
        Your account doesn't have admin access. Ask an existing admin to promote you
        (<code className="font-mono text-xs px-1 rounded" style={{ background: "#f4f4f5" }}>
          update profiles set role = 'admin' where id = '...'
        </code> in Supabase).
      </p>
      <button className="btn-secondary" onClick={onBack}>Back to problems</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
//  Topbar
// ---------------------------------------------------------------------------
function Topbar({ user, isAdmin, menuOpen, setMenuOpen, onHome, onProfile, onContests, onLeaderboard, onAdmin, onSignOut, currentView }) {
  return (
    <header
      className="sticky top-0 z-40 backdrop-blur-md"
      style={{
        background: "rgba(255,255,255,0.85)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <button onClick={onHome} className="flex items-center gap-2 group">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{
                background: "linear-gradient(135deg, #13B9FD 0%, #0553B1 100%)",
                boxShadow: "0 2px 8px rgba(5,83,177,0.25)",
              }}
            >
              <Zap size={18} color="white" strokeWidth={2.5} fill="white" />
            </div>
            <span className="flex items-baseline gap-1.5">
              <span className="text-lg font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
                Sparx
              </span>
              <span
                className="hidden sm:inline"
                style={{ color: "var(--accent)", fontFamily: "'Dancing Script', cursive", fontSize: "15px", fontWeight: 700 }}
              >
                by Flutter Kanpur
              </span>
            </span>
          </button>

          <nav className="hidden md:flex items-center gap-1">
            <NavLink active={currentView === "list"} onClick={onHome}>Problems</NavLink>
            <NavLink active={currentView === "contests" || currentView === "contest" || currentView === "contestLeaderboard"} onClick={onContests}>Contests</NavLink>
            <NavLink active={currentView === "leaderboard"} onClick={onLeaderboard}>Leaderboard</NavLink>
            <NavLink active={currentView === "profile"} onClick={onProfile}>Profile</NavLink>
          </nav>
        </div>

        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              onClick={onAdmin}
              className="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
              style={{
                background: "var(--accent-soft)",
                color: "var(--accent)",
                border: "1px solid transparent",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#c7d2fe")}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = "transparent")}
            >
              <Shield size={14} strokeWidth={2.5} />
              Admin
            </button>
          )}

          <div className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="flex items-center gap-2 px-2 py-1 rounded-lg transition-colors hover:bg-zinc-100"
            >
              <Avatar name={user.name} size={28} />
              <span className="hidden sm:inline text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                {user.name}
              </span>
              <ChevronDown size={14} style={{ color: "var(--text-muted)" }} />
            </button>

            {menuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
                <div
                  className="absolute right-0 top-full mt-1 w-56 z-40 rounded-lg shadow-lg fade-in py-1"
                  style={{
                    background: "white",
                    border: "1px solid var(--border)",
                    boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
                  }}
                >
                  <div className="px-3 py-2.5 border-b" style={{ borderColor: "var(--border)" }}>
                    <div className="text-sm font-semibold">{user.name}</div>
                    <div className="text-xs" style={{ color: "var(--text-muted)" }}>{user.email}</div>
                  </div>
                  <MenuItem icon={<User size={14} />} onClick={onProfile}>View profile</MenuItem>
                  {isAdmin && (
                    <MenuItem icon={<Shield size={14} />} onClick={onAdmin}>Admin panel</MenuItem>
                  )}
                  <div className="my-1 border-t" style={{ borderColor: "var(--border)" }} />
                  <MenuItem icon={<LogOut size={14} />} onClick={onSignOut}>Sign out</MenuItem>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

function NavLink({ children, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
      style={{
        color: active ? "var(--text-primary)" : "var(--text-secondary)",
        background: active ? "#f4f4f5" : "transparent",
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "#fafafa"; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
    >
      {children}
    </button>
  );
}

function MenuItem({ children, icon, onClick }) {
  return (
    <button
      onClick={onClick}
      className="w-full px-3 py-2 flex items-center gap-2.5 text-sm hover:bg-zinc-50 transition-colors text-left"
      style={{ color: "var(--text-primary)" }}
    >
      <span style={{ color: "var(--text-muted)" }}>{icon}</span>
      {children}
    </button>
  );
}

export function Avatar({ name, size = 32 }) {
  const initials = (name || "?")
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div
      className="flex items-center justify-center rounded-full font-semibold text-white flex-shrink-0"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
      }}
    >
      {initials}
    </div>
  );
}
