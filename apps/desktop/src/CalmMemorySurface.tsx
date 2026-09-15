import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type MemoryPageStatus = "candidate" | "confirmed" | "rejected" | "superseded" | "expired";
type Sensitivity = "ordinary" | "personal" | "sensitive" | "restricted";
type MemoryHorizon = "durable" | "project" | "temporary";

type MemoryPageSourceRef = {
  sourceId: string;
  evidence?: string;
  turnIds?: string[];
};

export type CalmMemoryPage = {
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

export type CalmMemoryCounts = {
  total: number;
  candidates: number;
  confirmed: number;
};

type Props = {
  mode: "review" | "library";
  refreshToken?: number;
  onChanged?: () => void;
  onCounts?: (counts: CalmMemoryCounts) => void;
};

type EditForm = {
  title: string;
  summary: string;
  body: string;
};

function displaySubject(subject: string): string {
  const value = subject.trim();
  if (!value || value === "self" || value === "me") return "You";
  if (value.startsWith("project:")) return value.slice("project:".length).replaceAll("-", " ");
  if (value.startsWith("organisation:")) return value.slice("organisation:".length).replaceAll("-", " ");
  return value.replaceAll("-", " ");
}

export function CalmMemorySurface({ mode, refreshToken = 0, onChanged, onCounts }: Props) {
  const [pages, setPages] = useState<CalmMemoryPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await invoke<CalmMemoryPage[]>("list_memory_pages", {
        status: null,
        query: null,
      });
      setPages(next);
      onCounts?.({
        total: next.length,
        candidates: next.filter((page) => page.status === "candidate").length,
        confirmed: next.filter((page) => page.status === "confirmed").length,
      });
      setError(null);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setLoading(false);
    }
  }, [onCounts]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshToken]);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("en-GB");
    return pages
      .filter((page) => {
        if (mode === "review") return page.status === "candidate";
        if (showHistory) return page.status !== "candidate";
        return page.status === "confirmed";
      })
      .filter((page) => {
        if (!needle) return true;
        return [
          page.title,
          page.summary ?? "",
          page.body,
          page.subject,
          page.category ?? "",
          ...page.tags,
        ]
          .join(" ")
          .toLocaleLowerCase("en-GB")
          .includes(needle);
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }, [mode, pages, query, showHistory]);

  const decide = async (page: CalmMemoryPage, decision: "confirm" | "reject") => {
    if (
      decision === "confirm" &&
      page.supersedes.length > 0 &&
      !window.confirm(
        `This looks like changed context. Update memory and supersede ${page.supersedes.length} older saved ${page.supersedes.length === 1 ? "memory" : "memories"}?`,
      )
    ) {
      return;
    }

    setBusyId(page.id);
    setError(null);
    try {
      await invoke("review_memory_page", {
        id: page.id,
        decision,
        reviewDurationMs: 0,
      });
      await refresh();
      onChanged?.();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusyId(null);
    }
  };

  const startEdit = (page: CalmMemoryPage) => {
    setEditingId(page.id);
    setEditForm({
      title: page.title,
      summary: page.summary ?? "",
      body: page.body,
    });
  };

  const saveEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingId || !editForm) return;
    const page = pages.find((candidate) => candidate.id === editingId);
    if (!page) return;
    if (!editForm.title.trim() || !editForm.body.trim()) {
      setError("A memory needs a title and some useful context.");
      return;
    }

    setBusyId(page.id);
    setError(null);
    try {
      await invoke("edit_candidate_memory_page", {
        id: page.id,
        input: {
          title: editForm.title.trim(),
          summary: editForm.summary.trim() || null,
          body: editForm.body.trim(),
          category: page.category ?? null,
          tags: page.tags,
          sensitivity: page.sensitivity,
          horizon: page.horizon,
        },
      });
      setEditingId(null);
      setEditForm(null);
      await refresh();
      onChanged?.();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return <div className="calm-empty">Checking your memories…</div>;
  }

  if (mode === "review") {
    return (
      <div className="calm-memory-surface">
        {error && <div className="calm-error" role="alert">{error}</div>}
        {visible.length === 0 ? (
          <div className="calm-empty calm-empty-good">
            <strong>All caught up.</strong>
            <span>There is nothing waiting for you to review.</span>
          </div>
        ) : (
          <div className="calm-review-list">
            {visible.map((page) => {
              const editing = editingId === page.id && editForm !== null;
              return (
                <article className="calm-memory-card" key={page.id}>
                  {page.supersedes.length > 0 && (
                    <div className="calm-change-note">This looks like something has changed.</div>
                  )}
                  {editing ? (
                    <form className="calm-edit" onSubmit={saveEdit}>
                      <label>
                        Title
                        <input
                          value={editForm.title}
                          onChange={(event) => setEditForm({ ...editForm, title: event.target.value })}
                        />
                      </label>
                      <label>
                        Short orientation <span>optional</span>
                        <input
                          value={editForm.summary}
                          onChange={(event) => setEditForm({ ...editForm, summary: event.target.value })}
                        />
                      </label>
                      <label>
                        Memory
                        <textarea
                          rows={6}
                          value={editForm.body}
                          onChange={(event) => setEditForm({ ...editForm, body: event.target.value })}
                        />
                      </label>
                      <div className="calm-actions">
                        <button
                          className="calm-button calm-button-quiet"
                          type="button"
                          onClick={() => {
                            setEditingId(null);
                            setEditForm(null);
                          }}
                        >
                          Cancel
                        </button>
                        <button className="calm-button calm-button-primary" disabled={busyId === page.id}>
                          Save changes
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <div className="calm-card-context">{displaySubject(page.subject)}</div>
                      <h3>{page.title}</h3>
                      {page.summary && <p className="calm-summary">{page.summary}</p>}
                      <p className="calm-memory-copy">{page.body}</p>

                      <details className="calm-why">
                        <summary>Why did TOPO suggest this?</summary>
                        <div className="calm-why-body">
                          {page.sourceRefs.some((source) => source.evidence) ? (
                            page.sourceRefs
                              .filter((source) => source.evidence)
                              .map((source, index) => (
                                <blockquote key={`${source.sourceId}-${index}`}>“{source.evidence}”</blockquote>
                              ))
                          ) : (
                            <p>TOPO kept the source reference, but there is no short evidence excerpt to show here.</p>
                          )}
                          <div className="calm-meta">
                            <span>{page.horizon} context</span>
                            <span>{page.sensitivity}</span>
                            <span>{page.origin}</span>
                          </div>
                        </div>
                      </details>

                      <div className="calm-actions">
                        <button
                          className="calm-button calm-button-primary"
                          type="button"
                          disabled={busyId === page.id}
                          onClick={() => void decide(page, "confirm")}
                        >
                          {busyId === page.id ? "Saving…" : page.supersedes.length > 0 ? "Update memory" : "Keep"}
                        </button>
                        <button
                          className="calm-button calm-button-secondary"
                          type="button"
                          disabled={busyId === page.id}
                          onClick={() => void decide(page, "reject")}
                        >
                          Not useful
                        </button>
                        <button
                          className="calm-button calm-button-quiet"
                          type="button"
                          disabled={busyId === page.id}
                          onClick={() => startEdit(page)}
                        >
                          Edit
                        </button>
                      </div>
                    </>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="calm-memory-surface">
      {error && <div className="calm-error" role="alert">{error}</div>}
      <div className="calm-library-tools">
        <input
          aria-label="Search saved memories"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search what TOPO remembers…"
        />
        <button
          type="button"
          className="calm-button calm-button-quiet"
          onClick={() => setShowHistory((current) => !current)}
        >
          {showHistory ? "Current memories" : "History"}
        </button>
      </div>

      {visible.length === 0 ? (
        <div className="calm-empty">
          <strong>{showHistory ? "No memory history yet." : "No saved memories match that search."}</strong>
          <span>{showHistory ? "Changed, expired and rejected memories will appear here." : "Keep a suggestion on Home and it will appear here immediately."}</span>
        </div>
      ) : (
        <div className="calm-library-list">
          {visible.map((page) => (
            <article className="calm-library-card" key={page.id}>
              <div className="calm-library-card-top">
                <span>{displaySubject(page.subject)}</span>
                <span>{page.status === "confirmed" ? "Saved" : page.status}</span>
              </div>
              <h3>{page.title}</h3>
              {page.summary && <p className="calm-summary">{page.summary}</p>}
              <p className="calm-memory-copy">{page.body}</p>
              <details className="calm-why">
                <summary>Why is this here?</summary>
                <div className="calm-why-body">
                  {page.sourceRefs
                    .filter((source) => source.evidence)
                    .map((source, index) => (
                      <blockquote key={`${source.sourceId}-${index}`}>“{source.evidence}”</blockquote>
                    ))}
                  <div className="calm-meta">
                    <span>{page.horizon} context</span>
                    <span>{page.sensitivity}</span>
                    <span>revision {page.revision}</span>
                    <span>updated {new Date(page.updatedAt).toLocaleDateString()}</span>
                  </div>
                  {page.tags.length > 0 && <p className="calm-tags">{page.tags.join(" · ")}</p>}
                </div>
              </details>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
