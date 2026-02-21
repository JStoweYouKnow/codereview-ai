import { useEffect, useState, useCallback } from "react";

// When empty, use same origin (dashboard + API on same domain). VITE_API_URL needed only for cross-origin (e.g. local dev).
const API_URL = import.meta.env.VITE_API_URL || (typeof window !== "undefined" ? window.location.origin : "");
const REFRESH_MS = 30_000;

// ─── Types ────────────────────────────────────────────────────────────────────

interface Stats {
  reviewsToday: number;
  totalReviews: number;
  findingsReviewed?: number;
  avgResponse: string;
}

interface ReviewItem {
  id: string;
  prNumber: number;
  prTitle: string;
  prAuthor: string;
  prUrl: string;
  repoFullName: string;
  status: string;
  findingsCount: number;
  startedAt: string;
  completedAt: string | null;
}

interface Finding {
  id: string;
  severity: string;
  category: string;
  title: string;
  description: string;
  suggestion: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  codeSnippet?: string;
  confidence?: number;
  wasAccepted: boolean | null;
}

interface ToastItem {
  id: string;
  message: string;
  type: "error" | "success" | "info";
}

interface TeamPattern {
  id: string;
  category: string;
  pattern: string;
  description: string;
  occurrences: number;
  confidence: number;
  examples: string[];
  repoFullName: string;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sec = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 604800) return `${Math.floor(sec / 86400)}d ago`;
  return d.toLocaleDateString();
}

// ─── SVG Icons ────────────────────────────────────────────────────────────────

type SvgProps = React.SVGProps<SVGSVGElement>;

const base: SvgProps = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
};

const CodeIcon    = (p: SvgProps) => <svg viewBox="0 0 24 24" {...base} {...p}><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>;
const RefreshIcon = (p: SvgProps) => <svg viewBox="0 0 24 24" {...base} {...p}><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>;
const CalendarIcon = (p: SvgProps) => <svg viewBox="0 0 24 24" {...base} {...p}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>;
const GitPrIcon   = (p: SvgProps) => <svg viewBox="0 0 24 24" {...base} {...p}><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" y1="9" x2="6" y2="21"/></svg>;
const ClockIcon   = (p: SvgProps) => <svg viewBox="0 0 24 24" {...base} {...p}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>;
const UserIcon    = (p: SvgProps) => <svg viewBox="0 0 24 24" {...base} {...p}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
const ZapIcon     = (p: SvgProps) => <svg viewBox="0 0 24 24" {...base} {...p}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>;
const CheckIcon   = (p: SvgProps) => <svg viewBox="0 0 24 24" {...base} {...p}><polyline points="20 6 9 17 4 12"/></svg>;
const XIcon       = (p: SvgProps) => <svg viewBox="0 0 24 24" {...base} {...p}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
const AlertIcon   = (p: SvgProps) => <svg viewBox="0 0 24 24" {...base} {...p}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>;
const ShieldIcon  = (p: SvgProps) => <svg viewBox="0 0 24 24" {...base} {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>;
const WrenchIcon  = (p: SvgProps) => <svg viewBox="0 0 24 24" {...base} {...p}><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>;
const InboxIcon   = (p: SvgProps) => <svg viewBox="0 0 24 24" {...base} {...p}><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>;
const ChevronDownIcon = (p: SvgProps) => <svg viewBox="0 0 24 24" {...base} {...p}><polyline points="6 9 12 15 18 9"/></svg>;
const ChevronUpIcon   = (p: SvgProps) => <svg viewBox="0 0 24 24" {...base} {...p}><polyline points="18 15 12 9 6 15"/></svg>;
const ExternalLinkIcon = (p: SvgProps) => <svg viewBox="0 0 24 24" {...base} {...p}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>;

// ─── Toast Component ──────────────────────────────────────────────────────────

function Toast({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  return (
    <div className={`toast toast-${toast.type}`} role="alert" aria-live={toast.type === "error" ? "assertive" : "polite"}>
      <span className={`toast-icon ${toast.type}`}>
        {toast.type === "error"   && <AlertIcon />}
        {toast.type === "success" && <CheckIcon />}
        {toast.type === "info"    && <AlertIcon />}
      </span>
      <span className="toast-message">{toast.message}</span>
      <button type="button" className="btn-toast-close" onClick={onDismiss} aria-label="Dismiss notification">
        <XIcon />
      </button>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [stats, setStats]   = useState<Stats | null>(null);
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [findingsMap, setFindingsMap] = useState<
    Record<string, { findings: Finding[] }>
  >({});
  const [findingsLoading, setFindingsLoading] = useState<string | null>(null);
  const [feedbackPending, setFeedbackPending] = useState<Set<string>>(new Set());
  const [demoSeeding, setDemoSeeding] = useState(false);
  const [patterns, setPatterns] = useState<TeamPattern[]>([]);
  const [apiError, setApiError] = useState<string | null>(null);
  const [aiStatus, setAiStatus] = useState<{ configured: boolean; model: string | null } | null>(null);
  const [hintDismissed, setHintDismissed] = useState(() =>
    typeof localStorage !== "undefined" && localStorage.getItem("codereview-hint-dismissed") === "1"
  );

  // Toast helpers
  const addToast = useCallback((message: string, type: ToastItem["type"] = "error") => {
    const id = crypto.randomUUID();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // Data fetching
  const fetchData = useCallback(async (silent = false) => {
    if (!API_URL) { setLoading(false); setApiError(null); return; }
    const base = API_URL.replace(/\/$/, "");
    if (silent) setRefreshing(true);
    else setLoading(true);
    setApiError(null);
    try {
      const [statsData, reviewsRes, patternsRes, statusRes] = await Promise.all([
        fetch(`${base}/api/stats`).then(r => r.ok ? r.json() : null),
        fetch(`${base}/api/reviews?limit=20`),
        fetch(`${base}/api/patterns`).then(r => r.ok ? r.json() : { items: [] }),
        fetch(`${base}/api/status`).then(r => r.ok ? r.json() : null),
      ]);
      const items = reviewsRes.ok ? (await reviewsRes.json()).items : [];
      setStats(statsData ?? { reviewsToday: 0, totalReviews: 0, findingsReviewed: 0, avgResponse: "—" });
      setReviews(items ?? []);
      setPatterns(patternsRes?.items ?? []);
      setAiStatus(statusRes?.gradient ?? null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Connection failed";
      setApiError(msg);
      if (!silent) {
        setStats({ reviewsToday: 0, totalReviews: 0, findingsReviewed: 0, avgResponse: "—" });
        setReviews([]);
        setPatterns([]);
        setAiStatus(null);
      }
      if (!silent) addToast(msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [addToast]);

  // Initial load
  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-refresh
  useEffect(() => {
    const t = setInterval(() => fetchData(true), REFRESH_MS);
    return () => clearInterval(t);
  }, [fetchData]);

  // Demo seed
  const runDemoSeed = async () => {
    if (!API_URL) return;
    setDemoSeeding(true);
    const base = API_URL.replace(/\/$/, "");
    try {
      const res = await fetch(`${base}/api/demo/seed`, { method: "POST" });
      if (!res.ok) throw new Error("Demo seed failed");
      await fetchData();
      addToast("Demo data created successfully!", "success");
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Demo seed failed");
    } finally {
      setDemoSeeding(false);
    }
  };

  // Fetch findings for a review
  const toggleFindings = async (reviewId: string) => {
    if (findingsMap[reviewId]) {
      setExpandedId(prev => prev === reviewId ? null : reviewId);
      return;
    }
    setFindingsLoading(reviewId);
    const base = API_URL.replace(/\/$/, "");
    try {
      const res = await fetch(`${base}/api/reviews/${reviewId}/findings`);
      if (!res.ok) throw new Error("Failed to load findings");
      const data = await res.json();
      setFindingsMap(prev => ({ ...prev, [reviewId]: { findings: data.findings } }));
      setExpandedId(reviewId);
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to load findings");
    } finally {
      setFindingsLoading(null);
    }
  };

  // Accept / reject a finding
  const submitFeedback = async (findingId: string, wasAccepted: boolean) => {
    setFeedbackPending(prev => new Set(prev).add(findingId));
    const base = API_URL.replace(/\/$/, "");
    try {
      const res = await fetch(`${base}/api/findings/${findingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wasAccepted }),
      });
      if (!res.ok) throw new Error("Update failed");
      setFindingsMap(prev => {
        const next = { ...prev };
        for (const rid of Object.keys(next)) {
          const entry = next[rid];
          if (entry.findings.some(f => f.id === findingId)) {
            next[rid] = {
              ...entry,
              findings: entry.findings.map(f =>
                f.id === findingId ? { ...f, wasAccepted } : f
              ),
            };
            break;
          }
        }
        return next;
      });
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to save feedback");
    } finally {
      setFeedbackPending(prev => { const s = new Set(prev); s.delete(findingId); return s; });
    }
  };

  // ── JSX ────────────────────────────────────────────────────────────────────

  return (
    <div className="layout">
      {/* ── Header ── */}
      <header className="header">
        <div className="header-inner">
          <a href="/" className="brand" aria-label="CodeReview AI">
            <div className="brand-icon"><CodeIcon /></div>
            <span className="brand-name">CodeReview AI</span>
            <span className="brand-badge">DO Gradient™</span>
          </a>

          <div className="header-spacer" />

          <div className="header-actions">
            {aiStatus && (
              <div
                className={`ai-status ${aiStatus.configured ? "ai-ready" : "ai-demo"}`}
                aria-label={aiStatus.configured ? "AI ready" : "AI demo mode"}
                title={aiStatus.configured ? `Gradient AI: ${aiStatus.model ?? "configured"}` : "Gradient key not set — demo findings only"}
              >
                <span className={`ai-dot ${aiStatus.configured ? "ready" : "demo"}`} aria-hidden="true" />
                <span>{aiStatus.configured ? "AI Ready" : "AI Demo"}</span>
              </div>
            )}
            <div className="live-indicator" aria-label="Live data">
              <span className="live-dot" aria-hidden="true" />
              <span>Live</span>
            </div>
            <button
              type="button"
              className={`btn-icon${refreshing ? " is-spinning" : ""}`}
              onClick={() => fetchData(true)}
              disabled={refreshing || loading}
              aria-label="Refresh data"
              title={`Auto-refreshes every ${REFRESH_MS / 1000}s`}
            >
              <RefreshIcon />
            </button>
          </div>
        </div>
      </header>

      {/* ── Main ── */}
      <main className="main">

        {/* Config warning */}
        {!API_URL && (
          <div className="config-banner" role="alert">
            <span className="config-banner-icon"><WrenchIcon /></span>
            <div>
              <strong>Configuration required</strong>
              <br />
              Set <code>VITE_API_URL</code> to your backend URL (e.g. <code>http://localhost:3000</code>).
            </div>
          </div>
        )}

        {/* API unreachable — compact empty state with Retry */}
        {apiError && API_URL && (
          <div className="error-empty-state" role="alert">
            <div className="error-empty-icon"><AlertIcon /></div>
            <h2 className="error-empty-title">Connection failed</h2>
            <p className="error-empty-desc">{apiError}</p>
            <p className="error-empty-hint">Ensure the webhook service is running and <code>VITE_API_URL</code> is correct.</p>
            <button
              type="button"
              className="btn-primary"
              onClick={() => fetchData()}
              autoFocus
            >
              <RefreshIcon /> Retry connection
            </button>
          </div>
        )}

        {/* Page header */}
        {!apiError && (
        <div className={`page-header ${!loading ? "reveal reveal-delay-1" : ""}`}>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">AI-powered code review insights for GitHub & GitLab</p>
          <p className="page-persona" role="doc-subtitle">Reviews are direct, constructive, and focused on real issues.</p>
        </div>
        )}

        {/* Stats */}
        {!apiError && (
        <div className="stats-grid" aria-label="Key metrics">
          {loading ? (
            <>
              <div className="stat-card skeleton" aria-hidden="true" />
              <div className="stat-card skeleton" aria-hidden="true" />
              <div className="stat-card skeleton" aria-hidden="true" />
              <div className="stat-card skeleton" aria-hidden="true" />
            </>
          ) : (
            <>
              <div className="stat-card reveal reveal-delay-1">
                <div className="stat-icon stat-icon-blue"><CalendarIcon /></div>
                <div className="stat-content">
                  <div className="stat-value">{stats?.reviewsToday ?? 0}</div>
                  <div className="stat-label">Reviews Today</div>
                </div>
              </div>
              <div className="stat-card reveal reveal-delay-2">
                <div className="stat-icon stat-icon-green"><GitPrIcon /></div>
                <div className="stat-content">
                  <div className="stat-value">{stats?.totalReviews ?? 0}</div>
                  <div className="stat-label">Total PRs Reviewed</div>
                </div>
              </div>
              <div className="stat-card reveal reveal-delay-3">
                <div className="stat-icon stat-icon-amber"><CheckIcon /></div>
                <div className="stat-content">
                  <div className="stat-value">{stats?.findingsReviewed ?? 0}</div>
                  <div className="stat-label">Findings Reviewed</div>
                </div>
              </div>
              <div className="stat-card reveal reveal-delay-4">
                <div className="stat-icon stat-icon-purple"><ClockIcon /></div>
                <div className="stat-content">
                  <div className="stat-value">{stats?.avgResponse ?? "—"}</div>
                  <div className="stat-label">Avg Response Time</div>
                </div>
              </div>
            </>
          )}
        </div>
        )}

        {/* Team Patterns */}
        {!apiError && !loading && API_URL && (
          <section aria-label="Team patterns" className="patterns-section">
            <div className="section-header">
              <h2 className="section-title">
                Team Patterns
                <span className="count-badge">{patterns.length}</span>
              </h2>
            </div>
            {patterns.length === 0 ? (
              <div className="patterns-empty">
                <p className="patterns-empty-text">
                  Patterns are learned when you <strong>Accept</strong> findings. After 3+ accepted findings per repo, the AI extracts coding preferences and applies them to future reviews.
                </p>
              </div>
            ) : (
              <ul className="pattern-list" role="list">
                {patterns.map(p => (
                  <li key={p.id} className="pattern-card">
                    <div className="pattern-header">
                      <span className="pattern-category">{p.category}</span>
                      <code className="pattern-repo">{p.repoFullName}</code>
                    </div>
                    <h3 className="pattern-name">{p.pattern}</h3>
                    <p className="pattern-desc">{p.description}</p>
                    <div className="pattern-meta">
                      Seen {p.occurrences}× · {Math.round(p.confidence * 100)}% confidence
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* First-time hint */}
        {!apiError && !loading && reviews.length === 0 && API_URL && !hintDismissed && (
          <div className="hint-banner" role="complementary">
            <span className="hint-icon"><ZapIcon /></span>
            <p className="hint-text">
              <strong>Quick start:</strong> Click &quot;Generate demo data&quot; below to create sample findings. Use Accept/Reject to give feedback — after 3+ accepted findings, the AI learns your team&apos;s patterns.
            </p>
            <button
              type="button"
              className="btn-hint-dismiss"
              onClick={() => {
                setHintDismissed(true);
                try { localStorage.setItem("codereview-hint-dismissed", "1"); } catch { /* ignore */ }
              }}
              aria-label="Dismiss hint"
            >
              <XIcon />
            </button>
          </div>
        )}

        {/* Empty state */}
        {!apiError && !loading && reviews.length === 0 && API_URL && (
          <div className="empty-state reveal reveal-delay-2" role="status">
            <div className="empty-icon"><InboxIcon /></div>
            <h2 className="empty-title">Ready to review</h2>
            <p className="empty-desc">
              Generate sample findings in one click, or connect GitHub/GitLab to review real PRs. Accept findings to teach the AI your team&apos;s patterns.
            </p>
            <div className="empty-steps">
              <span className="empty-step">1. Generate demo</span>
              <span className="empty-step-arrow">→</span>
              <span className="empty-step">2. Accept 3+ findings</span>
              <span className="empty-step-arrow">→</span>
              <span className="empty-step">3. AI learns patterns</span>
            </div>
            <button
              type="button"
              className="btn-primary btn-primary-glow"
              onClick={runDemoSeed}
              disabled={demoSeeding}
            >
              <ZapIcon />
              {demoSeeding ? "Creating demo…" : "Generate demo data"}
            </button>
          </div>
        )}

        {/* Reviews list */}
        {!apiError && !loading && reviews.length > 0 && (
          <section aria-label="Recent reviews">
            <div className="section-header">
              <h2 className="section-title">
                Recent Reviews
                <span className="count-badge">{reviews.length}</span>
              </h2>
            </div>

            <ul className="review-list" role="list">
              {reviews.map(r => {
                const isExpanded = expandedId === r.id;
                const findings   = findingsMap[r.id]?.findings;

                return (
                  <li key={r.id} className={`review-card ${r.status}`}>
                    {/* Card header */}
                    <div className="review-card-main">
                      <div className="review-info">
                        <code className="review-repo">
                          {r.repoFullName}&nbsp;#{r.prNumber}
                        </code>

                        <a
                          href={r.prUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="review-title-link"
                        >
                          {r.prTitle}
                          <ExternalLinkIcon className="review-ext-icon" />
                        </a>

                        <div className="review-meta">
                          <span className="review-meta-item">
                            <UserIcon />{r.prAuthor}
                          </span>
                          <span className="review-meta-item">
                            <ShieldIcon />
                            {r.findingsCount} {r.findingsCount === 1 ? "finding" : "findings"}
                          </span>
                          <span className="review-meta-item">
                            <ClockIcon />{timeAgo(r.startedAt)}
                          </span>
                        </div>
                      </div>

                      <div className="review-aside">
                        <span className={`status-badge ${r.status}`} aria-label={`Status: ${r.status}`}>
                          {r.status === "completed"  && <CheckIcon />}
                          {(r.status === "pending" || r.status === "analyzing") && <ClockIcon />}
                          {r.status === "failed"     && <XIcon />}
                          {r.status}
                        </span>

                        <button
                          type="button"
                          className="btn-expand"
                          onClick={() => toggleFindings(r.id)}
                          disabled={findingsLoading === r.id || r.findingsCount === 0}
                          aria-expanded={isExpanded}
                          aria-controls={`findings-${r.id}`}
                        >
                          {findingsLoading === r.id ? (
                            <><RefreshIcon className="spin-svg" /> Loading…</>
                          ) : isExpanded ? (
                            <><ChevronUpIcon /> Hide</>
                          ) : (
                            <><ChevronDownIcon /> Findings</>
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Findings panel */}
                    {isExpanded && (
                      <div
                        id={`findings-${r.id}`}
                        className="findings-panel"
                        aria-label="Code findings"
                      >
                        <div className="findings-header">
                          <h3 className="findings-label">Findings</h3>
                          <span className="findings-count-label">
                            {findingsLoading === r.id ? "Loading…" : findings ? `${findings.length} ${findings.length === 1 ? "issue" : "issues"}` : "—"}
                          </span>
                        </div>

                        {findingsLoading === r.id ? (
                          <ul className="finding-list finding-list-skeleton" role="list" aria-busy="true">
                            {[1, 2, 3].map(i => (
                              <li key={i} className="finding-item finding-skeleton">
                                <div className="finding-stripe suggestion" aria-hidden="true" />
                                <div className="finding-body">
                                  <div className="finding-header-row">
                                    <span className="severity-badge suggestion skeleton-text">—</span>
                                    <span className="finding-title skeleton-text">Loading…</span>
                                  </div>
                                  <div className="finding-desc skeleton-text">—</div>
                                  <div className="finding-actions">
                                    <span className="skeleton-text">—</span>
                                  </div>
                                </div>
                              </li>
                            ))}
                          </ul>
                        ) : findings ? (
                        <ul className="finding-list" role="list">
                          {findings.map(f => {
                            const isPending  = feedbackPending.has(f.id);
                            const isAccepted = f.wasAccepted === true;
                            const isRejected = f.wasAccepted === false;

                            return (
                              <li key={f.id} className="finding-item">
                                <div className={`finding-stripe ${f.severity}`} aria-hidden="true" />
                                <div className="finding-body">
                                  <div className="finding-header-row">
                                    <span className={`severity-badge ${f.severity}`}>
                                      {f.severity}
                                    </span>
                                    <span className="finding-title">{f.title}</span>
                                    {typeof f.confidence === "number" && (
                                      <span className="confidence-badge" title="AI confidence">
                                        {Math.round(f.confidence * 100)}%
                                      </span>
                                    )}
                                  </div>

                                  {(f.filePath || f.lineStart > 0) && (
                                    <div className="finding-location">
                                      {f.filePath && (
                                        <code className="finding-file">{f.filePath}</code>
                                      )}
                                      {f.lineStart > 0 && (
                                        <span className="finding-lines">
                                          L{f.lineStart}
                                          {f.lineEnd > f.lineStart ? `–${f.lineEnd}` : ""}
                                        </span>
                                      )}
                                    </div>
                                  )}

                                  {f.description && (
                                    <p className="finding-desc">{f.description}</p>
                                  )}

                                  {f.codeSnippet && (
                                    <pre className="finding-code"><code>{f.codeSnippet}</code></pre>
                                  )}

                                  {f.suggestion && (
                                    <div className="finding-suggestion">
                                      <strong>Suggestion</strong>
                                      <p>{f.suggestion}</p>
                                    </div>
                                  )}

                                  <div className="finding-actions">
                                    <span
                                      className={`finding-feedback ${
                                        isAccepted ? "accepted"
                                        : isRejected ? "rejected"
                                        : "none"
                                      }`}
                                    >
                                      {isAccepted && <><CheckIcon /> Accepted</>}
                                      {isRejected && <><XIcon /> Rejected</>}
                                      {!isAccepted && !isRejected && "No feedback yet"}
                                    </span>

                                    <div className="btn-group">
                                      <button
                                        type="button"
                                        className={`btn-sm btn-accept${isAccepted ? " is-active" : ""}`}
                                        onClick={() => submitFeedback(f.id, true)}
                                        disabled={isPending || isAccepted}
                                        aria-pressed={isAccepted}
                                      >
                                        <CheckIcon /> Accept
                                      </button>
                                      <button
                                        type="button"
                                        className={`btn-sm btn-reject${isRejected ? " is-active" : ""}`}
                                        onClick={() => submitFeedback(f.id, false)}
                                        disabled={isPending || isRejected}
                                        aria-pressed={isRejected}
                                      >
                                        <XIcon /> Reject
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                        ) : null}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </main>

      {/* ── Footer ── */}
      <footer className="footer">
        <div className="footer-inner">
          <span className="footer-impact">Open source · Free · Self-hosted</span>
          <span>
            Built with
            <span className="footer-dot">·</span>
            <a href="https://www.digitalocean.com/products/gradient" target="_blank" rel="noopener noreferrer">
              DigitalOcean Gradient™ AI
            </a>
          </span>
          <span>CodeReview AI · Hackathon 2026</span>
        </div>
      </footer>

      {/* ── Toast notifications ── */}
      <div className="toast-container" aria-label="Notifications">
        {toasts.map(t => (
          <Toast key={t.id} toast={t} onDismiss={() => dismissToast(t.id)} />
        ))}
      </div>
    </div>
  );
}
