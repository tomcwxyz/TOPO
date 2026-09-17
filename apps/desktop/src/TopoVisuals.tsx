import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";

type TerrainFieldProps = {
  total?: number;
  candidates?: number;
  captured?: number;
  className?: string;
};

type DesktopStatus = {
  total: number;
  candidates: number;
};

type CaptureInboxStatus = {
  pending: number;
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

function contourPath(level: number, rings: number, seed: number, activity: number) {
  const points = 32;
  const inset = level / Math.max(rings, 1);
  const radiusX = 52 - inset * 35;
  const radiusY = 38 - inset * 25;
  const centreX = 61 + Math.sin(seed * 0.013) * 5;
  const centreY = 44 + Math.cos(seed * 0.017) * 4;
  const wobble = 1.5 + Math.min(activity, 8) * 0.16;

  const coordinates = Array.from({ length: points }, (_, index) => {
    const angle = (Math.PI * 2 * index) / points;
    const variation =
      Math.sin(angle * 3 + seed * 0.021 + level * 0.7) * wobble +
      Math.cos(angle * 5 - seed * 0.011 + level) * 0.9;
    const x = centreX + Math.cos(angle) * (radiusX + variation);
    const y = centreY + Math.sin(angle) * (radiusY + variation * 0.62);
    return [x, y] as const;
  });

  return `${coordinates
    .map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(" ")} Z`;
}

export function TerrainField({
  total = 0,
  candidates = 0,
  captured = 0,
  className = "",
}: TerrainFieldProps) {
  const rings = clamp(4 + Math.floor(Math.log2(Math.max(1, total + 1))), 4, 9);
  const activity = clamp(candidates + captured, 0, 10);
  const seed = total * 17 + candidates * 31 + captured * 43 + 19;

  const paths = useMemo(
    () => Array.from({ length: rings }, (_, level) => contourPath(level, rings, seed, activity)),
    [activity, rings, seed],
  );

  const waypoints = useMemo(() => {
    const count = clamp(activity, 0, 5);
    return Array.from({ length: count }, (_, index) => {
      const angle = (Math.PI * 2 * (index + 1)) / (count + 1) + seed * 0.003;
      return {
        x: 61 + Math.cos(angle) * (18 + index * 3.2),
        y: 44 + Math.sin(angle) * (12 + index * 2.1),
      };
    });
  }, [activity, seed]);

  return (
    <svg
      className={`topo-terrain-field ${className}`.trim()}
      viewBox="0 0 122 90"
      role="presentation"
      aria-hidden="true"
      focusable="false"
    >
      <g className="topo-terrain-contours">
        {paths.map((path, index) => (
          <path key={index} d={path} data-level={index} />
        ))}
      </g>
      <g className="topo-terrain-waypoints">
        {waypoints.map((point, index) => (
          <circle key={index} cx={point.x} cy={point.y} r={index === 0 ? 1.45 : 1.05} />
        ))}
      </g>
    </svg>
  );
}

export function TopoMark({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`topo-mark ${className}`.trim()}
      viewBox="0 0 72 42"
      role="presentation"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M8 21c0-8.8 8.5-16 19-16s19 7.2 19 16-8.5 16-19 16S8 29.8 8 21Z" />
      <path d="M15 21c0-5.6 5.4-10.2 12-10.2S39 15.4 39 21s-5.4 10.2-12 10.2S15 26.6 15 21Z" />
      <path d="M21.5 21c0-2.7 2.5-4.9 5.5-4.9s5.5 2.2 5.5 4.9-2.5 4.9-5.5 4.9-5.5-2.2-5.5-4.9Z" />
      <path className="topo-mark-trace" d="M46 21h18" />
      <circle className="topo-mark-waypoint" cx="64" cy="21" r="2.25" />
    </svg>
  );
}

export function Waypoint({ className = "" }: { className?: string }) {
  return <span className={`topo-waypoint ${className}`.trim()} aria-hidden="true" />;
}

export function Trace({ className = "" }: { className?: string }) {
  return <span className={`topo-trace ${className}`.trim()} aria-hidden="true" />;
}

export function TopoTerrainBridge() {
  const [counts, setCounts] = useState({ total: 0, candidates: 0, captured: 0 });
  const [targets, setTargets] = useState<{
    topbar: Element | null;
    heading: Element | null;
    setup: Element | null;
    setupBrand: Element | null;
  }>({ topbar: null, heading: null, setup: null, setupBrand: null });

  const refreshCounts = useCallback(async () => {
    try {
      const [desktop, capture] = await Promise.all([
        invoke<DesktopStatus>("desktop_status"),
        invoke<CaptureInboxStatus>("capture_inbox_status"),
      ]);
      setCounts({
        total: desktop.total,
        candidates: desktop.candidates,
        captured: capture.pending,
      });
    } catch {
      // The brand layer must never block setup or the functional application.
    }
  }, []);

  useEffect(() => {
    const findTargets = () => {
      setTargets({
        topbar: document.querySelector(".topbar"),
        heading: document.querySelector(".topbar > div:first-child"),
        setup: document.querySelector(".setup-shell"),
        setupBrand: document.querySelector(".setup-brand"),
      });
    };

    findTargets();
    const observer = new MutationObserver(findTargets);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    void refreshCounts();
    const interval = window.setInterval(() => void refreshCounts(), 12_000);
    window.addEventListener("focus", refreshCounts);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshCounts);
    };
  }, [refreshCounts]);

  return (
    <>
      {targets.topbar &&
        createPortal(
          <div className="topo-terrain-slot topo-terrain-slot--masthead">
            <TerrainField {...counts} />
          </div>,
          targets.topbar,
        )}
      {targets.heading && createPortal(<TopoMark className="topo-mark--masthead" />, targets.heading)}
      {targets.setup &&
        createPortal(
          <div className="topo-terrain-slot topo-terrain-slot--setup">
            <TerrainField {...counts} />
          </div>,
          targets.setup,
        )}
      {targets.setupBrand && createPortal(<TopoMark className="topo-mark--setup" />, targets.setupBrand)}
    </>
  );
}
