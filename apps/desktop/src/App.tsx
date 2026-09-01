import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type ClaimStatus = "candidate" | "confirmed" | "rejected" | "superseded" | "expired";
type EpistemicType = "assertion" | "observation" | "inference" | "preference" | "derived-pattern";
type Sensitivity = "ordinary" | "personal" | "sensitive" | "restricted";

type MemoryClaim = {
  id: string;
  subject: string;
  key: string;
  value: unknown;
  category?: string;
  tags: string[];
  epistemicType: EpistemicType;
  confidence: number;
  provenance: {
    sourceType: string;
    provider?: string;
    sourceId?: string;
    evidence?: string;
    capturedAt: string;
  };
  status: ClaimStatus;
  sensitivity: Sensitivity;
  validFrom?: string;
  validUntil?: string;
  supersedes: string[];
  createdAt: string;
  updatedAt: string;
};

type DesktopStatus = {
  contractVersion: string;
  storePath: string;
  confirmed: number;
  candidates: number;
  total: number;
};

type ClaimDraft = {
  subject: string;
  key: string;
  value: unknown;
  category?: string;
  tags: string[];
  epistemicType: EpistemicType;
  confidence: number;
  sensitivity: Sensitivity;
};

type ContextPreview = {
  packet: Record<string, unknown>;
  selectedClaimIds: string[];
};

type LocalContextSharingStatus = {
  enabled: boolean;
  contributionsEnabled: boolean;
  captureEnabled: boolean;
  maxSensitivity: "personal";
  resetsOnRestart: boolean;
};

type CaptureInboxItem = {
  id: string;
  product: string;
  client: string;
  mode: string;
  captureMethod: string;
  fidelity: string;
  title?: string;
  capturedAt: string;
  turnCount: number;
};

type CaptureInboxStatus = {
  directory: string;
  pending: number;
  invalid: number;
  items: CaptureInboxItem[];
};

type OllamaStatus = {
  available: boolean;
  models: string[];
  error?: string;
};

type CaptureProcessResult = {
  interactionId: string;
  extractor: string;
  duplicateSnapshot: boolean;
  proposalsExtracted: number;
  candidatesCreated: number;
  supportingEvidenceAdded: number;
  potentialChanges: number;
  sourceId?: string;
};

const emptyForm = {
  subject: "",
  key: "",
  value: "",
  category: "",
  tags: "",
  epistemicType: "assertion" as EpistemicType,
  confidence: "1",
  sensitivity: "ordinary" as Sensitivity,
};

const displayValue = (value: unknown) =>
  typeof value === "string" ? value : JSON.stringify(value, null, 2);

const parseValue = (value: string): unknown => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
};

const toDraft = (form: typeof emptyForm): ClaimDraft => ({
  subject: form.subject.trim(),
  key: form.key.trim(),
  value: parseValue(form.value),
  ...(form.category.trim() ? { category: form.category.trim() } : {}),
  tags: form.tags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean),
  epistemicType: form.epistemicType,
  confidence: Number(form.confidence),
  sensitivity: form.sensitivity,
});

export function App() {
  const [status, setStatus] = useState<DesktopStatus | null>(null);
  const [claims, setClaims] = useState<MemoryClaim[]>([]);
  const [filter, setFilter] = useState<"all" | ClaimStatus>("candidate");
  const [query, setQuery] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saveAsCandidate, setSaveAsCandidate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contextSubject, setContextSubject] = useState("");
  const [contextPurpose, setContextPurpose] = useState("");
  const [includeSensitive, setIncludeSensitive] = useState(false);
  const [contextPreview, setContextPreview] = useState<ContextPreview | null>(null);
  const [localSharing, setLocalSharing] =
    useState<LocalContextSharingStatus | null>(null);
  const [sharingBusy, setSharingBusy] = useState(false);
  const [captureInbox, setCaptureInbox] = useState<CaptureInboxStatus | null>(null);
  const [ollama, setOllama] = useState<OllamaStatus | null>(null);
  const [extractorModel, setExtractorModel] = useState(
    () => window.localStorage.getItem("topo.ollamaModel") ?? "",
  );
  const [captureBusy, setCaptureBusy] = useState(false);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    try {
      const [nextStatus, nextClaims, nextCaptureInbox] = await Promise.all([
        invoke<DesktopStatus>("desktop_status"),
        invoke<MemoryClaim[]>("list_claims", {
          status: filter === "all" ? null : filter,
          query: query.trim() || null,
        }),
        invoke<CaptureInboxStatus>("capture_inbox_status"),
      ]);
      setStatus(nextStatus);
      setClaims(nextClaims);
      setCaptureInbox(nextCaptureInbox);
      const reviewableIds = new Set(
        nextClaims.filter((claim) => claim.status === "candidate").map((claim) => claim.id),
      );
      setSelectedCandidateIds((current) => current.filter((id) => reviewableIds.has(id)));
      setError(null);
    } catch (cause) {
      setError(String(cause));
    }
  }, [filter, query]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void invoke<LocalContextSharingStatus>("local_context_sharing_status")
      .then(setLocalSharing)
      .catch((cause) => setError(String(cause)));
  }, []);

  useEffect(() => {
    void invoke<OllamaStatus>("ollama_extractor_status")
      .then((next) => {
        setOllama(next);
        if (next.available && next.models.length > 0) {
          setExtractorModel((current) => {
            const selected = current && next.models.includes(current)
              ? current
              : next.models[0];
            if (selected) window.localStorage.setItem("topo.ollamaModel", selected);
            return selected ?? "";
          });
        }
      })
      .catch((cause) => setOllama({ available: false, models: [], error: String(cause) }));
  }, []);

  const candidateCount = status?.candidates ?? 0;
  const visibleSubjects = useMemo(
    () => [...new Set(claims.map((claim) => claim.subject))].sort(),
    [claims],
  );
  const visibleCandidateIds = useMemo(
    () => claims.filter((claim) => claim.status === "candidate").map((claim) => claim.id),
    [claims],
  );
  const sourceCandidateCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const claim of claims) {
      if (claim.status !== "candidate" || !claim.provenance.sourceId) continue;
      counts.set(claim.provenance.sourceId, (counts.get(claim.provenance.sourceId) ?? 0) + 1);
    }
    return counts;
  }, [claims]);
  const displayedClaims = useMemo(() => {
    if (filter !== "candidate") return claims;
    return [...claims].sort((left, right) => {
      const leftSource = left.provenance.sourceId ?? left.id;
      const rightSource = right.provenance.sourceId ?? right.id;
      return leftSource.localeCompare(rightSource) || right.updatedAt.localeCompare(left.updatedAt);
    });
  }, [claims, filter]);

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
    setSaveAsCandidate(false);
  };

  const submitClaim = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const input = toDraft(form);
      if (!input.subject || !input.key) {
        throw new Error("Subject and key are required.");
      }
      if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
        throw new Error("Confidence must be between 0 and 1.");
      }

      if (editingId) {
        await invoke("edit_candidate_claim", { id: editingId, input });
        setMessage("Candidate updated.");
      } else {
        await invoke("create_claim", { input, candidate: saveAsCandidate });
        setMessage(saveAsCandidate ? "Candidate saved for review." : "Memory confirmed.");
      }
      resetForm();
      await refresh();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };

  const startEditing = (claim: MemoryClaim) => {
    setEditingId(claim.id);
    setSaveAsCandidate(true);
    setForm({
      subject: claim.subject,
      key: claim.key,
      value: displayValue(claim.value),
      category: claim.category ?? "",
      tags: claim.tags.join(", "),
      epistemicType: claim.epistemicType,
      confidence: String(claim.confidence),
      sensitivity: claim.sensitivity,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const review = async (id: string, decision: "confirm" | "reject") => {
    setBusy(true);
    setError(null);
    try {
      await invoke("review_candidate", { id, decision });
      setSelectedCandidateIds((current) => current.filter((candidateId) => candidateId !== id));
      setMessage(decision === "confirm" ? "Candidate confirmed." : "Candidate rejected.");
      if (editingId === id) resetForm();
      await refresh();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };

  const toggleCandidateSelection = (id: string) => {
    setSelectedCandidateIds((current) =>
      current.includes(id)
        ? current.filter((candidateId) => candidateId !== id)
        : [...current, id],
    );
  };

  const selectStraightforwardCandidates = () => {
    setSelectedCandidateIds(
      claims
        .filter((claim) => claim.status === "candidate" && claim.supersedes.length === 0)
        .map((claim) => claim.id),
    );
  };

  const reviewSelected = async (decision: "confirm" | "reject") => {
    if (selectedCandidateIds.length === 0) return;
    const selectedClaims = claims.filter((claim) => selectedCandidateIds.includes(claim.id));
    if (
      decision === "confirm" &&
      selectedClaims.some((claim) => claim.supersedes.length > 0)
    ) {
      setError(
        "Potential changes need individual confirmation so existing memory is not superseded in bulk.",
      );
      return;
    }

    const label = decision === "confirm" ? "confirm" : "reject";
    if (
      selectedCandidateIds.length > 1 &&
      !window.confirm(
        `${label[0].toUpperCase() + label.slice(1)} ${selectedCandidateIds.length} selected candidates?`,
      )
    ) {
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await invoke("review_candidates", { ids: selectedCandidateIds, decision });
      const count = selectedCandidateIds.length;
      setSelectedCandidateIds([]);
      setMessage(
        `${count} candidate${count === 1 ? "" : "s"} ${decision === "confirm" ? "confirmed" : "rejected"}.`,
      );
      await refresh();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };

  const setLocalSharingEnabled = async (enabled: boolean) => {
    setSharingBusy(true);
    setError(null);
    try {
      const next = await invoke<LocalContextSharingStatus>(
        "set_local_context_sharing",
        { enabled },
      );
      setLocalSharing(next);
      setMessage(
        enabled
          ? "Local tools can use approved TOPO context for this session. Rack will connect automatically."
          : "Local tool access stopped.",
      );
    } catch (cause) {
      setError(String(cause));
    } finally {
      setSharingBusy(false);
    }
  };

  const setLocalCaptureEnabled = async (enabled: boolean) => {
    setSharingBusy(true);
    setError(null);
    try {
      const next = await invoke<LocalContextSharingStatus>(
        "set_local_capture",
        { enabled },
      );
      setLocalSharing(next);
      setMessage(
        enabled
          ? "Compatible local agents may send raw interaction captures into the TOPO review pipeline."
          : "Local agent interaction capture stopped.",
      );
      await refresh();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setSharingBusy(false);
    }
  };

  const setLocalContributionsEnabled = async (enabled: boolean) => {
    setSharingBusy(true);
    setError(null);
    try {
      const next = await invoke<LocalContextSharingStatus>(
        "set_local_contributions",
        { enabled },
      );
      setLocalSharing(next);
      setMessage(
        enabled
          ? "Local tools may propose reviewable memory candidates for this session."
          : "Local memory contributions stopped.",
      );
    } catch (cause) {
      setError(String(cause));
    } finally {
      setSharingBusy(false);
    }
  };

  const selectExtractorModel = (model: string) => {
    setExtractorModel(model);
    if (model) window.localStorage.setItem("topo.ollamaModel", model);
    else window.localStorage.removeItem("topo.ollamaModel");
  };

  const processCapturedInteractions = async () => {
    if (!captureInbox || captureInbox.items.length === 0) return;
    if (!extractorModel) {
      setError("Choose a local Ollama model before extracting captured interactions.");
      return;
    }

    setCaptureBusy(true);
    setError(null);
    setMessage(null);
    try {
      const results: CaptureProcessResult[] = [];
      for (const item of captureInbox.items) {
        results.push(
          await invoke<CaptureProcessResult>("process_capture_with_ollama", {
            interactionId: item.id,
            model: extractorModel,
          }),
        );
      }

      const candidates = results.reduce((sum, result) => sum + result.candidatesCreated, 0);
      const evidence = results.reduce(
        (sum, result) => sum + result.supportingEvidenceAdded,
        0,
      );
      const changes = results.reduce((sum, result) => sum + result.potentialChanges, 0);
      setMessage(
        `Capture processed locally: ${candidates} candidate${candidates === 1 ? "" : "s"}, ` +
          `${evidence} supporting evidence update${evidence === 1 ? "" : "s"}` +
          (changes > 0 ? `, ${changes} potential change${changes === 1 ? "" : "s"} flagged.` : "."),
      );
      await refresh();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setCaptureBusy(false);
    }
  };

  const previewContext = async () => {
    setBusy(true);
    setError(null);
    setContextPreview(null);
    try {
      const preview = await invoke<ContextPreview>("preview_context", {
        subject: contextSubject,
        purpose: contextPurpose,
        includeSensitive,
        maxItems: 20,
      });
      setContextPreview(preview);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">TOPO / local alpha</p>
          <h1>Keep the useful context. Know why it is there.</h1>
        </div>
        <div className="store-status" aria-label="Local store status">
          <span>{status?.total ?? "—"} memories</span>
          <span>{candidateCount} awaiting review</span>
          <span>{captureInbox?.pending ?? "—"} captured interactions waiting</span>
          <code title={status?.storePath}>{status?.storePath ?? "~/.topo/topo.sqlite"}</code>
        </div>
      </header>

      {(message || error) && (
        <div className={error ? "notice error" : "notice"} role={error ? "alert" : "status"}>
          {error ?? message}
        </div>
      )}

      <section className="workspace">
        <aside className="editor-panel">
          <div className="section-heading">
            <div>
              <p className="kicker">{editingId ? "Review" : "Add memory"}</p>
              <h2>{editingId ? "Edit candidate" : "Record something worth keeping"}</h2>
            </div>
            {editingId && <button className="quiet" onClick={resetForm}>Cancel</button>}
          </div>

          <form onSubmit={submitClaim} className="claim-form">
            <div className="capture-inbox-control">
              <div className="capture-inbox-heading">
                <div>
                  <strong>Ambient capture</strong>
                  <span>
                    {captureInbox === null
                      ? "Checking local inbox…"
                      : captureInbox.pending > 0
                        ? `${captureInbox.pending} interaction${captureInbox.pending === 1 ? "" : "s"} waiting`
                        : "Ready — nothing waiting"}
                  </span>
                </div>
                <button className="quiet" type="button" onClick={() => void refresh()}>
                  Refresh
                </button>
              </div>
              <p>
                ChatGPT, Claude and Gemini browser capture can queue locally even when TOPO is closed.
                Captured interactions remain source material until TOPO extracts candidates and you review them.
              </p>
              <div className="capture-extractor">
                <div>
                  <strong>Local extractor</strong>
                  <span>
                    {ollama === null
                      ? "Checking Ollama…"
                      : ollama.available
                        ? `${ollama.models.length} model${ollama.models.length === 1 ? "" : "s"} available`
                        : "Ollama not available"}
                  </span>
                </div>
                {ollama?.available && ollama.models.length > 0 ? (
                  <select
                    aria-label="Ollama extraction model"
                    value={extractorModel}
                    onChange={(event) => selectExtractorModel(event.target.value)}
                  >
                    {ollama.models.map((model) => (
                      <option key={model} value={model}>{model}</option>
                    ))}
                  </select>
                ) : (
                  <small>
                    {ollama?.error ?? "Install/start Ollama to extract captures locally."}
                  </small>
                )}
                <button
                  className="secondary"
                  type="button"
                  disabled={
                    captureBusy ||
                    !captureInbox ||
                    captureInbox.pending === 0 ||
                    !ollama?.available ||
                    !extractorModel
                  }
                  onClick={() => void processCapturedInteractions()}
                >
                  {captureBusy
                    ? "Extracting locally…"
                    : `Extract ${captureInbox?.pending ?? 0} waiting`}
                </button>
              </div>
              {captureInbox && captureInbox.items.length > 0 && (
                <div className="capture-inbox-list">
                  {captureInbox.items.slice(0, 4).map((item) => (
                    <div key={item.id} className="capture-inbox-item">
                      <span>{item.product} · {item.client} · {item.mode}</span>
                      <strong>{item.title ?? "Untitled interaction"}</strong>
                      <small>{item.turnCount} turns · {item.fidelity}</small>
                    </div>
                  ))}
                  {captureInbox.items.length > 4 && (
                    <small>+ {captureInbox.items.length - 4} more waiting</small>
                  )}
                </div>
              )}
              {captureInbox && captureInbox.invalid > 0 && (
                <p className="capture-warning">
                  {captureInbox.invalid} capture file{captureInbox.invalid === 1 ? "" : "s"} could not be read.
                </p>
              )}
            </div>

            <div className="local-sharing-control">
              <div className="local-sharing-heading">
                <div>
                  <strong>Local connections</strong>
                  <span>Separate authority for reading context and suggesting memory</span>
                </div>
              </div>

              <div className="local-permission-row">
                <div>
                  <strong>Share context</strong>
                  <span>
                    {localSharing?.enabled
                      ? "Ordinary + personal context allowed this session"
                      : "Context sharing off"}
                  </span>
                </div>
                <button
                  className={localSharing?.enabled ? "quiet" : "secondary"}
                  type="button"
                  disabled={sharingBusy || localSharing === null}
                  onClick={() =>
                    void setLocalSharingEnabled(!localSharing?.enabled)
                  }
                >
                  {sharingBusy
                    ? "Updating…"
                    : localSharing?.enabled
                      ? "Stop sharing"
                      : "Allow context"}
                </button>
              </div>

              <div className="local-permission-row">
                <div>
                  <strong>Capture interactions</strong>
                  <span>
                    {localSharing?.captureEnabled
                      ? "Compatible local agents may send raw turns to the capture inbox"
                      : "Local agent capture off"}
                  </span>
                </div>
                <button
                  className={localSharing?.captureEnabled ? "quiet" : "secondary"}
                  type="button"
                  disabled={sharingBusy || localSharing === null}
                  onClick={() =>
                    void setLocalCaptureEnabled(!localSharing?.captureEnabled)
                  }
                >
                  {sharingBusy
                    ? "Updating…"
                    : localSharing?.captureEnabled
                      ? "Stop capture"
                      : "Allow capture"}
                </button>
              </div>

              <div className="local-permission-row">
                <div>
                  <strong>Accept contributions</strong>
                  <span>
                    {localSharing?.contributionsEnabled
                      ? "Local tools may add reviewable candidates"
                      : "Candidate suggestions off"}
                  </span>
                </div>
                <button
                  className={localSharing?.contributionsEnabled ? "quiet" : "secondary"}
                  type="button"
                  disabled={sharingBusy || localSharing === null}
                  onClick={() =>
                    void setLocalContributionsEnabled(
                      !localSharing?.contributionsEnabled,
                    )
                  }
                >
                  {sharingBusy
                    ? "Updating…"
                    : localSharing?.contributionsEnabled
                      ? "Stop suggestions"
                      : "Allow suggestions"}
                </button>
              </div>

              <p>
                RACK, Claude Desktop and other compatible local tools only receive
                the authority you enable here. Sharing context never implies write
                authority. Agent capture stores source interactions for TOPO to
                extract later; contributions can create candidates only. Confirmation
                and rejection stay in TOPO. All permissions reset when TOPO restarts.
              </p>
            </div>

            <label>
              Subject
              <input
                value={form.subject}
                onChange={(event) => setForm({ ...form, subject: event.target.value })}
                placeholder="project:rack, organisation:example, me"
                list="known-subjects"
                required
              />
            </label>
            <datalist id="known-subjects">
              {visibleSubjects.map((subject) => <option key={subject} value={subject} />)}
            </datalist>

            <label>
              Key
              <input
                value={form.key}
                onChange={(event) => setForm({ ...form, key: event.target.value })}
                placeholder="writing.locale"
                required
              />
            </label>

            <label>
              Value
              <textarea
                value={form.value}
                onChange={(event) => setForm({ ...form, value: event.target.value })}
                placeholder="A string, number, JSON object or list"
                rows={5}
              />
            </label>

            <div className="form-grid">
              <label>
                Type
                <select
                  value={form.epistemicType}
                  onChange={(event) =>
                    setForm({ ...form, epistemicType: event.target.value as EpistemicType })
                  }
                >
                  <option value="assertion">Assertion</option>
                  <option value="observation">Observation</option>
                  <option value="preference">Preference</option>
                  <option value="inference">Inference</option>
                  <option value="derived-pattern">Derived pattern</option>
                </select>
              </label>

              <label>
                Sensitivity
                <select
                  value={form.sensitivity}
                  onChange={(event) =>
                    setForm({ ...form, sensitivity: event.target.value as Sensitivity })
                  }
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
                  value={form.category}
                  onChange={(event) => setForm({ ...form, category: event.target.value })}
                  placeholder="Optional"
                />
              </label>
              <label>
                Confidence
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={form.confidence}
                  onChange={(event) => setForm({ ...form, confidence: event.target.value })}
                />
              </label>
            </div>

            <label>
              Tags
              <input
                value={form.tags}
                onChange={(event) => setForm({ ...form, tags: event.target.value })}
                placeholder="writing, project, preference"
              />
            </label>

            {!editingId && (
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={saveAsCandidate}
                  onChange={(event) => setSaveAsCandidate(event.target.checked)}
                />
                Save as a candidate for review instead of confirming now
              </label>
            )}

            <button className="primary" disabled={busy}>
              {editingId ? "Save candidate" : saveAsCandidate ? "Save candidate" : "Confirm memory"}
            </button>
          </form>

          <div className="context-panel">
            <p className="kicker">Context preview</p>
            <h2>What would TOPO share?</h2>
            <p className="muted">
              Preview the purpose-bound Context Packet used by RACK and other compatible tools.
            </p>
            <label>
              Subject
              <input
                value={contextSubject}
                onChange={(event) => setContextSubject(event.target.value)}
                list="known-subjects"
                placeholder="project:rack"
              />
            </label>
            <label>
              Purpose
              <input
                value={contextPurpose}
                onChange={(event) => setContextPurpose(event.target.value)}
                placeholder="prepare implementation"
              />
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={includeSensitive}
                onChange={(event) => setIncludeSensitive(event.target.checked)}
              />
              Include sensitive and restricted memory in this preview
            </label>
            <button
              className="secondary"
              type="button"
              disabled={busy || !contextSubject.trim() || !contextPurpose.trim()}
              onClick={() => void previewContext()}
            >
              Preview context
            </button>
            {contextPreview && (
              <div className="context-result">
                <strong>{contextPreview.selectedClaimIds.length} items selected</strong>
                <pre>{JSON.stringify(contextPreview.packet, null, 2)}</pre>
              </div>
            )}
          </div>
        </aside>

        <section className="memory-panel">
          <div className="memory-toolbar">
            <div>
              <p className="kicker">{filter === "candidate" ? "Review inbox" : "Memory"}</p>
              <h2>{filter === "candidate" ? "What is worth keeping?" : "Current context"}</h2>
            </div>
            <div className="filters">
              <input
                aria-label="Search memory"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search subject, key or value"
              />
              <select
                aria-label="Filter by status"
                value={filter}
                onChange={(event) => setFilter(event.target.value as "all" | ClaimStatus)}
              >
                <option value="all">All</option>
                <option value="confirmed">Confirmed</option>
                <option value="candidate">Candidates</option>
                <option value="rejected">Rejected</option>
                <option value="expired">Expired</option>
                <option value="superseded">Superseded</option>
              </select>
            </div>
          </div>

          {visibleCandidateIds.length > 0 && (
            <div className="batch-review-bar" aria-label="Bulk candidate review">
              <div>
                <strong>{selectedCandidateIds.length} selected</strong>
                <span>
                  Bulk confirmation is for straightforward candidates. Potential changes stay
                  individual so TOPO never supersedes existing memory by accident.
                </span>
              </div>
              <div className="batch-review-actions">
                <button
                  className="quiet"
                  type="button"
                  disabled={busy}
                  onClick={selectStraightforwardCandidates}
                >
                  Select straightforward
                </button>
                <button
                  className="quiet"
                  type="button"
                  disabled={busy || selectedCandidateIds.length === 0}
                  onClick={() => setSelectedCandidateIds([])}
                >
                  Clear
                </button>
                <button
                  className="secondary"
                  type="button"
                  disabled={busy || selectedCandidateIds.length === 0}
                  onClick={() => void reviewSelected("reject")}
                >
                  Reject selected
                </button>
                <button
                  className="primary compact"
                  type="button"
                  disabled={busy || selectedCandidateIds.length === 0}
                  onClick={() => void reviewSelected("confirm")}
                >
                  Confirm selected
                </button>
              </div>
            </div>
          )}

          <div className="claim-list">
            {claims.length === 0 ? (
              <div className="empty-state">
                <strong>No memory matches this view.</strong>
                <span>Add a claim or change the filters.</span>
              </div>
            ) : (
              displayedClaims.map((claim) => (
                <article className="claim-card" key={claim.id}>
                  <div className="claim-topline">
                    <div>
                      <span className={"status-pill " + claim.status}>{claim.status}</span>
                      <span className={"sensitivity " + claim.sensitivity}>{claim.sensitivity}</span>
                      {claim.supersedes.length > 0 && (
                        <span className="change-pill">potential change</span>
                      )}
                    </div>
                    <time dateTime={claim.updatedAt}>
                      {new Date(claim.updatedAt).toLocaleDateString()}
                    </time>
                  </div>
                  <p className="subject">{claim.subject}</p>
                  {claim.status === "candidate" && claim.provenance.sourceId && (
                    <div className="source-group-note" title={claim.provenance.sourceId}>
                      <span>Captured source</span>
                      <strong>
                        {sourceCandidateCounts.get(claim.provenance.sourceId) ?? 1} candidate
                        {(sourceCandidateCounts.get(claim.provenance.sourceId) ?? 1) === 1 ? "" : "s"}
                        {" "}from this interaction
                      </strong>
                    </div>
                  )}
                  <h3>{claim.key}</h3>
                  <pre className="claim-value">{displayValue(claim.value)}</pre>
                  {claim.provenance.evidence && (
                    <div className="claim-evidence">
                      <span>Evidence</span>
                      <p>“{claim.provenance.evidence}”</p>
                      <small>
                        {claim.provenance.provider
                          ? `${claim.provenance.provider} · `
                          : ""}
                        {new Date(claim.provenance.capturedAt).toLocaleString()}
                      </small>
                    </div>
                  )}
                  {claim.supersedes.length > 0 && (
                    <div className="change-note">
                      Confirming this will supersede {claim.supersedes.length} existing confirmed
                      memor{claim.supersedes.length === 1 ? "y" : "ies"}.
                    </div>
                  )}
                  <div className="claim-meta">
                    <span>{claim.epistemicType}</span>
                    <span>{Math.round(claim.confidence * 100)}% confidence</span>
                    <span>source: {claim.provenance.sourceType}</span>
                    {claim.provenance.provider && <span>{claim.provenance.provider}</span>}
                  </div>
                  {claim.tags.filter((tag) => !tag.startsWith("topo:")).length > 0 && (
                    <div className="tags">
                      {claim.tags
                        .filter((tag) => !tag.startsWith("topo:"))
                        .map((tag) => <span key={tag}>{tag}</span>)}
                    </div>
                  )}
                  {claim.status === "candidate" && (
                    <div className="candidate-actions">
                      <label className="candidate-select">
                        <input
                          type="checkbox"
                          checked={selectedCandidateIds.includes(claim.id)}
                          onChange={() => toggleCandidateSelection(claim.id)}
                        />
                        Select
                      </label>
                      <button className="secondary" disabled={busy} onClick={() => startEditing(claim)}>
                        Edit
                      </button>
                      <button className="secondary" disabled={busy} onClick={() => void review(claim.id, "reject")}>
                        Reject
                      </button>
                      <button className="primary compact" disabled={busy} onClick={() => void review(claim.id, "confirm")}>
                        Confirm
                      </button>
                    </div>
                  )}
                </article>
              ))
            )}
          </div>
        </section>
      </section>

      <footer>
        <span>Domain contract v{status?.contractVersion ?? "0.1"}</span>
        <span>Local-first. No account required.</span>
      </footer>
    </main>
  );
}
