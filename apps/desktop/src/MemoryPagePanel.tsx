import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type MemoryPageStatus = "candidate" | "confirmed" | "rejected" | "superseded" | "expired";
type Sensitivity = "ordinary" | "personal" | "sensitive" | "restricted";
type MemoryHorizon = "durable" | "project" | "temporary";

type MemoryPageSourceRef = {
  sourceId: string;
  evidence?: string;
  turnIds?: string[];
};

type MemoryPage = {
  id: string;
  subject: string;
  title: string;
  summary?: string;
  body: string;
  category?: string;
  tags: string[];
  status: MemoryPageStatus;
  sensitivity: Sensitivity;
  horizon: MemoryHorizon;
  origin: "manual" | "extracted" | "imported" | "compatibility";
  sourceRefs: MemoryPageSourceRef[];
  annotationIds: string[];
  validFrom?: string;
  validUntil?: string;
  supersedes: string[];
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type MemoryPageCounts = {
  total: number;
  candidates: number;
  confirmed: number;
};

type Props = {
  refreshToken: number;
  externallyBusy?: boolean;
  onMessage: (message: string | null) => void;
  onError: (message: string | null) => void;
  onCounts: (counts: MemoryPageCounts) => void;
};

type PageEditForm = {
  title: string;
  summary: string;
  body: string;
  category: string;
  tags: string;
  sensitivity: Sensitivity;
  horizon: MemoryHorizon;
};

const statusOrder: Record<MemoryPageStatus, number> = {
  candidate: 0,
  confirmed: 1,
  superseded: 2,
  expired: 3,
  rejected: 4,
};

const MAX_REVIEW_DURATION_MS = 4 * 60 * 60 * 1_000;

function formFor(page: MemoryPage): PageEditForm {
  return {
    title: page.title,
    summary: page.summary ?? "",
    body: page.body,
    category: page.category ?? "",
    tags: page.tags.join(", "),
    sensitivity: page.sensitivity,
    horizon: page.horizon,
  };
}

function sourceIdFor(page: MemoryPage): string | undefined {
  return page.sourceRefs[0]?.sourceId;
}

export function MemoryPagePanel({
  refreshToken,
  externallyBusy = false,
  onMessage,
  onError,
  onCounts,
}: Props) {
  const [pages, setPages] = useState<MemoryPage[]>([]);
  const [filter, setFilter] = useState<"all" | MemoryPageStatus>("candidate");
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<PageEditForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const reviewPointerInside = useRef(false);
  const reviewFocusInside = useRef(false);
  const reviewStartedAt = useRef<number | null>(null);
  const reviewAccumulatedMs = useRef(0);

  const pauseReviewTimer = useCallback(() => {
    if (reviewStartedAt.current === null) return;
    reviewAccumulatedMs.current += Math.max(0, performance.now() - reviewStartedAt.current);
    reviewStartedAt.current = null;
  }, []);

  const syncReviewTimer = useCallback(() => {
    const shouldRun =
      document.visibilityState === "visible" &&
      document.hasFocus() &&
      (reviewPointerInside.current || reviewFocusInside.current);

    if (shouldRun) {
      if (reviewStartedAt.current === null) {
        reviewStartedAt.current = performance.now();
      }
      return;
    }

    pauseReviewTimer();
  }, [pauseReviewTimer]);

  const snapshotReviewDuration = useCallback(() => {
    pauseReviewTimer();
    return Math.min(
      MAX_REVIEW_DURATION_MS,
      Math.max(0, Math.round(reviewAccumulatedMs.current)),
    );
  }, [pauseReviewTimer]);

  const resetReviewDuration = useCallback(() => {
    reviewAccumulatedMs.current = 0;
    reviewStartedAt.current = null;
    syncReviewTimer();
  }, [syncReviewTimer]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const nextPages = await invoke<MemoryPage[]>("list_memory_pages", {
        status: null,
        query: null,
      });
      setPages(nextPages);
      const candidates = nextPages.filter((page) => page.status === "candidate").length;
      const confirmed = nextPages.filter((page) => page.status === "confirmed").length;
      onCounts({ total: nextPages.length, candidates, confirmed });
      const reviewableIds = new Set(
        nextPages.filter((page) => page.status === "candidate").map((page) => page.id),
      );
      setSelectedIds((current) => current.filter((id) => reviewableIds.has(id)));
      setEditingId((current) => (current && reviewableIds.has(current) ? current : null));
      onError(null);
    } catch (cause) {
      onError(String(cause));
    } finally {
      setLoading(false);
    }
  }, [onCounts, onError]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshToken]);

  useEffect(() => {
    const handleActivityStateChange = () => syncReviewTimer();
    document.addEventListener("visibilitychange", handleActivityStateChange);
    window.addEventListener("focus", handleActivityStateChange);
    window.addEventListener("blur", handleActivityStateChange);
    return () => {
      document.removeEventListener("visibilitychange", handleActivityStateChange);
      window.removeEventListener("focus", handleActivityStateChange);
      window.removeEventListener("blur", handleActivityStateChange);
      pauseReviewTimer();
    };
  }, [pauseReviewTimer, syncReviewTimer]);

  const filteredPages = useMemo(() => {
    const normalisedQuery = query.trim().toLocaleLowerCase("en-GB");
    return pages
      .filter((page) => filter === "all" || page.status === filter)
      .filter((page) => {
        if (!normalisedQuery) return true;
        const haystack = [
          page.subject,
          page.title,
          page.summary ?? "",
          page.body,
          page.category ?? "",
          ...page.tags,
        ]
          .join(" ")
          .toLocaleLowerCase("en-GB");
        return haystack.includes(normalisedQuery);
      })
      .sort((left, right) => {
        if (filter === "all" && statusOrder[left.status] !== statusOrder[right.status]) {
          return statusOrder[left.status] - statusOrder[right.status];
        }
        return right.updatedAt.localeCompare(left.updatedAt);
      });
  }, [filter, pages, query]);

  const visibleCandidateIds = useMemo(
    () => filteredPages.filter((page) => page.status === "candidate").map((page) => page.id),
    [filteredPages],
  );

  const sourceCandidateCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const page of pages) {
      if (page.status !== "candidate") continue;
      const sourceId = sourceIdFor(page);
      if (!sourceId) continue;
      counts.set(sourceId, (counts.get(sourceId) ?? 0) + 1);
    }
    return counts;
  }, [pages]);

  const reviewPage = async (page: MemoryPage, decision: "confirm" | "reject") => {
    if (
      decision === "confirm" &&
      page.supersedes.length > 0 &&
      !window.confirm(
        `Confirm this change? It will supersede ${page.supersedes.length} existing confirmed Memory Page${page.supersedes.length === 1 ? "" : "s"}.`,
      )
    ) {
      return;
    }

    const reviewDurationMs = snapshotReviewDuration();
    setBusy(true);
    onError(null);
    onMessage(null);
    try {
      await invoke("review_memory_page", {
        id: page.id,
        decision,
        reviewDurationMs,
      });
      resetReviewDuration();
      setSelectedIds((current) => current.filter((id) => id !== page.id));
      if (editingId === page.id) {
        setEditingId(null);
        setEditForm(null);
      }
      onMessage(
        decision === "confirm" ? "Memory Page confirmed." : "Memory Page rejected.",
      );
      await refresh();
    } catch (cause) {
      onError(String(cause));
    } finally {
      setBusy(false);
      syncReviewTimer();
    }
  };

  const reviewSelected = async (decision: "confirm" | "reject") => {
    if (selectedIds.length === 0) return;
    const selected = pages.filter((page) => selectedIds.includes(page.id));
    if (decision === "confirm" && selected.some((page) => page.supersedes.length > 0)) {
      onError("Potential changes need individual confirmation so TOPO never replaces context in bulk.");
      return;
    }
    if (
      selectedIds.length > 1 &&
      !window.confirm(
        `${decision === "confirm" ? "Confirm" : "Reject"} ${selectedIds.length} selected Memory Pages?`,
      )
    ) {
      return;
    }

    const reviewDurationMs = snapshotReviewDuration();
    setBusy(true);
    onError(null);
    onMessage(null);
    try {
      await invoke("review_memory_pages", {
        ids: selectedIds,
        decision,
        reviewDurationMs,
      });
      resetReviewDuration();
      const count = selectedIds.length;
      setSelectedIds([]);
      onMessage(
        `${count} Memory Page${count === 1 ? "" : "s"} ${decision === "confirm" ? "confirmed" : "rejected"}.`,
      );
      await refresh();
    } catch (cause) {
      onError(String(cause));
    } finally {
      setBusy(false);
      syncReviewTimer();
    }
  };

  const startEditing = (page: MemoryPage) => {
    setEditingId(page.id);
    setEditForm(formFor(page));
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditForm(null);
  };

  const saveEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingId || !editForm) return;
    if (!editForm.title.trim() || !editForm.body.trim()) {
      onError("A Memory Page needs a title and some useful context.");
      return;
    }

    setBusy(true);
    onError(null);
    onMessage(null);
    try {
      await invoke("edit_candidate_memory_page", {
        id: editingId,
        input: {
          title: editForm.title.trim(),
          summary: editForm.summary.trim() || null,
          body: editForm.body.trim(),
          category: editForm.category.trim() || null,
          tags: editForm.tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
          sensitivity: editForm.sensitivity,
          horizon: editForm.horizon,
        },
      });
      cancelEditing();
      onMessage("Memory Page updated. Review it when ready.");
      await refresh();
    } catch (cause) {
      onError(String(cause));
    } finally {
      setBusy(false);
    }
  };

  const disabled = busy || externallyBusy;

  return (
    <section
      className="memory-page-panel"
      aria-label="Memory Pages"
      onMouseEnter={() => {
        reviewPointerInside.current = true;
        syncReviewTimer();
      }}
      onMouseLeave={() => {
        reviewPointerInside.current = false;
        syncReviewTimer();
      }}
      onFocusCapture={() => {
        reviewFocusInside.current = true;
        syncReviewTimer();
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          reviewFocusInside.current = false;
          syncReviewTimer();
        }
      }}
    >
      <div className="memory-toolbar">
        <div>
          <p className="kicker">{filter === "candidate" ? "Review inbox" : "Memory Pages"}</p>
          <h2>{filter === "candidate" ? "What is worth remembering?" : "Portable context"}</h2>
          <p className="memory-page-intro">
            Review the useful context as prose first. Structured claims remain available below for compatibility and deterministic annotations.
          </p>
          {filter === "candidate" && (
            <small className="muted">
              TOPO records active review time locally on review decisions. Time while the app is hidden, unfocused or this panel is not being used is excluded.
            </small>
          )}
        </div>
        <div className="filters">
          <input
            aria-label="Search Memory Pages"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search title, context or tags"
          />
          <select
            aria-label="Filter Memory Pages by status"
            value={filter}
            onChange={(event) => setFilter(event.target.value as "all" | MemoryPageStatus)}
          >
            <option value="all">All</option>
            <option value="candidate">Candidates</option>
            <option value="confirmed">Confirmed</option>
            <option value="superseded">Superseded</option>
            <option value="expired">Expired</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
      </div>

      {visibleCandidateIds.length > 0 && (
        <div className="batch-review-bar" aria-label="Bulk Memory Page review">
          <div>
            <strong>{selectedIds.length} selected</strong>
            <span>
              Straightforward pages can be reviewed together. Anything that may replace existing context stays an individual decision.
            </span>
          </div>
          <div className="batch-review-actions">
            <button
              className="quiet"
              type="button"
              disabled={disabled}
              onClick={() =>
                setSelectedIds(
                  filteredPages
                    .filter((page) => page.status === "candidate" && page.supersedes.length === 0)
                    .map((page) => page.id),
                )
              }
            >
              Select straightforward
            </button>
            <button
              className="quiet"
              type="button"
              disabled={disabled || selectedIds.length === 0}
              onClick={() => setSelectedIds([])}
            >
              Clear
            </button>
            <button
              className="secondary"
              type="button"
              disabled={disabled || selectedIds.length === 0}
              onClick={() => void reviewSelected("reject")}
            >
              Reject selected
            </button>
            <button
              className="primary compact"
              type="button"
              disabled={disabled || selectedIds.length === 0}
              onClick={() => void reviewSelected("confirm")}
            >
              Confirm selected
            </button>
          </div>
        </div>
      )}

      <div className="memory-page-list">
        {loading ? (
          <div className="empty-state">
            <strong>Loading Memory Pages…</strong>
          </div>
        ) : filteredPages.length === 0 ? (
          <div className="empty-state">
            <strong>{pages.length === 0 ? "No Memory Pages yet." : "No Memory Pages match this view."}</strong>
            <span>
              {pages.length === 0
                ? "Process a captured interaction and TOPO will propose a small number of coherent pages here."
                : "Change the search or status filter."}
            </span>
          </div>
        ) : (
          filteredPages.map((page) => {
            const sourceId = sourceIdFor(page);
            const editing = page.id === editingId && editForm !== null;
            return (
              <article className="memory-page-card" key={page.id}>
                <div className="claim-topline">
                  <div>
                    <span className={"status-pill " + page.status}>{page.status}</span>
                    <span className={"sensitivity " + page.sensitivity}>{page.sensitivity}</span>
                    <span className="memory-horizon">{page.horizon}</span>
                    {page.supersedes.length > 0 && (
                      <span className="change-pill">potential change</span>
                    )}
                  </div>
                  <time dateTime={page.updatedAt}>
                    {new Date(page.updatedAt).toLocaleDateString()}
                  </time>
                </div>

                <p className="subject">{page.subject}</p>
                {page.status === "candidate" && sourceId && (
                  <div className="source-group-note" title={sourceId}>
                    <span>Captured source</span>
                    <strong>
                      {sourceCandidateCounts.get(sourceId) ?? 1} Memory Page
                      {(sourceCandidateCounts.get(sourceId) ?? 1) === 1 ? "" : "s"} from this interaction
                    </strong>
                  </div>
                )}

                {editing ? (
                  <form className="memory-page-edit" onSubmit={saveEdit}>
                    <label>
                      Title
                      <input
                        value={editForm.title}
                        onChange={(event) => setEditForm({ ...editForm, title: event.target.value })}
                        required
                      />
                    </label>
                    <label>
                      Summary
                      <input
                        value={editForm.summary}
                        onChange={(event) => setEditForm({ ...editForm, summary: event.target.value })}
                        placeholder="Optional one-line orientation"
                      />
                    </label>
                    <label>
                      Memory
                      <textarea
                        value={editForm.body}
                        onChange={(event) => setEditForm({ ...editForm, body: event.target.value })}
                        rows={7}
                        required
                      />
                    </label>
                    <div className="form-grid">
                      <label>
                        Horizon
                        <select
                          value={editForm.horizon}
                          onChange={(event) => setEditForm({ ...editForm, horizon: event.target.value as MemoryHorizon })}
                        >
                          <option value="durable">Durable</option>
                          <option value="project">Project</option>
                          <option value="temporary">Temporary</option>
                        </select>
                      </label>
                      <label>
                        Sensitivity
                        <select
                          value={editForm.sensitivity}
                          onChange={(event) => setEditForm({ ...editForm, sensitivity: event.target.value as Sensitivity })}
                        >
                          <option value="ordinary">Ordinary</option>
                          <option value="personal">Personal</option>
                          <option value="sensitive">Sensitive</option>
                          <option value="restricted">Restricted</option>
                        </select>
                      </label>
                    </div>
                    <div className="form-grid">
                      <label>
                        Category
                        <input
                          value={editForm.category}
                          onChange={(event) => setEditForm({ ...editForm, category: event.target.value })}
                          placeholder="Optional"
                        />
                      </label>
                      <label>
                        Tags
                        <input
                          value={editForm.tags}
                          onChange={(event) => setEditForm({ ...editForm, tags: event.target.value })}
                          placeholder="rack, architecture"
                        />
                      </label>
                    </div>
                    <div className="candidate-actions">
                      <button className="quiet" type="button" disabled={disabled} onClick={cancelEditing}>
                        Cancel
                      </button>
                      <button className="primary compact" disabled={disabled}>
                        Save changes
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <h3 className="memory-page-title">{page.title}</h3>
                    {page.summary && <p className="memory-page-summary">{page.summary}</p>}
                    <div className="memory-page-body">{page.body}</div>

                    {page.sourceRefs
                      .filter((reference) => reference.evidence)
                      .map((reference, index) => (
                        <div className="claim-evidence" key={`${reference.sourceId}-${index}`}>
                          <span>Evidence</span>
                          <p>“{reference.evidence}”</p>
                          <small>
                            source {reference.sourceId}
                            {reference.turnIds?.length
                              ? ` · ${reference.turnIds.length} cited turn${reference.turnIds.length === 1 ? "" : "s"}`
                              : ""}
                          </small>
                        </div>
                      ))}

                    {page.supersedes.length > 0 && (
                      <div className="change-note">
                        This looks like changed context. Confirming it will supersede {page.supersedes.length} existing confirmed Memory Page{page.supersedes.length === 1 ? "" : "s"}.
                      </div>
                    )}

                    <div className="claim-meta">
                      <span>{page.origin}</span>
                      <span>revision {page.revision}</span>
                      {page.category && <span>{page.category}</span>}
                      {page.validUntil && <span>valid until {new Date(page.validUntil).toLocaleDateString()}</span>}
                    </div>
                    {page.tags.length > 0 && (
                      <div className="tags">
                        {page.tags.map((tag) => <span key={tag}>{tag}</span>)}
                      </div>
                    )}
                  </>
                )}

                {page.status === "candidate" && !editing && (
                  <div className="candidate-actions">
                    <label className="candidate-select">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(page.id)}
                        onChange={() =>
                          setSelectedIds((current) =>
                            current.includes(page.id)
                              ? current.filter((id) => id !== page.id)
                              : [...current, page.id],
                          )
                        }
                      />
                      Select
                    </label>
                    <button className="secondary" type="button" disabled={disabled} onClick={() => startEditing(page)}>
                      Edit
                    </button>
                    <button className="secondary" type="button" disabled={disabled} onClick={() => void reviewPage(page, "reject")}>
                      Reject
                    </button>
                    <button className="primary compact" type="button" disabled={disabled} onClick={() => void reviewPage(page, "confirm")}
                    >
                      Confirm
                    </button>
                  </div>
                )}
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
