import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import "./capture-extraction-queue.css";

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
  recommendedModel?: string;
  error?: string;
};

type ProcessStatus = "processed" | "failed" | "skipped" | "cancelled";

type CaptureProcessResult = {
  interactionId: string;
  extractor: string;
  duplicateSnapshot: boolean;
  proposalsExtracted: number;
  candidatesCreated: number;
  supportingEvidenceAdded: number;
  potentialChanges: number;
  duplicatePagesSuppressed: number;
  representation: "memory-page";
  status: ProcessStatus;
  sourceId?: string;
  error?: string;
};

type QueueState = "queued" | "processing" | ProcessStatus;

type QueueRow = CaptureInboxItem & {
  state: QueueState;
  result?: CaptureProcessResult;
  error?: string;
};

const MODEL_STORAGE_KEY = "topo.ollamaModel";
const POLL_INTERVAL_MS = 5_000;

function cleanError(error: unknown): string {
  const text = String(error).replace(/^Error:\s*/i, "").trim();
  if (text.length <= 260) return text;
  return `${text.slice(0, 257)}…`;
}

function stateLabel(state: QueueState): string {
  switch (state) {
    case "queued": return "Waiting";
    case "processing": return "Extracting";
    case "processed": return "Processed";
    case "failed": return "Needs retry";
    case "skipped": return "Skipped";
    case "cancelled": return "Stopped";
  }
}

function resultSummary(row: QueueRow): string | null {
  const result = row.result;
  if (!result) return row.error ?? null;
  if (result.status === "cancelled") return result.error ?? "Stopped — still waiting locally and safe to retry.";
  if (result.status === "failed") return result.error ?? "The local extractor could not use this interaction.";
  if (result.status === "skipped") return result.error ?? "This interaction was no longer waiting in the inbox.";
  if (result.duplicateSnapshot) return "Already processed — no duplicate Memory Pages were created.";

  const parts = [`${result.candidatesCreated} page${result.candidatesCreated === 1 ? "" : "s"}`];
  if (result.supportingEvidenceAdded > 0) {
    parts.push(`${result.supportingEvidenceAdded} evidence update${result.supportingEvidenceAdded === 1 ? "" : "s"}`);
  }
  if (result.potentialChanges > 0) {
    parts.push(`${result.potentialChanges} potential change${result.potentialChanges === 1 ? "" : "s"}`);
  }
  if (result.duplicatePagesSuppressed > 0) {
    parts.push(`${result.duplicatePagesSuppressed} duplicate${result.duplicatePagesSuppressed === 1 ? "" : "s"} suppressed`);
  }
  return parts.join(" · ");
}

function mergeInboxRows(current: QueueRow[], items: CaptureInboxItem[]): QueueRow[] {
  const existing = new Map(current.map((row) => [row.id, row]));
  const incomingIds = new Set(items.map((item) => item.id));
  const merged = current.map((row) => {
    const incoming = items.find((item) => item.id === row.id);
    return incoming ? { ...row, ...incoming } : row;
  });

  for (const item of items) {
    if (!existing.has(item.id)) merged.push({ ...item, state: "queued" });
  }

  return merged.filter((row) => row.state !== "queued" || incomingIds.has(row.id));
}

function appRefreshButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(
    ".capture-inbox-control.capture-queue-enhanced > .capture-inbox-heading button.quiet",
  );
}

function selectableState(state: QueueState): boolean {
  return state === "queued" || state === "failed" || state === "cancelled";
}

export function CaptureExtractionQueue() {
  const [target, setTarget] = useState<Element | null>(null);
  const [inbox, setInbox] = useState<CaptureInboxStatus | null>(null);
  const [ollama, setOllama] = useState<OllamaStatus | null>(null);
  const [model, setModel] = useState(() => window.localStorage.getItem(MODEL_STORAGE_KEY) ?? "");
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeInteractionId, setActiveInteractionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [fatalError, setFatalError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let frame = 0;
    const attach = () => {
      if (cancelled) return;
      const nextTarget = document.querySelector(".capture-inbox-control");
      if (nextTarget) {
        nextTarget.classList.add("capture-queue-enhanced");
        setTarget(nextTarget);
        return;
      }
      frame = window.requestAnimationFrame(attach);
    };
    attach();
    return () => {
      cancelled = true;
      if (frame) window.cancelAnimationFrame(frame);
      document.querySelector(".capture-inbox-control.capture-queue-enhanced")?.classList.remove("capture-queue-enhanced");
    };
  }, []);

  const refreshInbox = useCallback(async () => {
    const next = await invoke<CaptureInboxStatus>("capture_inbox_status");
    setInbox(next);
    setRows((current) => mergeInboxRows(current, next.items));
    return next;
  }, []);

  const refreshOllama = useCallback(async () => {
    const next = await invoke<OllamaStatus>("ollama_extractor_status");
    setOllama(next);
    if (next.available && next.models.length > 0) {
      setModel((current) => {
        const recommended = next.recommendedModel && next.models.includes(next.recommendedModel)
          ? next.recommendedModel
          : null;
        const selected = current && next.models.includes(current) ? current : recommended ?? next.models[0];
        if (selected) window.localStorage.setItem(MODEL_STORAGE_KEY, selected);
        return selected ?? "";
      });
    }
    return next;
  }, []);

  useEffect(() => {
    void Promise.all([refreshInbox(), refreshOllama()]).catch((cause) => setFatalError(cleanError(cause)));
  }, [refreshInbox, refreshOllama]);

  useEffect(() => {
    if (busy) return;
    const timer = window.setInterval(() => void refreshInbox().catch(() => undefined), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [busy, refreshInbox]);

  useEffect(() => {
    if (busy) return;
    if (selectedId && rows.some((row) => row.id === selectedId && selectableState(row.state))) return;
    const next = rows.find((row) => selectableState(row.state));
    setSelectedId(next?.id ?? null);
  }, [busy, rows, selectedId]);

  const counts = useMemo(() => rows.reduce(
    (summary, row) => ({ ...summary, [row.state]: summary[row.state] + 1 }),
    { queued: 0, processing: 0, processed: 0, failed: 0, skipped: 0, cancelled: 0 } as Record<QueueState, number>,
  ), [rows]);

  const createdPages = useMemo(
    () => rows.reduce((sum, row) => sum + (row.result?.candidatesCreated ?? 0), 0),
    [rows],
  );

  const selected = rows.find((row) => row.id === selectedId) ?? null;
  const selectableCount = counts.queued + counts.failed + counts.cancelled;

  const selectModel = (next: string) => {
    setModel(next);
    if (next) window.localStorage.setItem(MODEL_STORAGE_KEY, next);
    else window.localStorage.removeItem(MODEL_STORAGE_KEY);
  };

  const processSelected = async () => {
    if (!selected || !selectableState(selected.state)) return;
    const currentModel = model.trim();
    if (!currentModel) {
      setFatalError("Choose a local Ollama model before extracting this conversation.");
      return;
    }

    const interactionId = selected.id;
    setBusy(true);
    setStopping(false);
    setActiveInteractionId(interactionId);
    setFatalError(null);
    setRows((current) => current.map((row) =>
      row.id === interactionId
        ? { ...row, state: "processing", result: undefined, error: undefined }
        : row,
    ));

    try {
      const result = await invoke<CaptureProcessResult>("process_capture_with_ollama", {
        interactionId,
        model: currentModel,
      });
      setRows((current) => current.map((row) =>
        row.id === interactionId
          ? { ...row, state: result.status, result, error: result.error }
          : row,
      ));
    } catch (cause) {
      const error = cleanError(cause);
      setRows((current) => current.map((row) =>
        row.id === interactionId ? { ...row, state: "failed", error } : row,
      ));
      setFatalError(`TOPO hit a storage or persistence error: ${error}`);
    } finally {
      setBusy(false);
      setStopping(false);
      setActiveInteractionId(null);
      setSelectedId(null);
      try {
        await refreshInbox();
      } catch {
        // Keep the row result visible even if the final inbox refresh fails.
      }
      appRefreshButton()?.click();
    }
  };

  const stopExtraction = async () => {
    if (!activeInteractionId || stopping) return;
    setStopping(true);
    try {
      await invoke<boolean>("cancel_capture_extraction", { interactionId: activeInteractionId });
    } catch (cause) {
      setFatalError(`TOPO could not stop this extraction cleanly: ${cleanError(cause)}`);
      setStopping(false);
    }
  };

  const clearFinished = () => {
    setRows((current) => current.filter((row) => !["processed", "skipped"].includes(row.state)));
  };

  if (!target) return null;

  const queue = (
    <div className="capture-queue" aria-label="Local Memory Page extraction queue">
      <div className="capture-queue-header">
        <div>
          <strong>Local Memory Page extractor</strong>
          <span>
            {ollama === null
              ? "Checking Ollama…"
              : ollama.available
                ? "Choose one conversation, then extract it locally"
                : "Ollama not available"}
          </span>
        </div>
        <span className="capture-queue-count">
          {busy ? "1 extracting" : `${selectableCount} available`}
        </span>
      </div>

      {ollama?.available && ollama.models.length > 0 ? (
        <div className="capture-queue-controls">
          <select
            aria-label="Ollama extraction model"
            value={model}
            disabled={busy}
            onChange={(event) => selectModel(event.target.value)}
          >
            {ollama.models.map((availableModel) => (
              <option key={availableModel} value={availableModel}>
                {availableModel}{availableModel === ollama.recommendedModel ? " · recommended" : ""}
              </option>
            ))}
          </select>
          {busy ? (
            <button className="secondary capture-queue-stop" type="button" disabled={stopping} onClick={() => void stopExtraction()}>
              {stopping ? "Stopping…" : "Stop extraction"}
            </button>
          ) : (
            <button
              className="secondary"
              type="button"
              disabled={!selected || !model}
              onClick={() => void processSelected()}
            >
              {selected?.state === "failed" || selected?.state === "cancelled" ? "Retry selected" : "Extract selected"}
            </button>
          )}
        </div>
      ) : (
        <div className="capture-queue-unavailable">
          {ollama?.error ?? "Install or start Ollama to extract captures locally."}
        </div>
      )}

      {rows.length > 0 ? (
        <div className="capture-queue-list" aria-live="polite">
          {rows.map((row) => {
            const summary = resultSummary(row);
            const canSelect = selectableState(row.state) && !busy;
            return (
              <label
                className={`capture-queue-row is-${row.state}${selectedId === row.id ? " is-selected" : ""}${canSelect ? " is-selectable" : ""}`}
                key={row.id}
              >
                <input
                  className="capture-queue-radio"
                  type="radio"
                  name="capture-to-extract"
                  checked={selectedId === row.id}
                  disabled={!canSelect}
                  onChange={() => setSelectedId(row.id)}
                  aria-label={`Select ${row.title ?? "untitled interaction"}`}
                />
                <span className="capture-queue-marker" aria-hidden="true">
                  {row.state === "processed" ? "✓" : row.state === "failed" ? "!" : row.state === "skipped" ? "–" : row.state === "processing" ? "•" : row.state === "cancelled" ? "■" : "○"}
                </span>
                <div className="capture-queue-row-copy">
                  <span className="capture-queue-meta">{row.product} · {row.client} · {row.turnCount} turns</span>
                  <strong>{row.title ?? "Untitled interaction"}</strong>
                  {summary && <small title={summary}>{summary}</small>}
                </div>
                <span className="capture-queue-state">{stateLabel(row.state)}</span>
              </label>
            );
          })}
        </div>
      ) : (
        <div className="capture-queue-empty">Nothing is waiting for extraction.</div>
      )}

      {(counts.processed > 0 || counts.failed > 0 || counts.cancelled > 0 || counts.skipped > 0) && (
        <div className="capture-queue-summary">
          <div>
            <strong>
              {counts.processed} processed · {counts.failed} failed · {counts.cancelled} stopped
            </strong>
            <span>
              {createdPages > 0
                ? `${createdPages} new Memory Page candidate${createdPages === 1 ? "" : "s"} created.`
                : "Stopped and failed conversations remain in the local inbox to retry."}
            </span>
          </div>
          <div className="capture-queue-summary-actions">
            {createdPages > 0 && !busy && (
              <button className="quiet" type="button" onClick={() => window.location.reload()}>
                Refresh review inbox
              </button>
            )}
            {(counts.processed > 0 || counts.skipped > 0) && !busy && (
              <button className="quiet" type="button" onClick={clearFinished}>
                Clear finished
              </button>
            )}
          </div>
        </div>
      )}

      {fatalError && <div className="capture-queue-error" role="alert">{fatalError}</div>}

      <small className="capture-queue-note">
        One conversation is extracted at a time. Stop cancels the active Ollama request; the capture stays local and can be selected again later.
      </small>
    </div>
  );

  return createPortal(queue, target);
}
