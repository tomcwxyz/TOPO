import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { App } from "./App";
import { CaptureExtractionQueue } from "./CaptureExtractionQueue";
import {
  CalmMemorySurface,
  type CalmMemoryCounts,
  type CalmMemoryPage,
} from "./CalmMemorySurface";
import "./calm.css";

type Surface = "home" | "memories" | "connections" | "advanced";

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
  recommendedModel: string;
  error?: string;
};

type BrowserCaptureSetupStatus = {
  supported: boolean;
  prepared: boolean;
  extensionId: string;
  extensionDirectory?: string;
  hostPath?: string;
  bundledResourcesAvailable: boolean;
  message: string;
};

type LocalContextSharingStatus = {
  enabled: boolean;
  contributionsEnabled: boolean;
  captureEnabled: boolean;
  maxSensitivity: "personal";
  resetsOnRestart: boolean;
};

type CaptureProcessResult = {
  interactionId: string;
  extractor: string;
  duplicateSnapshot: boolean;
  proposalsExtracted: number;
  candidatesCreated: number;
  supportingEvidenceAdded: number;
  potentialChanges: number;
  duplicatePagesSuppressed?: number;
  status?: "processed" | "failed" | "skipped" | "cancelled";
  error?: string;
};

type ExtractionSummary = {
  attempted: number;
  processed: number;
  failed: number;
  skipped: number;
  cancelled: number;
  candidates: number;
};

const emptyCounts: CalmMemoryCounts = { total: 0, candidates: 0, confirmed: 0 };

function connectionLabel(browser: BrowserCaptureSetupStatus | null): string {
  if (!browser) return "Checking…";
  if (!browser.supported) return "Not available on this device";
  if (browser.prepared) return "Ready";
  return "Needs setup";
}

export function CalmApp() {
  const [surface, setSurface] = useState<Surface>("home");
  const [captureInbox, setCaptureInbox] = useState<CaptureInboxStatus | null>(null);
  const [ollama, setOllama] = useState<OllamaStatus | null>(null);
  const [browser, setBrowser] = useState<BrowserCaptureSetupStatus | null>(null);
  const [sharing, setSharing] = useState<LocalContextSharingStatus | null>(null);
  const [counts, setCounts] = useState<CalmMemoryCounts>(emptyCounts);
  const [memoryRefreshToken, setMemoryRefreshToken] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [extractionPaused, setExtractionPaused] = useState(false);
  const [activeInteractionId, setActiveInteractionId] = useState<string | null>(null);
  const [installingModel, setInstallingModel] = useState(false);
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [lastExtraction, setLastExtraction] = useState<ExtractionSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const attemptedIds = useRef(new Set<string>());
  const processingRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const surfaceRef = useRef<Surface>("home");

  const refreshOverview = useCallback(async () => {
    try {
      const [nextCapture, nextOllama, nextBrowser, nextSharing, pages] = await Promise.all([
        invoke<CaptureInboxStatus>("capture_inbox_status"),
        invoke<OllamaStatus>("ollama_extractor_status"),
        invoke<BrowserCaptureSetupStatus>("browser_capture_setup_status"),
        invoke<LocalContextSharingStatus>("local_context_sharing_status"),
        invoke<CalmMemoryPage[]>("list_memory_pages", { status: null, query: null }),
      ]);
      setCaptureInbox(nextCapture);
      setOllama(nextOllama);
      setBrowser(nextBrowser);
      setSharing(nextSharing);
      setCounts({
        total: pages.length,
        candidates: pages.filter((page) => page.status === "candidate").length,
        confirmed: pages.filter((page) => page.status === "confirmed").length,
      });
      setError(null);
    } catch (cause) {
      setError(String(cause));
    }
  }, []);

  useEffect(() => {
    void refreshOverview();
    const timer = window.setInterval(() => void refreshOverview(), 5000);
    return () => window.clearInterval(timer);
  }, [refreshOverview]);

  useEffect(() => {
    surfaceRef.current = surface;
    if (surface === "home" || !processingRef.current) return;

    stopRequestedRef.current = true;
    setExtractionPaused(true);
    if (activeInteractionId) {
      void invoke<boolean>("cancel_capture_extraction", { interactionId: activeInteractionId }).catch(() => undefined);
    }
  }, [surface]);

  const recommendedReady = Boolean(
    ollama?.available && ollama.models.includes(ollama.recommendedModel),
  );

  const runExtraction = useCallback(
    async (forceRetry = false) => {
      if (
        processingRef.current
        || extractionPaused
        || surface !== "home"
        || !captureInbox
        || !ollama
        || !recommendedReady
      ) return;

      const items = forceRetry
        ? captureInbox.items
        : captureInbox.items.filter((item) => !attemptedIds.current.has(item.id));
      if (items.length === 0) return;

      processingRef.current = true;
      stopRequestedRef.current = false;
      setProcessing(true);
      setStopping(false);
      setError(null);
      const summary: ExtractionSummary = {
        attempted: 0,
        processed: 0,
        failed: 0,
        skipped: 0,
        cancelled: 0,
        candidates: 0,
      };

      try {
        for (const item of items) {
          if (stopRequestedRef.current || surfaceRef.current !== "home") break;

          attemptedIds.current.add(item.id);
          summary.attempted += 1;
          setActiveInteractionId(item.id);

          const result = await invoke<CaptureProcessResult>("process_capture_with_ollama", {
            interactionId: item.id,
            model: ollama.recommendedModel,
          });

          summary.candidates += result.candidatesCreated ?? 0;
          if (result.status === "failed") summary.failed += 1;
          else if (result.status === "skipped") summary.skipped += 1;
          else if (result.status === "cancelled") {
            summary.cancelled += 1;
            setExtractionPaused(true);
            stopRequestedRef.current = true;
          } else summary.processed += 1;

          setActiveInteractionId(null);
          setLastExtraction({ ...summary });
          setMemoryRefreshToken((value) => value + 1);

          if (stopRequestedRef.current) break;
        }
      } catch (cause) {
        setError(String(cause));
      } finally {
        setActiveInteractionId(null);
        processingRef.current = false;
        setProcessing(false);
        setStopping(false);
        setLastExtraction({ ...summary });
        await refreshOverview();
        setMemoryRefreshToken((value) => value + 1);
      }
    },
    [captureInbox, extractionPaused, ollama, recommendedReady, refreshOverview, surface],
  );

  useEffect(() => {
    if (
      surface !== "home"
      || extractionPaused
      || !captureInbox
      || captureInbox.pending === 0
      || !recommendedReady
    ) return;
    const unseen = captureInbox.items.some((item) => !attemptedIds.current.has(item.id));
    if (unseen) void runExtraction(false);
  }, [captureInbox, extractionPaused, recommendedReady, runExtraction, surface]);

  const stopExtraction = async () => {
    stopRequestedRef.current = true;
    setExtractionPaused(true);
    if (!activeInteractionId || stopping) return;
    setStopping(true);
    try {
      await invoke<boolean>("cancel_capture_extraction", { interactionId: activeInteractionId });
    } catch (cause) {
      setError(`TOPO could not stop this extraction cleanly: ${String(cause)}`);
      setStopping(false);
    }
  };

  const resumeExtraction = () => {
    stopRequestedRef.current = false;
    setExtractionPaused(false);
    setError(null);
  };

  const installRecommendedModel = async () => {
    setInstallingModel(true);
    setError(null);
    try {
      const next = await invoke<OllamaStatus>("install_recommended_ollama_model");
      setOllama(next);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setInstallingModel(false);
    }
  };

  const prepareBrowser = async () => {
    setConnectionBusy(true);
    setError(null);
    try {
      const next = await invoke<BrowserCaptureSetupStatus>("prepare_browser_capture");
      setBrowser(next);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setConnectionBusy(false);
    }
  };

  const toggleSharing = async (kind: "share" | "capture" | "contributions") => {
    if (!sharing) return;
    setConnectionBusy(true);
    setError(null);
    try {
      let next: LocalContextSharingStatus;
      if (kind === "share") {
        next = await invoke("set_local_context_sharing", { enabled: !sharing.enabled });
      } else if (kind === "capture") {
        next = await invoke("set_local_capture", { enabled: !sharing.captureEnabled });
      } else {
        next = await invoke("set_local_contributions", { enabled: !sharing.contributionsEnabled });
      }
      setSharing(next);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setConnectionBusy(false);
    }
  };

  const memoryChanged = () => {
    setMemoryRefreshToken((value) => value + 1);
    void refreshOverview();
  };

  const homeStatus = useMemo(() => {
    if (processing && captureInbox) {
      const done = lastExtraction
        ? lastExtraction.processed + lastExtraction.failed + lastExtraction.skipped + lastExtraction.cancelled
        : 0;
      return `Learning from recent conversations… ${done} completed in this pass`;
    }
    if (extractionPaused && captureInbox?.pending) {
      return `Processing paused · ${captureInbox.pending} conversation${captureInbox.pending === 1 ? " is" : "s are"} still waiting`;
    }
    if (captureInbox && captureInbox.pending > 0 && !recommendedReady) {
      return `${captureInbox.pending} conversation${captureInbox.pending === 1 ? " is" : "s are"} waiting for local processing`;
    }
    if (lastExtraction?.failed) {
      return `${lastExtraction.failed} conversation${lastExtraction.failed === 1 ? " needs" : "s need"} another look`;
    }
    if (captureInbox?.pending) {
      return `${captureInbox.pending} conversation${captureInbox.pending === 1 ? " is" : "s are"} waiting`;
    }
    return "Quietly up to date";
  }, [captureInbox, extractionPaused, lastExtraction, processing, recommendedReady]);

  return (
    <main className="calm-shell">
      <header className="calm-header">
        <div className="calm-brand">
          <span>TOPO</span>
          <small>your context, kept close</small>
        </div>
        <nav className="calm-nav" aria-label="TOPO sections">
          {(["home", "memories", "connections", "advanced"] as Surface[]).map((item) => (
            <button
              key={item}
              type="button"
              className={surface === item ? "is-active" : ""}
              onClick={() => setSurface(item)}
            >
              {item[0].toUpperCase() + item.slice(1)}
              {item === "home" && counts.candidates > 0 && <span>{counts.candidates}</span>}
            </button>
          ))}
        </nav>
        <div className="calm-header-status">
          <strong>{counts.confirmed}</strong>
          <span>saved memories</span>
        </div>
      </header>

      {error && (
        <div className="calm-error calm-global-error" role="alert">
          <strong>TOPO hit a problem.</strong>
          <span>{error}</span>
        </div>
      )}

      {surface === "home" && (
        <section className="calm-page calm-home">
          <div className="calm-hero">
            <p className="calm-kicker">Today</p>
            <h1>{counts.candidates > 0 ? "A few things may be worth keeping." : "Nothing needs you right now."}</h1>
            <p>
              TOPO notices useful context while you work. You only need to step in when something is worth remembering.
            </p>
          </div>

          <div className="calm-processing-strip">
            <div className={processing ? "calm-pulse" : "calm-dot"} />
            <div>
              <strong>{homeStatus}</strong>
              <span>Capture and extraction stay on this device.</span>
            </div>
            {!recommendedReady && ollama?.available && (
              <button
                className="calm-button calm-button-secondary"
                type="button"
                disabled={installingModel}
                onClick={() => void installRecommendedModel()}
              >
                {installingModel ? "Installing…" : `Set up ${ollama.recommendedModel}`}
              </button>
            )}
            {processing ? (
              <button
                className="calm-button calm-button-quiet"
                type="button"
                disabled={stopping}
                onClick={() => void stopExtraction()}
              >
                {stopping ? "Stopping…" : "Stop extraction"}
              </button>
            ) : extractionPaused && captureInbox?.pending ? (
              <button
                className="calm-button calm-button-secondary"
                type="button"
                disabled={!recommendedReady}
                onClick={resumeExtraction}
              >
                Resume processing
              </button>
            ) : lastExtraction?.failed ? (
              <button
                className="calm-button calm-button-quiet"
                type="button"
                disabled={!recommendedReady}
                onClick={() => {
                  attemptedIds.current.clear();
                  void runExtraction(true);
                }}
              >
                Retry failed conversations
              </button>
            ) : null}
          </div>

          <div className="calm-section-heading">
            <div>
              <p className="calm-kicker">Worth remembering?</p>
              <h2>{counts.candidates > 0 ? `${counts.candidates} suggestion${counts.candidates === 1 ? "" : "s"}` : "You’re all caught up"}</h2>
            </div>
            {counts.confirmed > 0 && (
              <button className="calm-text-link" type="button" onClick={() => setSurface("memories")}>
                See what TOPO remembers →
              </button>
            )}
          </div>

          <CalmMemorySurface
            mode="review"
            refreshToken={memoryRefreshToken}
            onChanged={memoryChanged}
            onCounts={setCounts}
          />
        </section>
      )}

      {surface === "memories" && (
        <section className="calm-page">
          <div className="calm-hero calm-hero-small">
            <p className="calm-kicker">Memories</p>
            <h1>What TOPO remembers.</h1>
            <p>
              These are the memories you chose to keep. Search them like notes; open the details only when you want the evidence or history.
            </p>
          </div>
          <CalmMemorySurface
            mode="library"
            refreshToken={memoryRefreshToken}
            onChanged={memoryChanged}
            onCounts={setCounts}
          />
        </section>
      )}

      {surface === "connections" && (
        <section className="calm-page">
          <div className="calm-hero calm-hero-small">
            <p className="calm-kicker">Connections</p>
            <h1>Where TOPO learns from and helps.</h1>
            <p>
              Capture, context sharing and contribution authority stay separate. Nothing here changes without you choosing it.
            </p>
          </div>

          <div className="calm-connections-grid">
            <article className="calm-connection-card">
              <div className="calm-connection-top">
                <div>
                  <span className="calm-connection-icon">↙</span>
                  <div>
                    <h2>Browser conversations</h2>
                    <p>ChatGPT, Claude and Gemini capture</p>
                  </div>
                </div>
                <strong>{connectionLabel(browser)}</strong>
              </div>
              <p>
                New conversations can be captured into TOPO’s local inbox even when the desktop app is closed.
              </p>
              {browser?.supported && !browser.prepared && (
                <button
                  className="calm-button calm-button-secondary"
                  type="button"
                  disabled={connectionBusy}
                  onClick={() => void prepareBrowser()}
                >
                  Set up browser capture
                </button>
              )}
              {browser?.prepared && browser.extensionDirectory && (
                <details className="calm-why">
                  <summary>Browser setup details</summary>
                  <div className="calm-why-body">
                    <p>{browser.message}</p>
                    <code>{browser.extensionDirectory}</code>
                    <button className="calm-button calm-button-quiet" type="button" onClick={() => void invoke("open_capture_extension_folder")}>
                      Open extension folder
                    </button>
                  </div>
                </details>
              )}
            </article>

            <article className="calm-connection-card">
              <div className="calm-connection-top">
                <div>
                  <span className="calm-connection-icon">→</span>
                  <div>
                    <h2>Use approved memory</h2>
                    <p>RACK and compatible local tools</p>
                  </div>
                </div>
                <strong>{sharing?.enabled ? "Allowed this session" : "Off"}</strong>
              </div>
              <p>
                Lets compatible local tools request purpose-bound context from memories you have already kept.
              </p>
              <button
                className={sharing?.enabled ? "calm-button calm-button-quiet" : "calm-button calm-button-primary"}
                type="button"
                disabled={connectionBusy || sharing === null}
                onClick={() => void toggleSharing("share")}
              >
                {sharing?.enabled ? "Stop sharing" : "Allow context"}
              </button>
            </article>

            <article className="calm-connection-card calm-connection-secondary">
              <div className="calm-connection-top">
                <div>
                  <span className="calm-connection-icon">↙</span>
                  <div>
                    <h2>Local agent capture</h2>
                    <p>Raw interaction capture from compatible tools</p>
                  </div>
                </div>
                <strong>{sharing?.captureEnabled ? "Allowed" : "Off"}</strong>
              </div>
              <button
                className="calm-button calm-button-quiet"
                type="button"
                disabled={connectionBusy || sharing === null}
                onClick={() => void toggleSharing("capture")}
              >
                {sharing?.captureEnabled ? "Stop capture" : "Allow capture"}
              </button>
            </article>

            <article className="calm-connection-card calm-connection-secondary">
              <div className="calm-connection-top">
                <div>
                  <span className="calm-connection-icon">＋</span>
                  <div>
                    <h2>Memory suggestions</h2>
                    <p>Reviewable contributions from compatible local tools</p>
                  </div>
                </div>
                <strong>{sharing?.contributionsEnabled ? "Allowed" : "Off"}</strong>
              </div>
              <button
                className="calm-button calm-button-quiet"
                type="button"
                disabled={connectionBusy || sharing === null}
                onClick={() => void toggleSharing("contributions")}
              >
                {sharing?.contributionsEnabled ? "Stop suggestions" : "Allow suggestions"}
              </button>
            </article>
          </div>

          <p className="calm-footnote">
            Session permissions reset when TOPO restarts. Sharing memory never grants another tool permission to change it.
          </p>
        </section>
      )}

      {surface === "advanced" && (
        <section className="calm-page calm-advanced">
          <div className="calm-hero calm-hero-small">
            <p className="calm-kicker">Advanced</p>
            <h1>The machinery, when you need it.</h1>
            <p>
              Extraction queues, model choice, retrieval evaluation, Structured Claims and raw diagnostic surfaces remain here for alpha dogfooding.
            </p>
          </div>
          <div className="calm-advanced-note">
            <strong>Developer workbench</strong>
            <span>Extraction here is explicit: select one conversation at a time, and stop it at any point.</span>
          </div>
          <div className="calm-workbench">
            <App />
            <CaptureExtractionQueue />
          </div>
        </section>
      )}
      <footer className="calm-footer">
        <span>Portable, user-owned context.</span>
      </footer>
    </main>
  );
}
