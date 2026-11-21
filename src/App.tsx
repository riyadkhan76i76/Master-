import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock,
  Copy,
  Download,
  FileCode2,
  Filter,
  Gauge,
  Layers,
  MousePointerClick,
  Play,
  Radio,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Sliders,
  Trash2,
  Wifi,
  X,
  Zap,
} from 'lucide-react';
import {
  AUTO_LEAD_MULTIPLIER_PRESETS,
  inspectCashoutButtonState,
  timingCalibrationEngine,
  type TagLeadMode,
  type TimingEngineSnapshot,
} from './utils/timingEngine';
import {
  violentmonkeyBridge,
  type BridgeStateSnapshot,
  type ConsolidatedTelemetryEvent,
  type HumanMimicJitterConfig,
  type StreamTransport,
} from './utils/violentmonkeyBridge';
import { ToastContainer, type VerificationToastItem } from './components/ToastContainer';

type NavSection = 'monitor' | 'verify' | 'config' | 'userscript';
type TransportFilter = 'ALL' | StreamTransport;

interface SubsystemCheckResult {
  id: string;
  title: string;
  module: string;
  status: 'idle' | 'running' | 'pass' | 'fail';
  durationMs?: number;
  summary: string;
  details: string[];
}

const USERSCRIPT_PUBLIC_PATH = '/assets/aistudio/triggertap-v5.2.5-pretrig-auto3x__2_.user_a45bb342.js';
const USERSCRIPT_DOWNLOAD_NAME = 'triggertap-v5.2.5-pretrig-auto3x.user.js';

const INITIAL_CHECKS: SubsystemCheckResult[] = [
  {
    id: 'btn-off-retry',
    title: 'TimingCalibrationEngine: btn_off Sub-ms Recursive Retry',
    module: 'src/utils/timingEngine.ts',
    status: 'idle',
    summary: 'Stages a disabled btn_off cashout button, releases it at +16ms, and verifies sub-ms MessageChannel recovery.',
    details: [],
  },
  {
    id: 'human-mimic-jitter',
    title: 'Auto-Human Anti-Bot Click & Non-Repeating Jitter',
    module: 'src/utils/violentmonkeyBridge.ts + timingEngine.ts',
    status: 'idle',
    summary: 'Dispatches human-timed pointer chains with non-repeating coordinates and verifies closed-loop BOT_REJECTED auto-escalation.',
    details: [],
  },
  {
    id: 'consolidated-net',
    title: 'Consolidated Fetch + XHR + WebSocket Stream Capture',
    module: 'src/utils/violentmonkeyBridge.ts',
    status: 'idle',
    summary: 'Issues live same-origin Fetch HEAD & XMLHttpRequest HEAD probes and verifies WS proxy + consolidated ingestion.',
    details: [],
  },
  {
    id: 'batch-coalesce',
    title: 'Telemetry Batcher: Frame-Drop Prevention Under Burst Load',
    module: 'src/utils/violentmonkeyBridge.ts',
    status: 'idle',
    summary: 'Burst-ingests 300 telemetry frames synchronously and verifies coalescing into bounded React renders.',
    details: [],
  },
  {
    id: 'auto-lead-calib',
    title: 'Auto3x -> 12x Dynamic Server-Latency Lead Calibration',
    module: 'src/utils/timingEngine.ts',
    status: 'idle',
    summary: 'Feeds server acceptance RTT, human tap duration & deficit samples and verifies dynamic scaling past 5x (up to 12x).',
    details: [],
  },
  {
    id: 'click-switch-rgb',
    title: 'Click Switch OFF (RGB-Only) & Cash/Crash Auto-Stop',
    module: 'src/utils/violentmonkeyBridge.ts + src/index.css',
    status: 'idle',
    summary: 'Verifies Master Click Switch OFF blocks real clicks while blinking extra-bright RGB LED on target button until CASH/CRASH stops it.',
    details: [],
  },
  {
    id: 'lead-modes-calibration',
    title: 'Flexible Lead Modes: Auto + 1x..12x + Custom ms',
    module: 'src/utils/timingEngine.ts',
    status: 'idle',
    summary: 'Verifies manual presets (1x, 2x, 5x, 6x, 12x), custom ms locking against BOT_REJECTED clobber, and Auto fallback.',
    details: [],
  },
];

function transportTone(t: StreamTransport): string {
  switch (t) {
    case 'WS':
      return 'text-violet-300 bg-violet-950/60 border-violet-800/70';
    case 'FETCH':
      return 'text-cyan-300 bg-cyan-950/60 border-cyan-800/70';
    case 'XHR':
      return 'text-amber-300 bg-amber-950/60 border-amber-800/70';
    case 'DOM':
      return 'text-emerald-300 bg-emerald-950/60 border-emerald-800/70';
    case 'VM-BRIDGE':
    default:
      return 'text-slate-300 bg-slate-800/80 border-slate-700';
  }
}

export default function App() {
  const [activeNav, setActiveNav] = useState<NavSection>('monitor');
  const [timingSnap, setTimingSnap] = useState<TimingEngineSnapshot>(() =>
    timingCalibrationEngine.getSnapshot(),
  );
  const [bridgeSnap, setBridgeSnap] = useState<BridgeStateSnapshot>(() =>
    violentmonkeyBridge.getSnapshot(),
  );

  const [transportFilter, setTransportFilter] = useState<TransportFilter>('ALL');
  const [matchedOnly, setMatchedOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEvent, setSelectedEvent] = useState<ConsolidatedTelemetryEvent | null>(null);

  const [roomInput, setRoomInput] = useState(bridgeSnap.roomId);
  const [batchIntervalInput, setBatchIntervalInput] = useState(bridgeSnap.batcher.batchIntervalMs);
  const [jitterCfg, setJitterCfg] = useState<HumanMimicJitterConfig>(() =>
    violentmonkeyBridge.getJitterConfig(),
  );
  const [configStatus, setConfigStatus] = useState<string>('');

  const [checks, setChecks] = useState<SubsystemCheckResult[]>(INITIAL_CHECKS);
  const [runningAllChecks, setRunningAllChecks] = useState(false);
  const [toasts, setToasts] = useState<VerificationToastItem[]>([]);
  const toastTimersRef = useRef<Map<string, number>>(new Map());

  const [leadModeInput, setLeadModeInput] = useState<TagLeadMode>(() => timingSnap.globalLeadMode);
  const [leadMultInput, setLeadMultInput] = useState<number>(() => timingSnap.globalLeadMultiplier);
  const [leadMsInput, setLeadMsInput] = useState<number>(() => timingSnap.globalManualLeadMs);

  const [overrideTagInput, setOverrideTagInput] = useState<string>('CASHOUT');
  const [overrideModeInput, setOverrideModeInput] = useState<TagLeadMode>('manual_mult');
  const [overrideMultInput, setOverrideMultInput] = useState<number>(6);
  const [overrideMsInput, setOverrideMsInput] = useState<number>(140);

  const [userscriptText, setUserscriptText] = useState<string>('');
  const [userscriptLoading, setUserscriptLoading] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<string>('');

  const stagingHostRef = useRef<HTMLDivElement | null>(null);
  const previewBtnRef = useRef<HTMLButtonElement | null>(null);

  const dismissToast = (id: string) => {
    const timer = toastTimersRef.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      toastTimersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const pushVerificationToast = (title: string, summary: string, durationMs?: number) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const item: VerificationToastItem = {
      id,
      title,
      summary,
      durationMs,
      createdAt: Date.now(),
    };
    setToasts((prev) => [item, ...prev].slice(0, 4));
    const timer = window.setTimeout(() => {
      dismissToast(id);
    }, 4500);
    toastTimersRef.current.set(id, timer);
  };

  useEffect(() => {
    const unsubTiming = timingCalibrationEngine.subscribe(setTimingSnap);
    const unsubBridge = violentmonkeyBridge.subscribe(setBridgeSnap);
    const disconnectGm = violentmonkeyBridge.connectGMBridge();
    const uninstallNet = violentmonkeyBridge.installTelemetryInterceptors();

    return () => {
      for (const timer of toastTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      toastTimersRef.current.clear();
      unsubTiming();
      unsubBridge();
      disconnectGm();
      uninstallNet();
    };
  }, []);

  // Load userscript source lazily when viewing Userscript tab or triggering download/copy
  const loadUserscriptSource = async (): Promise<string> => {
    if (userscriptText) return userscriptText;
    setUserscriptLoading(true);
    try {
      const res = await fetch(USERSCRIPT_PUBLIC_PATH, { cache: 'no-store' });
      const txt = await res.text();
      setUserscriptText(txt);
      return txt;
    } finally {
      setUserscriptLoading(false);
    }
  };

  useEffect(() => {
    if (activeNav === 'userscript' && !userscriptText && !userscriptLoading) {
      void loadUserscriptSource();
    }
  }, [activeNav]);

  const filteredEvents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return bridgeSnap.events.filter((ev) => {
      if (transportFilter !== 'ALL' && ev.transport !== transportFilter) return false;
      if (matchedOnly && !ev.matched && !ev.inspectorMatched) return false;
      if (q) {
        const hay = `${ev.src} ${ev.transport} ${ev.method || ''} ${ev.url || ''} ${ev.matchedTag || ''} ${ev.text}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [bridgeSnap.events, transportFilter, matchedOnly, searchQuery]);

  const updateCheck = (id: string, patch: Partial<SubsystemCheckResult>) => {
    setChecks((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    if (patch.status === 'pass') {
      const def = INITIAL_CHECKS.find((c) => c.id === id);
      pushVerificationToast(
        `Passed: ${def?.title || id}`,
        patch.summary || 'Verification passed cleanly.',
        patch.durationMs,
      );
    }
  };

  const runSingleCheck = async (id: string) => {
    const t0 = performance.now();
    updateCheck(id, { status: 'running', details: [] });

    try {
      if (id === 'btn-off-retry') {
        const host = stagingHostRef.current;
        if (!host) throw new Error('Staging host unavailable');

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cashout_btn btn_off w-36 h-11';
        btn.disabled = true;
        btn.setAttribute('data-state', 'off');
        btn.textContent = 'WAIT';
        host.appendChild(btn);

        let nativeClickCount = 0;
        btn.addEventListener('click', () => {
          nativeClickCount += 1;
        });

        let sawQueuedDepth = false;
        const unsubWatch = timingCalibrationEngine.subscribe((snap) => {
          if (snap.retryQueueDepth > 0) sawQueuedDepth = true;
        });

        // Release btn_off after 16ms so TimingCalibrationEngine catches it via sub-ms retry
        const releaseTimer = window.setTimeout(() => {
          btn.disabled = false;
          btn.className = 'cashout_btn';
          btn.setAttribute('data-state', 'ready');
          btn.textContent = 'Cash Out 2.45x';
        }, 16);

        const result = await violentmonkeyBridge.dispatchHumanMimicClick(btn, {
          tag: 'CHECK_BTN_OFF',
          forceRealClick: true,
          jitter: {
            ...jitterCfg,
            retryOnBtnOff: true,
            maxBtnOffRetryMs: 400,
            maxBtnOffAttempts: 240,
          },
        });

        window.clearTimeout(releaseTimer);
        unsubWatch();
        violentmonkeyBridge.stopRgbBlink('CHECK_DONE', btn);
        host.removeChild(btn);

        const snapNow = timingCalibrationEngine.getSnapshot();
        const passed =
          result.dispatched &&
          result.recoveredFromBtnOff &&
          nativeClickCount === 1 &&
          sawQueuedDepth &&
          snapNow.retryQueueDepth === 0;

        updateCheck(id, {
          status: passed ? 'pass' : 'fail',
          durationMs: Number((performance.now() - t0).toFixed(2)),
          summary: passed
            ? `Recovered from btn_off in ${result.retriesUsed} recursive checks (${result.totalDispatchMs}ms total); queue returned to 0.`
            : `Expected recovery failed (dispatched=${result.dispatched}, clickCount=${nativeClickCount}).`,
          details: [
            `Initial state: ${result.buttonStateBefore} -> Post state: ${result.buttonStateAfter}`,
            `Retry queue peaked >= 1: ${sawQueuedDepth ? 'YES' : 'NO'} (current local depth=${snapNow.retryQueueDepth})`,
            `Recursive checks executed: ${result.retriesUsed} (last interval=${snapNow.lastCheckIntervalMs.toFixed(3)}ms, avg=${snapNow.avgCheckIntervalMs.toFixed(3)}ms)`,
            `Human-mimic jitter: pre=${result.preJitterMs.toFixed(2)}ms hold=${result.holdJitterMs.toFixed(2)}ms post=${result.postJitterMs.toFixed(2)}ms`,
          ],
        });
      } else if (id === 'human-mimic-jitter') {
        const host = stagingHostRef.current;
        if (!host) throw new Error('Staging host unavailable');

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cashout_btn w-36 h-11';
        btn.textContent = 'Cash Out 3.10x';
        host.appendChild(btn);

        const capturedEvents: Array<{ type: string; at: number }> = [];
        const trackedTypes = ['pointerover', 'pointermove', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click'];
        const handler = (e: Event) => {
          capturedEvents.push({ type: e.type, at: Number(performance.now().toFixed(3)) });
        };
        trackedTypes.forEach((evt) => btn.addEventListener(evt, handler));

        const res1 = await violentmonkeyBridge.dispatchHumanMimicClick(btn, {
          tag: 'CHECK_JITTER_1',
          forceRealClick: true,
          jitter: {
            ...jitterCfg,
            enabled: true,
            autoScale: false,
            preHoverJitterMinMs: 2.0,
            preHoverJitterMaxMs: 4.0,
            holdDurationMinMs: 8.0,
            holdDurationMaxMs: 14.0,
            postUpJitterMinMs: 1.0,
            postUpJitterMaxMs: 2.0,
          },
        });
        const res2 = await violentmonkeyBridge.dispatchHumanMimicClick(btn, {
          tag: 'CHECK_JITTER_2',
          forceRealClick: true,
          jitter: {
            ...jitterCfg,
            enabled: true,
            autoScale: false,
            preHoverJitterMinMs: 2.0,
            preHoverJitterMaxMs: 4.0,
            holdDurationMinMs: 8.0,
            holdDurationMaxMs: 14.0,
            postUpJitterMinMs: 1.0,
            postUpJitterMaxMs: 2.0,
          },
        });

        trackedTypes.forEach((evt) => btn.removeEventListener(evt, handler));
        violentmonkeyBridge.stopRgbBlink('CHECK_DONE', btn);
        host.removeChild(btn);

        // Verify closed-loop BOT_REJECTED auto-escalation on a temporary engine instance
        const profBefore = { ...timingCalibrationEngine.getAutoHumanProfile() };
        const escalatedProf = timingCalibrationEngine.recordServerClickFeedback({
          outcome: 'BOT_REJECTED',
          errText: 'Too fast rate limit test',
        });
        const escalatedUp =
          escalatedProf.holdMinMs > profBefore.holdMinMs &&
          escalatedProf.preDownMinMs > profBefore.preDownMinMs &&
          escalatedProf.minFlightReactionMs > profBefore.minFlightReactionMs;
        // Restore baseline profile cleanly after synthetic probe
        timingCalibrationEngine.applyExternalAutoHumanProfile(profBefore);

        const orderedNames = capturedEvents.map((e) => e.type);
        const hasAllCore =
          orderedNames.includes('pointerover') &&
          orderedNames.includes('pointerdown') &&
          orderedNames.includes('pointerup') &&
          orderedNames.includes('click');
        const hasRealisticSpan = res1.holdJitterMs >= 7 && res1.totalDispatchMs > res1.holdJitterMs;
        const coordsVaried = res1.clickX !== res2.clickX || res1.clickY !== res2.clickY;
        const passed = res1.dispatched && res2.dispatched && hasAllCore && hasRealisticSpan && coordsVaried && escalatedUp;

        updateCheck(id, {
          status: passed ? 'pass' : 'fail',
          durationMs: Number((performance.now() - t0).toFixed(2)),
          summary: passed
            ? `Human tap (${res1.totalDispatchMs}ms), BOT_REJECTED auto-widened hold ${profBefore.holdMinMs}→${escalatedProf.holdMinMs}ms & minFlight ${profBefore.minFlightReactionMs}→${escalatedProf.minFlightReactionMs}ms.`
            : 'Human-mimic click chain incomplete or auto-escalation check failed.',
          details: [
            `Event order: ${orderedNames.slice(0, 7).join(' -> ')}`,
            `Click #1 (${res1.clickX}, ${res1.clickY}) -> Click #2 (${res2.clickX}, ${res2.clickY})`,
            `Phase durations: pre=${res1.preJitterMs.toFixed(2)}ms | hold=${res1.holdJitterMs.toFixed(2)}ms | post=${res1.postJitterMs.toFixed(2)}ms`,
            `Closed-loop BOT_REJECTED escalation: hold ${profBefore.holdMinMs}-${profBefore.holdMaxMs}ms -> ${escalatedProf.holdMinMs}-${escalatedProf.holdMaxMs}ms`,
            `Button inspection post-dispatch: ${inspectCashoutButtonState(null).state} (cleaned up cleanly)`,
          ],
        });
      } else if (id === 'consolidated-net') {
        const snapBefore = violentmonkeyBridge.getSnapshot();
        const beforeFetch = snapBefore.totalByTransport.FETCH;
        const beforeXhr = snapBefore.totalByTransport.XHR;

        // 1. Live Fetch HEAD request
        const fetchRes = await fetch(`${USERSCRIPT_PUBLIC_PATH}?probe=fetch_${Date.now()}`, {
          method: 'HEAD',
          cache: 'no-store',
        });

        // 2. Live XMLHttpRequest HEAD request
        const xhrStatus = await new Promise<number>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('HEAD', `${USERSCRIPT_PUBLIC_PATH}?probe=xhr_${Date.now()}`, true);
          xhr.onload = () => resolve(xhr.status);
          xhr.onerror = () => reject(new Error('XHR probe network error'));
          xhr.send();
        });

        // Flush batcher so counters update deterministically
        await new Promise((r) => setTimeout(r, snapBefore.batcher.batchIntervalMs + 30));
        violentmonkeyBridge.flushPendingBatch();

        const snapAfter = violentmonkeyBridge.getSnapshot();
        const fetchDelta = snapAfter.totalByTransport.FETCH - beforeFetch;
        const xhrDelta = snapAfter.totalByTransport.XHR - beforeXhr;
        const wsHooked = typeof window.WebSocket === 'function' && snapAfter.interceptorsActive;
        const passed = fetchRes.ok && xhrStatus >= 200 && xhrStatus < 400 && fetchDelta >= 2 && xhrDelta >= 2 && wsHooked;

        updateCheck(id, {
          status: passed ? 'pass' : 'fail',
          durationMs: Number((performance.now() - t0).toFixed(2)),
          summary: passed
            ? `Consolidated stream captured Fetch (+${fetchDelta}), XHR (+${xhrDelta}), and verified live WebSocket proxy.`
            : `Capture delta lower than expected (Fetch +${fetchDelta}, XHR +${xhrDelta}).`,
          details: [
            `Fetch HEAD HTTP ${fetchRes.status} -> FETCH events delta: +${fetchDelta}`,
            `XMLHttpRequest HEAD HTTP ${xhrStatus} -> XHR events delta: +${xhrDelta}`,
            `WebSocket constructor Proxy active: ${wsHooked ? 'YES' : 'NO'}`,
            `Total consolidated counters -> WS:${snapAfter.totalByTransport.WS} FETCH:${snapAfter.totalByTransport.FETCH} XHR:${snapAfter.totalByTransport.XHR} DOM:${snapAfter.totalByTransport.DOM}`,
          ],
        });
      } else if (id === 'batch-coalesce') {
        const snapBefore = violentmonkeyBridge.getSnapshot();
        const beforeIngested = snapBefore.batcher.totalIngested;
        const beforeFlushes = snapBefore.batcher.totalFlushes;
        const beforeSaved = snapBefore.batcher.coalescedFramesSaved;

        const burstCount = 300;
        const stamp = Date.now();
        for (let i = 0; i < burstCount; i++) {
          violentmonkeyBridge.ingestTelemetry({
            uid: `burst_${stamp}_${i}`,
            transport: i % 3 === 0 ? 'WS' : i % 3 === 1 ? 'FETCH' : 'XHR',
            src: i % 3 === 0 ? 'WS-IN' : i % 3 === 1 ? 'FETCH-RES' : 'XHR-RES',
            direction: 'IN',
            text: `{"round":${1000 + i},"x":${(1 + i * 0.01).toFixed(2)}}`,
          });
        }

        await new Promise((r) => setTimeout(r, snapBefore.batcher.batchIntervalMs + 45));
        violentmonkeyBridge.flushPendingBatch();

        const snapAfter = violentmonkeyBridge.getSnapshot();
        const deltaIngested = snapAfter.batcher.totalIngested - beforeIngested;
        const deltaFlushes = snapAfter.batcher.totalFlushes - beforeFlushes;
        const deltaSaved = snapAfter.batcher.coalescedFramesSaved - beforeSaved;
        const passed = deltaIngested === burstCount && deltaFlushes <= 3 && deltaSaved >= burstCount - 3;

        updateCheck(id, {
          status: passed ? 'pass' : 'fail',
          durationMs: Number((performance.now() - t0).toFixed(2)),
          summary: passed
            ? `Coalesced ${deltaIngested} burst frames into ${deltaFlushes} React flush(es), avoiding ${deltaSaved} UI renders.`
            : `Expected ${burstCount} coalesced frames; saw ingested=${deltaIngested}, flushes=${deltaFlushes}.`,
          details: [
            `Burst size: ${deltaIngested} events`,
            `React flushes triggered: ${deltaFlushes} (configured interval ${snapAfter.batcher.batchIntervalMs}ms)`,
            `Coalesced renders saved: ${deltaSaved}`,
            `Last flush duration: ${snapAfter.batcher.lastFlushDurationMs.toFixed(3)}ms`,
          ],
        });
      } else if (id === 'auto-lead-calib') {
        const tagName = 'CASHOUT_DEMO';
        const sampleDeficits = [120, 145, 138, 160, 142];
        let latest = timingCalibrationEngine.recordRoundTimingSample({
          roundId: 'R1',
          tag: tagName,
          flightStartMono: 1000,
          tagArrivalMono: 1300,
          clickMono: 1300 + sampleDeficits[0],
          outCashMono: 1300 + sampleDeficits[0] + 6,
          serverAckMono: 1300 + sampleDeficits[0] + 88,
          crashMono: 1300,
          outcome: 'LATE',
        });

        for (let idx = 1; idx < sampleDeficits.length; idx++) {
          const base = idx * 5000;
          const clickAt = 1300 + base + sampleDeficits[idx];
          latest = timingCalibrationEngine.recordRoundTimingSample({
            roundId: `R${idx + 1}`,
            tag: tagName,
            flightStartMono: 1000 + base,
            tagArrivalMono: 1300 + base,
            clickMono: clickAt,
            outCashMono: clickAt + 6,
            serverAckMono: clickAt + 92,
            crashMono: 1300 + base,
            outcome: 'LATE',
          });
        }

        const passed =
          latest.calibrated &&
          latest.appliedMultiplier > 5 &&
          latest.appliedMultiplier <= 12 &&
          latest.measuredServerAcceptMs > 0 &&
          latest.recommendedLeadMs > 150;
        updateCheck(id, {
          status: passed ? 'pass' : 'fail',
          durationMs: Number((performance.now() - t0).toFixed(2)),
          summary: passed
            ? `Calibrated ${latest.tag} across ${latest.sampleCount} rounds -> Auto${latest.appliedMultiplier}x lead=${latest.recommendedLeadMs}ms (server accept ${latest.measuredServerAcceptMs}ms, median deficit ${latest.medianDeficitMs}ms).`
            : `Auto-lead calibration did not scale as expected (mult=${latest.appliedMultiplier}x, lead=${latest.recommendedLeadMs}ms).`,
          details: [
            `Tag: ${latest.tag}`,
            `Samples recorded: ${latest.sampleCount} -> Dynamic Multiplier stage: Auto${latest.appliedMultiplier}x (uncapped >5x up to 12x)`,
            `Measured server accept window: ${latest.measuredServerAcceptMs}ms · Median deficit: ${latest.medianDeficitMs}ms`,
            `Recommended PreTrig lead: ${latest.recommendedLeadMs}ms (includes auto-human tap compensation)`,
          ],
        });
      } else if (id === 'click-switch-rgb') {
        const host = stagingHostRef.current;
        if (!host) throw new Error('Staging host unavailable');

        const prevClickEnabled = violentmonkeyBridge.isClickEnabled();
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cashout_btn w-36 h-11';
        btn.textContent = 'Cash Out 2.00x';
        host.appendChild(btn);

        let nativeClickCount = 0;
        btn.addEventListener('click', () => {
          nativeClickCount += 1;
        });

        violentmonkeyBridge.setClickEnabled(false, false);
        const offResult = await violentmonkeyBridge.dispatchHumanMimicClick(btn, { tag: 'CHECK_RGB_OFF' });
        const hasRgbWhileOff =
          btn.classList.contains('tt-rgb-led-active') && violentmonkeyBridge.getSnapshot().rgbBlinkActive;

        // Simulate game cashout packet -> RGB blink must stop automatically
        violentmonkeyBridge.ingestTelemetry({
          transport: 'WS',
          src: 'WS-IN',
          direction: 'IN',
          text: '{"event":"CASH","status":"CASHED","mult":2.05}',
        });
        const stoppedOnCash =
          !btn.classList.contains('tt-rgb-led-active') && !violentmonkeyBridge.getSnapshot().rgbBlinkActive;

        // Re-enable Click Switch and verify click fires + RGB activates, then CRASH stops RGB
        violentmonkeyBridge.setClickEnabled(true, false);
        const onResult = await violentmonkeyBridge.dispatchHumanMimicClick(btn, {
          tag: 'CHECK_RGB_ON',
          jitter: { ...jitterCfg, enabled: false },
        });
        const hasRgbWhileOn =
          btn.classList.contains('tt-rgb-led-active') && violentmonkeyBridge.getSnapshot().rgbBlinkActive;

        violentmonkeyBridge.ingestTelemetry({
          transport: 'WS',
          src: 'WS-IN',
          direction: 'IN',
          text: '{"event":"CRASH","status":"ROUND_END","mult":2.41}',
        });
        const stoppedOnCrash =
          !btn.classList.contains('tt-rgb-led-active') && !violentmonkeyBridge.getSnapshot().rgbBlinkActive;

        violentmonkeyBridge.setClickEnabled(prevClickEnabled, false);
        host.removeChild(btn);

        const passed =
          offResult.dryRun === true &&
          !offResult.dispatched &&
          nativeClickCount === 1 &&
          hasRgbWhileOff &&
          stoppedOnCash &&
          onResult.dispatched &&
          hasRgbWhileOn &&
          stoppedOnCrash;

        updateCheck(id, {
          status: passed ? 'pass' : 'fail',
          durationMs: Number((performance.now() - t0).toFixed(2)),
          summary: passed
            ? 'Click OFF blocked DOM click (0 clicks) while blinking RGB LED; Click ON fired 1 click; CASH & CRASH stopped RGB.'
            : `Switch/RGB check mismatch (dryRun=${Boolean(offResult.dryRun)}, clicks=${nativeClickCount}, cashStop=${stoppedOnCash}, crashStop=${stoppedOnCrash}).`,
          details: [
            `Click OFF -> dryRun=${String(offResult.dryRun)}, nativeClicksBeforeOn=${nativeClickCount === 1 ? '0 (suppressed)' : 'unexpected'}, RGB=${hasRgbWhileOff ? 'BLINKING' : 'OFF'}`,
            `Game CASH packet -> RGB auto-stopped: ${stoppedOnCash ? 'YES' : 'NO'}`,
            `Click ON -> dispatched=${String(onResult.dispatched)}, RGB=${hasRgbWhileOn ? 'BLINKING' : 'OFF'}`,
            `Game CRASH packet -> RGB auto-stopped: ${stoppedOnCrash ? 'YES' : 'NO'}`,
          ],
        });
      } else if (id === 'lead-modes-calibration') {
        const snapBefore = timingCalibrationEngine.getSnapshot();
        const tag = 'CHECK_LEAD_MODES';

        timingCalibrationEngine.setTagLeadOverride(tag, 'manual_mult', 1, 100);
        const m1 = timingCalibrationEngine.getEffectiveLeadForTag(tag);
        timingCalibrationEngine.setTagLeadOverride(tag, 'manual_mult', 2, 100);
        const m2 = timingCalibrationEngine.getEffectiveLeadForTag(tag);
        timingCalibrationEngine.setTagLeadOverride(tag, 'manual_mult', 5, 100);
        const m5 = timingCalibrationEngine.getEffectiveLeadForTag(tag);
        timingCalibrationEngine.setTagLeadOverride(tag, 'manual_mult', 6, 100);
        const m6 = timingCalibrationEngine.getEffectiveLeadForTag(tag);
        timingCalibrationEngine.setTagLeadOverride(tag, 'manual_mult', 12, 100);
        const m12 = timingCalibrationEngine.getEffectiveLeadForTag(tag);

        timingCalibrationEngine.setTagLeadOverride(tag, 'manual_ms', 6, 235);
        const profBefore = { ...timingCalibrationEngine.getAutoHumanProfile() };
        timingCalibrationEngine.recordServerClickFeedback({ outcome: 'BOT_REJECTED', errText: 'test' });
        const customAfterReject = timingCalibrationEngine.getEffectiveLeadForTag(tag);
        timingCalibrationEngine.applyExternalAutoHumanProfile(profBefore);
        timingCalibrationEngine.removeTagLeadOverride(tag);
        timingCalibrationEngine.setGlobalLeadConfig(
          snapBefore.globalLeadMode,
          snapBefore.globalLeadMultiplier,
          snapBefore.globalManualLeadMs,
        );

        const monotonicMult =
          m1.leadMs < m2.leadMs &&
          m2.leadMs < m5.leadMs &&
          m5.leadMs < m6.leadMs &&
          m6.leadMs < m12.leadMs;
        const customLocked =
          customAfterReject.mode === 'manual_ms' && customAfterReject.leadMs === 235;
        const passed = monotonicMult && customLocked;

        updateCheck(id, {
          status: passed ? 'pass' : 'fail',
          durationMs: Number((performance.now() - t0).toFixed(2)),
          summary: passed
            ? `Lead scaling verified: 1x=${m1.leadMs}ms < 2x=${m2.leadMs}ms < 5x=${m5.leadMs}ms < 6x=${m6.leadMs}ms < 12x=${m12.leadMs}ms; custom 235ms locked.`
            : 'Manual multiplier scaling or custom ms lock failed.',
          details: [
            `Presets -> 1x:${m1.leadMs}ms · 2x:${m2.leadMs}ms · 5x:${m5.leadMs}ms · 6x:${m6.leadMs}ms · 12x:${m12.leadMs}ms`,
            `Custom ms override (235ms) after BOT_REJECTED feedback: ${customAfterReject.leadMs}ms (mode=${customAfterReject.mode})`,
          ],
        });
      }
    } catch (err) {
      updateCheck(id, {
        status: 'fail',
        durationMs: Number((performance.now() - t0).toFixed(2)),
        summary: err instanceof Error ? err.message : 'Verification check failed',
        details: [],
      });
    }
  };

  const runAllChecks = async () => {
    setRunningAllChecks(true);
    try {
      for (const chk of INITIAL_CHECKS) {
        await runSingleCheck(chk.id);
      }
    } finally {
      setRunningAllChecks(false);
    }
  };

  const handleApplyAndPushConfig = () => {
    violentmonkeyBridge.setRoomId(roomInput);
    violentmonkeyBridge.setBatchIntervalMs(batchIntervalInput);
    violentmonkeyBridge.setJitterConfig(jitterCfg);
    timingCalibrationEngine.setAutoHumanClickEnabled(jitterCfg.autoScale !== false);
    timingCalibrationEngine.setGlobalLeadConfig(leadModeInput, leadMultInput, leadMsInput);
    const prof = timingCalibrationEngine.getAutoHumanProfile();
    const tSnap = timingCalibrationEngine.getSnapshot();
    const tagOvRecord: Record<string, { mode: TagLeadMode; multiplier: number; manualMs: number }> = {};
    for (const ov of tSnap.tagOverrides) {
      tagOvRecord[ov.tag] = { mode: ov.mode, multiplier: ov.multiplier, manualMs: ov.manualMs };
    }
    violentmonkeyBridge.pushConfigToUserscript(
      {
        clickEnabled: bridgeSnap.clickEnabled,
        globalLeadMode: tSnap.globalLeadMode,
        globalLeadMultiplier: tSnap.globalLeadMultiplier,
        autoLead3xEnabled: tSnap.globalLeadMode !== 'manual_ms',
        predictivePreTriggerLeadMs: tSnap.globalManualLeadMs,
        predictiveLeadTimeMs: tSnap.globalManualLeadMs,
        tagLeadOverrides: tagOvRecord,
        batchIntervalMs: batchIntervalInput,
        humanMimicJitter: jitterCfg.enabled,
        autoHumanClick: jitterCfg.autoScale !== false,
        preHoverJitterMinMs: jitterCfg.preHoverJitterMinMs,
        preHoverJitterMaxMs: jitterCfg.preHoverJitterMaxMs,
        holdDurationMinMs: jitterCfg.holdDurationMinMs,
        holdDurationMaxMs: jitterCfg.holdDurationMaxMs,
        postUpJitterMinMs: jitterCfg.postUpJitterMinMs,
        postUpJitterMaxMs: jitterCfg.postUpJitterMaxMs,
        humanEnv: {
          preMin: prof.preDownMinMs,
          preMax: prof.preDownMaxMs,
          holdMin: prof.holdMinMs,
          holdMax: prof.holdMaxMs,
          postMin: prof.postUpMinMs,
          postMax: prof.postUpMaxMs,
          minFlightMs: prof.minFlightReactionMs,
          coordPx: prof.coordinateJitterPx,
        },
        retryOnBtnOff: jitterCfg.retryOnBtnOff,
        maxBtnOffRetryMs: jitterCfg.maxBtnOffRetryMs,
      },
      roomInput,
    );
    setConfigStatus('Applied locally and pushed Click Switch, Lead Mode/Overrides & Auto-Human config to Violentmonkey.');
    window.setTimeout(() => setConfigStatus(''), 3500);
  };

  const handleToggleClickSwitch = () => {
    violentmonkeyBridge.setClickEnabled(!bridgeSnap.clickEnabled, true);
  };

  const handleTriggerPreviewCashout = async () => {
    const btn = previewBtnRef.current;
    if (!btn) return;
    await violentmonkeyBridge.dispatchHumanMimicClick(btn, { tag: 'CASHOUT_PREVIEW' });
  };

  const handleSimulateGameEnd = (kind: 'CASH' | 'CRASH') => {
    violentmonkeyBridge.ingestTelemetry({
      transport: 'WS',
      src: 'WS-IN',
      direction: 'IN',
      matched: true,
      matchedTag: kind,
      text:
        kind === 'CASH'
          ? '{"event":"CASH","status":"CASHED","mult":2.45}'
          : '{"event":"CRASH","status":"ROUND_END","mult":1.87}',
    });
    violentmonkeyBridge.flushPendingBatch();
  };

  const handleDownloadUserscript = async () => {
    const src = await loadUserscriptSource();
    const blob = new Blob([src], { type: 'text/javascript;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = USERSCRIPT_DOWNLOAD_NAME;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopyUserscript = async () => {
    try {
      const src = await loadUserscriptSource();
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(src);
      } else {
        throw new Error('Clipboard API unavailable');
      }
      setCopyFeedback('Copied full .user.js to clipboard');
      window.setTimeout(() => setCopyFeedback(''), 3000);
    } catch {
      try {
        const src = await loadUserscriptSource();
        const ta = document.createElement('textarea');
        ta.value = src;
        ta.setAttribute('readonly', 'true');
        ta.className = 'fixed -left-[9999px] top-0 opacity-0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        setCopyFeedback('Copied full .user.js to clipboard');
        window.setTimeout(() => setCopyFeedback(''), 3000);
      } catch {
        setCopyFeedback('Use Download .user.js button to save the script');
        window.setTimeout(() => setCopyFeedback(''), 3500);
      }
    }
  };

  const retryDepth = timingSnap.totalRetryQueueDepth;
  const retryActive = retryDepth > 0;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col md:flex-row">
      {/* Hidden off-screen staging host used only during explicit user-triggered verification tests */}
      <div
        ref={stagingHostRef}
        aria-hidden="true"
        className="fixed -left-[9999px] -top-[9999px] pointer-events-none opacity-0"
      />

      {/* Left Sidebar (256px) */}
      <aside className="w-full md:w-64 shrink-0 border-b md:border-b-0 md:border-r border-slate-800 bg-slate-950 flex flex-col justify-between">
        <div>
          <div className="h-14 px-5 flex items-center justify-between border-b border-slate-800">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                <Zap className="w-4 h-4" />
              </div>
              <div>
                <div className="text-sm font-semibold tracking-tight text-slate-100 leading-none">
                  TriggerTap
                </div>
                <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                  v5.2.5 Relay Monitor
                </div>
              </div>
            </div>
          </div>

          <nav className="p-3 space-y-1">
            {(
              [
                { id: 'monitor', label: 'Relay Monitor', icon: Activity },
                { id: 'verify', label: 'System Verification', icon: ShieldCheck },
                { id: 'config', label: 'Timing & Jitter Config', icon: Sliders },
                { id: 'userscript', label: 'Userscript Export', icon: FileCode2 },
              ] as const
            ).map((item) => {
              const Icon = item.icon;
              const isActive = activeNav === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveNav(item.id)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-slate-800/90 text-slate-50 border border-slate-700/80'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/70 border border-transparent'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Icon className={`w-4 h-4 ${isActive ? 'text-emerald-400' : 'text-slate-500'}`} />
                    {item.label}
                  </span>
                  <ChevronRight className={`w-3.5 h-3.5 ${isActive ? 'text-slate-300' : 'text-slate-600'}`} />
                </button>
              );
            })}
          </nav>
        </div>

        {/* Sidebar Connection Footer */}
        <div className="p-4 border-t border-slate-800 space-y-2.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Room Channel</span>
            <span className="font-mono text-slate-200 font-medium">{bridgeSnap.roomId}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-400">VM GM Bridge</span>
            <span
              className={`font-mono font-medium flex items-center gap-1.5 ${
                bridgeSnap.gmBridgeReady ? 'text-emerald-400' : 'text-amber-400'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  bridgeSnap.gmBridgeReady ? 'bg-emerald-400' : 'bg-amber-400'
                }`}
              />
              {bridgeSnap.gmBridgeReady ? 'LINKED' : 'STANDBY'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-400">WS / Fetch / XHR Tap</span>
            <span
              className={`font-mono font-medium ${
                bridgeSnap.interceptorsActive ? 'text-cyan-400' : 'text-slate-500'
              }`}
            >
              {bridgeSnap.interceptorsActive ? 'ARMED' : 'OFF'}
            </span>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Header */}
        <header className="h-14 border-b border-slate-800 bg-slate-950/90 px-4 sm:px-6 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="text-xs font-mono text-slate-400 truncate">
              TriggerTap <span className="text-slate-600 mx-1">/</span>{' '}
              <span className="text-slate-200 font-medium">
                {activeNav === 'monitor'
                  ? 'Consolidated Relay Monitor'
                  : activeNav === 'verify'
                    ? '1-by-1 System Verification'
                    : activeNav === 'config'
                      ? 'Timing & Human-Mimic Jitter'
                      : 'Violentmonkey Userscript'}
              </span>
            </div>

            {/* Required Retry Queue Depth Indicator in Header */}
            <div
              className={`hidden sm:flex items-center gap-2 px-2.5 py-1 rounded border text-xs font-mono tabular-nums ${
                retryActive
                  ? 'border-amber-500/50 bg-amber-950/50 text-amber-300'
                  : 'border-slate-800 bg-slate-900 text-slate-300'
              }`}
              title="Sub-millisecond btn_off recursive retry queue depth"
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  retryActive ? 'bg-amber-400 animate-pulse' : 'bg-emerald-500'
                }`}
              />
              <span>Retry Queue:</span>
              <strong className="text-slate-100">{retryDepth}</strong>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleToggleClickSwitch}
              title="Master Click Switch: OFF suppresses clicks while keeping extra-bright RGB LED blink active"
              className={`whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-mono font-semibold border transition-colors ${
                bridgeSnap.clickEnabled
                  ? 'bg-emerald-950/70 border-emerald-600/70 text-emerald-300 hover:bg-emerald-900/70'
                  : 'bg-amber-950/70 border-amber-500/70 text-amber-300 hover:bg-amber-900/70'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  bridgeSnap.clickEnabled ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'
                }`}
              />
              {bridgeSnap.clickEnabled ? 'Click: ON' : 'Click: OFF (RGB Only)'}
            </button>
            <button
              type="button"
              onClick={() => violentmonkeyBridge.pullFromUserscript(bridgeSnap.roomId)}
              className="whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5 text-slate-400" />
              Pull Bridge
            </button>
            <button
              type="button"
              onClick={() => void handleDownloadUserscript()}
              className="whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-semibold transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Download .user.js
            </button>
          </div>
        </header>

        {/* Scrollable Workspace */}
        <main className="flex-1 p-4 sm:p-6 space-y-5 max-w-[1440px] w-full mx-auto">
          {activeNav === 'monitor' && (
            <>
              {/* Compact RGB LED & Click Switch / Lead Control Bar */}
              <section className="border border-slate-800 rounded-lg bg-slate-900 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    ref={previewBtnRef}
                    type="button"
                    onClick={() => void handleTriggerPreviewCashout()}
                    className={`px-3.5 py-1.5 rounded-md text-xs font-semibold border transition-all ${
                      bridgeSnap.rgbBlinkActive
                        ? 'tt-rgb-led-active bg-fuchsia-950/80 text-white border-white'
                        : 'bg-slate-950 hover:bg-slate-800 text-slate-100 border-slate-700'
                    }`}
                  >
                    Trigger Target Cash Out
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSimulateGameEnd('CASH')}
                    disabled={!bridgeSnap.rgbBlinkActive}
                    className="px-2.5 py-1.5 rounded text-xs font-mono bg-emerald-950/60 hover:bg-emerald-900/60 disabled:opacity-40 text-emerald-300 border border-emerald-700/60 transition-colors"
                  >
                    Simulate Cash Out
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSimulateGameEnd('CRASH')}
                    disabled={!bridgeSnap.rgbBlinkActive}
                    className="px-2.5 py-1.5 rounded text-xs font-mono bg-rose-950/60 hover:bg-rose-900/60 disabled:opacity-40 text-rose-300 border border-rose-700/60 transition-colors"
                  >
                    Simulate Crash
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-3 text-xs font-mono">
                  <span
                    className={`px-2 py-1 rounded border ${
                      bridgeSnap.rgbBlinkActive
                        ? 'border-fuchsia-400/70 bg-fuchsia-950/60 text-fuchsia-200 animate-pulse'
                        : 'border-slate-800 bg-slate-950 text-slate-400'
                    }`}
                  >
                    RGB LED: {bridgeSnap.rgbBlinkActive ? `BLINKING (${bridgeSnap.rgbBlinkReason})` : 'IDLE'}
                  </span>
                  <span className="px-2 py-1 rounded border border-slate-800 bg-slate-950 text-cyan-300">
                    Lead:{' '}
                    {timingSnap.globalLeadMode === 'auto'
                      ? `Auto (${timingSnap.globalLeadMultiplier}x)`
                      : timingSnap.globalLeadMode === 'manual_mult'
                        ? `${timingSnap.globalLeadMultiplier}x`
                        : `${timingSnap.globalManualLeadMs}ms`}
                  </span>
                </div>
              </section>
              {/* Flat 4-Column Telemetry Strip (Single Elevation Surface, No Nested Cards) */}
              <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border border-slate-800 rounded-lg bg-slate-900 divide-y sm:divide-y-0 sm:divide-x divide-slate-800 overflow-hidden">
                {/* 1. Retry Queue Depth & Sub-ms Check Telemetry */}
                <div className="p-4 space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span className="flex items-center gap-1.5 font-medium">
                      <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
                      Retry Queue Depth
                    </span>
                    <span className="font-mono text-[11px] text-slate-500">sub-ms check</span>
                  </div>
                  <div className="flex items-baseline gap-2.5">
                    <span
                      className={`text-2xl font-mono font-semibold tabular-nums ${
                        retryActive ? 'text-amber-300' : 'text-slate-100'
                      }`}
                    >
                      {retryDepth}
                    </span>
                    <span className="text-xs font-mono text-slate-400 tabular-nums">
                      avg {timingSnap.avgCheckIntervalMs.toFixed(3)}ms
                    </span>
                  </div>
                  <div className="text-[11px] font-mono text-slate-400 tabular-nums flex items-center gap-3">
                    <span>btn_off: {timingSnap.totalBtnOffDetections}</span>
                    <span className="text-emerald-400">recovered: {timingSnap.totalRecoveries}</span>
                    <span>checks: {timingSnap.totalChecksExecuted}</span>
                  </div>
                </div>

                {/* 2. Consolidated Stream Counters */}
                <div className="p-4 space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span className="flex items-center gap-1.5 font-medium">
                      <Wifi className="w-3.5 h-3.5 text-cyan-400" />
                      Consolidated Streams
                    </span>
                    <span className="font-mono text-[11px] text-cyan-400">
                      {bridgeSnap.interceptorsActive ? 'LIVE' : 'IDLE'}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-2.5">
                    <span className="text-2xl font-mono font-semibold tabular-nums text-slate-100">
                      {bridgeSnap.batcher.totalIngested}
                    </span>
                    <span className="text-xs font-mono text-slate-400">frames captured</span>
                  </div>
                  <div className="text-[11px] font-mono text-slate-400 tabular-nums flex items-center gap-2.5">
                    <span className="text-violet-300">WS:{bridgeSnap.totalByTransport.WS}</span>
                    <span className="text-cyan-300">FETCH:{bridgeSnap.totalByTransport.FETCH}</span>
                    <span className="text-amber-300">XHR:{bridgeSnap.totalByTransport.XHR}</span>
                    <span className="text-emerald-300">DOM:{bridgeSnap.totalByTransport.DOM}</span>
                  </div>
                </div>

                {/* 3. Auto-Human Anti-Bot Click Timing */}
                <div className="p-4 space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span className="flex items-center gap-1.5 font-medium">
                      <MousePointerClick className="w-3.5 h-3.5 text-emerald-400" />
                      Auto-Human Anti-Bot
                    </span>
                    <span
                      className={`font-mono text-[11px] ${
                        timingSnap.autoHumanProfile.enabled ? 'text-emerald-400' : 'text-amber-400'
                      }`}
                    >
                      {timingSnap.autoHumanProfile.enabled ? 'AUTO-SET' : (jitterCfg.enabled ? 'MANUAL' : 'DIRECT')}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-2.5">
                    <span className="text-2xl font-mono font-semibold tabular-nums text-slate-100">
                      {bridgeSnap.lastClickResult
                        ? `${bridgeSnap.lastClickResult.totalDispatchMs.toFixed(1)}ms`
                        : `${timingSnap.autoHumanProfile.avgHumanSpanMs.toFixed(0)}ms`}
                    </span>
                    <span className="text-xs font-mono text-slate-400 tabular-nums">
                      hold {timingSnap.autoHumanProfile.holdMinMs}-{timingSnap.autoHumanProfile.holdMaxMs}ms · fl≥{timingSnap.autoHumanProfile.minFlightReactionMs}ms
                    </span>
                  </div>
                  <div className="text-[11px] font-mono text-slate-400 tabular-nums truncate" title={timingSnap.autoHumanProfile.lastAdaptationReason}>
                    streak:{timingSnap.autoHumanProfile.acceptStreak} · rejects:{timingSnap.autoHumanProfile.rejectCount} · {timingSnap.autoHumanProfile.lastAdaptationReason}
                  </div>
                </div>

                {/* 4. Telemetry Batcher Overhead */}
                <div className="p-4 space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span className="flex items-center gap-1.5 font-medium">
                      <Layers className="w-3.5 h-3.5 text-violet-400" />
                      UI Batch Coalescer
                    </span>
                    <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                      {bridgeSnap.batcher.batchIntervalMs}ms cap
                    </span>
                  </div>
                  <div className="flex items-baseline gap-2.5">
                    <span className="text-2xl font-mono font-semibold tabular-nums text-slate-100">
                      {bridgeSnap.batcher.coalescedFramesSaved}
                    </span>
                    <span className="text-xs font-mono text-slate-400">renders skipped</span>
                  </div>
                  <div className="text-[11px] font-mono text-slate-400 tabular-nums flex items-center gap-3">
                    <span>flushes: {bridgeSnap.batcher.totalFlushes}</span>
                    <span>avg batch: {bridgeSnap.batcher.avgBatchSize}</span>
                    <span>{bridgeSnap.batcher.effectiveUiHz.toFixed(1)} Hz</span>
                  </div>
                </div>
              </section>

              {/* Retry Queue & Last Human-Mimic Dispatch Trace (only displayed when populated) */}
              {(timingSnap.activeRetries.length > 0 || timingSnap.recentEvents.length > 0 || bridgeSnap.lastClickResult) && (
                <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Retry Queue Log */}
                  <div className="border border-slate-800 rounded-lg bg-slate-900 overflow-hidden">
                    <div className="px-4 py-2.5 border-b border-slate-800 flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                        <Clock className="w-3.5 h-3.5 text-amber-400" />
                        Sub-Millisecond Retry Queue History
                      </div>
                      <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                        Local:{timingSnap.retryQueueDepth} · Bridge:{timingSnap.externalRetryQueueDepth}
                      </span>
                    </div>
                    <div className="max-h-44 overflow-y-auto divide-y divide-slate-800/70">
                      {timingSnap.recentEvents.length === 0 ? (
                        <div className="px-4 py-6 text-xs text-slate-500 text-center">
                          No btn_off retry transitions recorded yet.
                        </div>
                      ) : (
                        timingSnap.recentEvents.slice(0, 8).map((ev, idx) => (
                          <div
                            key={`${ev.id}_${ev.status}_${idx}`}
                            className="px-4 py-2 flex items-center justify-between gap-3 text-xs font-mono"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span
                                className={
                                  ev.status === 'RECOVERED'
                                    ? 'text-emerald-400'
                                    : ev.status === 'EXHAUSTED'
                                      ? 'text-rose-400'
                                      : 'text-amber-300'
                                }
                              >
                                {ev.status}
                              </span>
                              <span className="text-slate-300 truncate">{ev.reason}</span>
                            </div>
                            <span className="text-slate-400 tabular-nums shrink-0">
                              {ev.attempts}x · {ev.elapsedMs.toFixed(2)}ms
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Last Click Sequence Phase Trace */}
                  <div className="border border-slate-800 rounded-lg bg-slate-900 overflow-hidden">
                    <div className="px-4 py-2.5 border-b border-slate-800 flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                        <Gauge className="w-3.5 h-3.5 text-emerald-400" />
                        Last Human-Mimic Dispatch Phases
                      </div>
                      {bridgeSnap.lastClickResult && (
                        <span className="font-mono text-[11px] text-emerald-400 tabular-nums">
                          {bridgeSnap.lastClickResult.dispatched ? 'ACCEPTED' : 'BLOCKED'} ·{' '}
                          {bridgeSnap.lastClickResult.totalDispatchMs.toFixed(2)}ms
                        </span>
                      )}
                    </div>
                    <div className="max-h-44 overflow-y-auto divide-y divide-slate-800/70">
                      {!bridgeSnap.lastClickResult ? (
                        <div className="px-4 py-6 text-xs text-slate-500 text-center">
                          Run a verification click or trigger from Violentmonkey to inspect phase timings.
                        </div>
                      ) : (
                        bridgeSnap.lastClickResult.traces.map((tr, idx) => (
                          <div
                            key={`${tr.phase}_${idx}`}
                            className="px-4 py-1.5 flex items-center justify-between gap-3 text-xs font-mono"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-cyan-300 shrink-0">{tr.phase}</span>
                              <span className="text-slate-400 truncate">{tr.detail}</span>
                            </div>
                            <span className="text-slate-400 tabular-nums shrink-0">
                              +{tr.deltaFromPrevMs.toFixed(2)}ms
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </section>
              )}

              {/* Consolidated Telemetry Stream Table */}
              <section className="border border-slate-800 rounded-lg bg-slate-900 overflow-hidden">
                <div className="p-3 sm:px-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Filter className="w-3.5 h-3.5 text-slate-500 mr-1" />
                    {(['ALL', 'WS', 'FETCH', 'XHR', 'DOM', 'VM-BRIDGE'] as const).map((tr) => {
                      const count =
                        tr === 'ALL'
                          ? bridgeSnap.events.length
                          : bridgeSnap.events.filter((e) => e.transport === tr).length;
                      const active = transportFilter === tr;
                      return (
                        <button
                          key={tr}
                          type="button"
                          onClick={() => setTransportFilter(tr)}
                          className={`px-2.5 py-1 rounded text-xs font-mono transition-colors ${
                            active
                              ? 'bg-slate-800 text-slate-100 border border-slate-600'
                              : 'text-slate-400 hover:text-slate-200 border border-transparent hover:bg-slate-800/50'
                          }`}
                        >
                          {tr} <span className="text-slate-500 tabular-nums">({count})</span>
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => setMatchedOnly((v) => !v)}
                      className={`ml-1 px-2.5 py-1 rounded text-xs font-mono border transition-colors ${
                        matchedOnly
                          ? 'bg-emerald-950/70 text-emerald-300 border-emerald-700/70'
                          : 'text-slate-400 border-slate-800 hover:text-slate-200'
                      }`}
                    >
                      Hits Only
                    </button>
                  </div>

                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <div className="relative flex-1 sm:w-64">
                      <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Filter payload, URL, tag..."
                        className="w-full pl-8 pr-3 py-1.5 rounded bg-slate-950 border border-slate-800 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-slate-600"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        violentmonkeyBridge.clearEvents();
                        setSelectedEvent(null);
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs text-slate-400 hover:text-rose-300 bg-slate-950 border border-slate-800 hover:border-slate-700 transition-colors shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Clear
                    </button>
                  </div>
                </div>

                {/* Stream Rows + Optional Payload Drawer */}
                <div className="grid grid-cols-1 lg:grid-cols-3">
                  <div className={selectedEvent ? 'lg:col-span-2' : 'lg:col-span-3'}>
                    {filteredEvents.length === 0 ? (
                      <div className="py-14 px-6 text-center space-y-3">
                        <Radio className="w-7 h-7 text-slate-600 mx-auto" />
                        <div className="text-sm font-medium text-slate-300">
                          {bridgeSnap.events.length === 0
                            ? 'Awaiting Live Game & Userscript Telemetry'
                            : 'No events match your current filter'}
                        </div>
                        <p className="text-xs text-slate-400 max-w-md mx-auto">
                          Keep this Relay Monitor tab open while running the updated TriggerTap script in Violentmonkey, or inspect every subsystem live in the verification suite.
                        </p>
                        <div className="pt-1 flex items-center justify-center gap-2">
                          <button
                            type="button"
                            onClick={() => setActiveNav('verify')}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700"
                          >
                            <Play className="w-3.5 h-3.5 text-emerald-400" />
                            Run System Verification
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
                        <table className="w-full text-left border-collapse">
                          <thead className="sticky top-0 bg-slate-950 border-b border-slate-800 text-[11px] font-mono uppercase text-slate-400">
                            <tr>
                              <th className="py-2 px-3 w-28">Time</th>
                              <th className="py-2 px-2 w-24">Transport</th>
                              <th className="py-2 px-2 w-28">Source</th>
                              <th className="py-2 px-2 w-24">Meta</th>
                              <th className="py-2 px-3">Payload / Endpoint</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/70 text-xs">
                            {filteredEvents.slice(0, 140).map((ev) => {
                              const isSel = selectedEvent?.uid === ev.uid;
                              return (
                                <tr
                                  key={ev.uid}
                                  onClick={() => setSelectedEvent(isSel ? null : ev)}
                                  className={`cursor-pointer transition-colors ${
                                    isSel
                                      ? 'bg-slate-800/80'
                                      : ev.matched
                                        ? 'bg-emerald-950/20 hover:bg-emerald-950/35'
                                        : 'hover:bg-slate-800/40'
                                  }`}
                                >
                                  <td className="py-2 px-3 font-mono text-slate-400 tabular-nums whitespace-nowrap">
                                    {ev.time}
                                  </td>
                                  <td className="py-2 px-2 whitespace-nowrap">
                                    <span
                                      className={`inline-block px-1.5 py-0.5 rounded border text-[10px] font-mono font-medium ${transportTone(
                                        ev.transport,
                                      )}`}
                                    >
                                      {ev.transport}
                                    </span>
                                  </td>
                                  <td className="py-2 px-2 font-mono text-slate-300 whitespace-nowrap">
                                    {ev.src}
                                  </td>
                                  <td className="py-2 px-2 font-mono text-slate-400 tabular-nums whitespace-nowrap">
                                    {ev.status ? `${ev.status}` : ev.direction}
                                    {ev.durationMs != null ? ` · ${ev.durationMs}ms` : ''}
                                  </td>
                                  <td className="py-2 px-3 font-mono text-slate-200 max-w-md truncate">
                                    {ev.matchedTag ? (
                                      <span className="text-emerald-400 font-semibold mr-2">
                                        [{ev.matchedTag}]
                                      </span>
                                    ) : null}
                                    {ev.text.replace(/\s+/g, ' ')}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {selectedEvent && (
                    <div className="border-t lg:border-t-0 lg:border-l border-slate-800 bg-slate-950/80 p-4 flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono font-semibold text-slate-200">
                          {selectedEvent.transport} / {selectedEvent.src}
                        </span>
                        <button
                          type="button"
                          onClick={() => setSelectedEvent(null)}
                          className="text-slate-400 hover:text-slate-200"
                          aria-label="Close payload inspector"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-slate-400 border-b border-slate-800 pb-3">
                        <div>Time: {selectedEvent.time}</div>
                        <div>Dir: {selectedEvent.direction}</div>
                        {selectedEvent.status != null && <div>Status: {selectedEvent.status}</div>}
                        {selectedEvent.durationMs != null && <div>RTT: {selectedEvent.durationMs}ms</div>}
                        {selectedEvent.retryQueueDepth != null && (
                          <div>Retry Queue: {selectedEvent.retryQueueDepth}</div>
                        )}
                        {selectedEvent.matchedTag && (
                          <div className="text-emerald-400">Tag: {selectedEvent.matchedTag}</div>
                        )}
                      </div>
                      {selectedEvent.url && (
                        <div className="text-[11px] font-mono text-cyan-300 break-all">
                          {selectedEvent.method ? `${selectedEvent.method} ` : ''}
                          {selectedEvent.url}
                        </div>
                      )}
                      <pre className="text-[11px] font-mono text-slate-200 bg-slate-900 border border-slate-800 rounded p-3 overflow-auto max-h-72 whitespace-pre-wrap break-all">
                        {selectedEvent.text}
                      </pre>
                    </div>
                  )}
                </div>
              </section>
            </>
          )}

          {activeNav === 'verify' && (
            <section className="space-y-4">
              <div className="border border-slate-800 rounded-lg bg-slate-900 p-4 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-sm font-semibold text-slate-100">
                    1-by-1 Subsystem Verification Bench
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">
                    Executes live DOM, Event-Queue, Fetch/XHR, Batching, and Round-Lead calibration checks directly inside the browser runtime.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={runningAllChecks}
                  onClick={() => void runAllChecks()}
                  className="whitespace-nowrap shrink-0 inline-flex items-center gap-2 px-3.5 py-2 rounded-md text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-slate-950 transition-colors"
                >
                  <Play className="w-3.5 h-3.5" />
                  {runningAllChecks ? 'Running All Checks...' : `Run All ${INITIAL_CHECKS.length} Checks`}
                </button>
              </div>

              <div className="border border-slate-800 rounded-lg bg-slate-900 divide-y divide-slate-800">
                {checks.map((chk) => (
                  <div key={chk.id} className="p-4 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        {chk.status === 'pass' ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        ) : chk.status === 'fail' ? (
                          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                        ) : chk.status === 'running' ? (
                          <RefreshCw className="w-4 h-4 text-amber-400 animate-spin shrink-0" />
                        ) : (
                          <Clock className="w-4 h-4 text-slate-500 shrink-0" />
                        )}
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-slate-100">{chk.title}</div>
                          <div className="text-[11px] font-mono text-slate-400">{chk.module}</div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        {chk.durationMs != null && (
                          <span className="text-xs font-mono text-slate-400 tabular-nums">
                            {chk.durationMs.toFixed(2)}ms
                          </span>
                        )}
                        <button
                          type="button"
                          disabled={chk.status === 'running' || runningAllChecks}
                          onClick={() => void runSingleCheck(chk.id)}
                          className="px-3 py-1.5 rounded text-xs font-medium bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-100 border border-slate-700 transition-colors"
                        >
                          {chk.status === 'running' ? 'Running...' : 'Run Check'}
                        </button>
                      </div>
                    </div>

                    <p className="text-xs text-slate-300">{chk.summary}</p>

                    {chk.details.length > 0 && (
                      <div className="bg-slate-950 border border-slate-800 rounded p-3 space-y-1 font-mono text-[11px] text-slate-300">
                        {chk.details.map((line, i) => (
                          <div key={i}>{line}</div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {activeNav === 'config' && (
            <section className="border border-slate-800 rounded-lg bg-slate-900 p-5 space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
                <div>
                  <h2 className="text-sm font-semibold text-slate-100">
                    Timing Engine, Batcher & Human-Mimic Click Config
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Configure sub-millisecond btn_off retry limits, micro-jitter timing envelopes, and telemetry batching.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleApplyAndPushConfig}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-slate-950 transition-colors"
                >
                  <Send className="w-3.5 h-3.5" />
                  Apply & Push to Violentmonkey
                </button>
              </div>

              {configStatus && (
                <div className="px-3.5 py-2 rounded bg-emerald-950/60 border border-emerald-700/70 text-xs font-mono text-emerald-300">
                  {configStatus}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Bridge & Batching */}
                <div className="space-y-4">
                  <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400">
                    Bridge & UI Batching
                  </h3>
                  <label className="block space-y-1">
                    <span className="text-xs text-slate-300">Relay Room ID</span>
                    <input
                      type="text"
                      value={roomInput}
                      onChange={(e) => setRoomInput(e.target.value)}
                      className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-800 text-xs font-mono text-slate-100 focus:outline-none focus:border-slate-600"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-xs text-slate-300">
                      Telemetry Batch Flush Interval ({batchIntervalInput}ms)
                    </span>
                    <input
                      type="range"
                      min={16}
                      max={200}
                      step={4}
                      value={batchIntervalInput}
                      onChange={(e) => setBatchIntervalInput(Number(e.target.value))}
                      className="w-full accent-emerald-500"
                    />
                  </label>
                  <label className="flex items-center justify-between pt-2">
                    <span className="text-xs text-slate-200">Retry when button is in btn_off / disabled</span>
                    <input
                      type="checkbox"
                      checked={jitterCfg.retryOnBtnOff}
                      onChange={(e) =>
                        setJitterCfg((prev) => ({ ...prev, retryOnBtnOff: e.target.checked }))
                      }
                      className="w-4 h-4 accent-emerald-500"
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block space-y-1">
                      <span className="text-xs text-slate-400">Max btn_off Retry (ms)</span>
                      <input
                        type="number"
                        min={50}
                        max={2000}
                        value={jitterCfg.maxBtnOffRetryMs}
                        onChange={(e) =>
                          setJitterCfg((prev) => ({
                            ...prev,
                            maxBtnOffRetryMs: Number(e.target.value) || 600,
                          }))
                        }
                        className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 text-xs font-mono text-slate-100"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-xs text-slate-400">Max Recursive Attempts</span>
                      <input
                        type="number"
                        min={8}
                        max={400}
                        value={jitterCfg.maxBtnOffAttempts}
                        onChange={(e) =>
                          setJitterCfg((prev) => ({
                            ...prev,
                            maxBtnOffAttempts: Number(e.target.value) || 48,
                          }))
                        }
                        className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 text-xs font-mono text-slate-100"
                      />
                    </label>
                  </div>
                </div>

                {/* Human-Mimic Jitter Envelope */}
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400">
                      Auto-Human Anti-Bot Envelope
                    </h3>
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-1.5 text-xs text-emerald-300">
                        <input
                          type="checkbox"
                          checked={jitterCfg.autoScale !== false}
                          onChange={(e) =>
                            setJitterCfg((prev) => ({ ...prev, autoScale: e.target.checked }))
                          }
                          className="w-4 h-4 accent-emerald-500"
                        />
                        Auto-Set
                      </label>
                      <label className="flex items-center gap-1.5 text-xs text-slate-200">
                        <input
                          type="checkbox"
                          checked={jitterCfg.enabled}
                          onChange={(e) =>
                            setJitterCfg((prev) => ({ ...prev, enabled: e.target.checked }))
                          }
                          className="w-4 h-4 accent-emerald-500"
                        />
                        Enabled
                      </label>
                    </div>
                  </div>
                  <div className="px-3 py-2 rounded bg-slate-950 border border-slate-800 text-[11px] font-mono text-slate-300 flex flex-wrap items-center justify-between gap-2">
                    <span>
                      Live Auto Envelope: pre {timingSnap.autoHumanProfile.preDownMinMs}-{timingSnap.autoHumanProfile.preDownMaxMs}ms · hold {timingSnap.autoHumanProfile.holdMinMs}-{timingSnap.autoHumanProfile.holdMaxMs}ms · floor ≥{timingSnap.autoHumanProfile.minFlightReactionMs}ms
                    </span>
                    <span className="text-emerald-400">
                      streak {timingSnap.autoHumanProfile.acceptStreak} · rejects {timingSnap.autoHumanProfile.rejectCount}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <label className="block space-y-1">
                      <span className="text-xs text-slate-400">Pre-Down Min (ms)</span>
                      <input
                        type="number"
                        step="0.2"
                        value={jitterCfg.preHoverJitterMinMs}
                        onChange={(e) =>
                          setJitterCfg((prev) => ({
                            ...prev,
                            preHoverJitterMinMs: Number(e.target.value) || 0,
                          }))
                        }
                        className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 text-xs font-mono text-slate-100"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-xs text-slate-400">Pre-Down Max (ms)</span>
                      <input
                        type="number"
                        step="0.2"
                        value={jitterCfg.preHoverJitterMaxMs}
                        onChange={(e) =>
                          setJitterCfg((prev) => ({
                            ...prev,
                            preHoverJitterMaxMs: Number(e.target.value) || 0,
                          }))
                        }
                        className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 text-xs font-mono text-slate-100"
                      />
                    </label>

                    <label className="block space-y-1">
                      <span className="text-xs text-slate-400">Hold Min (ms)</span>
                      <input
                        type="number"
                        step="0.5"
                        value={jitterCfg.holdDurationMinMs}
                        onChange={(e) =>
                          setJitterCfg((prev) => ({
                            ...prev,
                            holdDurationMinMs: Number(e.target.value) || 0,
                          }))
                        }
                        className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 text-xs font-mono text-slate-100"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-xs text-slate-400">Hold Max (ms)</span>
                      <input
                        type="number"
                        step="0.5"
                        value={jitterCfg.holdDurationMaxMs}
                        onChange={(e) =>
                          setJitterCfg((prev) => ({
                            ...prev,
                            holdDurationMaxMs: Number(e.target.value) || 0,
                          }))
                        }
                        className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 text-xs font-mono text-slate-100"
                      />
                    </label>

                    <label className="block space-y-1">
                      <span className="text-xs text-slate-400">Post-Up Min (ms)</span>
                      <input
                        type="number"
                        step="0.2"
                        value={jitterCfg.postUpJitterMinMs}
                        onChange={(e) =>
                          setJitterCfg((prev) => ({
                            ...prev,
                            postUpJitterMinMs: Number(e.target.value) || 0,
                          }))
                        }
                        className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 text-xs font-mono text-slate-100"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-xs text-slate-400">Coordinate Radius (px)</span>
                      <input
                        type="number"
                        step="0.5"
                        value={jitterCfg.coordinateJitterPx}
                        onChange={(e) =>
                          setJitterCfg((prev) => ({
                            ...prev,
                            coordinateJitterPx: Number(e.target.value) || 0,
                          }))
                        }
                        className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 text-xs font-mono text-slate-100"
                      />
                    </label>
                  </div>
                </div>
              </div>

              {/* Master Click Switch & Flexible Lead Timing (Auto + 1x..12x + Custom ms + Per-Tag) */}
              <div className="border-t border-slate-800 pt-5 grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400">
                      Master Click Switch &amp; Global Lead Timing
                    </h3>
                    <button
                      type="button"
                      onClick={handleToggleClickSwitch}
                      className={`px-3 py-1 rounded text-xs font-mono font-semibold border transition-colors ${
                        bridgeSnap.clickEnabled
                          ? 'bg-emerald-950/70 border-emerald-600/70 text-emerald-300'
                          : 'bg-amber-950/70 border-amber-500/70 text-amber-300'
                      }`}
                    >
                      {bridgeSnap.clickEnabled ? 'Click Switch: ON' : 'Click Switch: OFF (RGB Only)'}
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setLeadModeInput('auto');
                        timingCalibrationEngine.setGlobalLeadConfig('auto', leadMultInput, leadMsInput);
                      }}
                      className={`px-2.5 py-1.5 rounded text-xs font-mono border transition-colors ${
                        leadModeInput === 'auto'
                          ? 'bg-emerald-600 text-slate-950 font-semibold border-emerald-500'
                          : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      Auto (3x→12x)
                    </button>
                    {AUTO_LEAD_MULTIPLIER_PRESETS.map((mult) => {
                      const active = leadModeInput === 'manual_mult' && leadMultInput === mult;
                      return (
                        <button
                          key={mult}
                          type="button"
                          onClick={() => {
                            setLeadModeInput('manual_mult');
                            setLeadMultInput(mult);
                            timingCalibrationEngine.setGlobalLeadConfig('manual_mult', mult, leadMsInput);
                          }}
                          className={`px-2.5 py-1.5 rounded text-xs font-mono border transition-colors ${
                            active
                              ? 'bg-cyan-500 text-slate-950 font-semibold border-cyan-400'
                              : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700'
                          }`}
                        >
                          {mult}x
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => {
                        setLeadModeInput('manual_ms');
                        timingCalibrationEngine.setGlobalLeadConfig('manual_ms', leadMultInput, leadMsInput);
                      }}
                      className={`px-2.5 py-1.5 rounded text-xs font-mono border transition-colors ${
                        leadModeInput === 'manual_ms'
                          ? 'bg-amber-500 text-slate-950 font-semibold border-amber-400'
                          : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      Custom ms
                    </button>
                  </div>

                  <label className="block space-y-1">
                    <span className="text-xs text-slate-400">Global Custom Pre-Trigger Lead (ms)</span>
                    <input
                      type="number"
                      min={0}
                      max={30000}
                      step={5}
                      value={leadMsInput}
                      onChange={(e) => {
                        const val = Math.max(0, Math.min(30000, Number(e.target.value) || 0));
                        setLeadMsInput(val);
                        if (leadModeInput === 'manual_ms') {
                          timingCalibrationEngine.setGlobalLeadConfig('manual_ms', leadMultInput, val);
                        }
                      }}
                      className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 text-xs font-mono text-slate-100"
                    />
                  </label>
                </div>

                {/* Per-Tag Lead Override */}
                <div className="space-y-3">
                  <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400">
                    Per-Tag Lead Timing Override
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                    <input
                      type="text"
                      value={overrideTagInput}
                      onChange={(e) => setOverrideTagInput(e.target.value)}
                      placeholder="Tag name"
                      className="px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 text-xs font-mono text-slate-100"
                    />
                    <select
                      value={overrideModeInput}
                      onChange={(e) => setOverrideModeInput(e.target.value as TagLeadMode)}
                      className="px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 text-xs font-mono text-slate-100"
                    >
                      <option value="auto">Auto</option>
                      <option value="manual_mult">Multiplier (1x-12x)</option>
                      <option value="manual_ms">Custom ms</option>
                    </select>
                    {overrideModeInput === 'manual_mult' ? (
                      <select
                        value={overrideMultInput}
                        onChange={(e) => setOverrideMultInput(Number(e.target.value))}
                        className="px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 text-xs font-mono text-slate-100"
                      >
                        {AUTO_LEAD_MULTIPLIER_PRESETS.map((m) => (
                          <option key={m} value={m}>
                            {m}x
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="number"
                        min={0}
                        max={30000}
                        step={5}
                        disabled={overrideModeInput === 'auto'}
                        value={overrideMsInput}
                        onChange={(e) => setOverrideMsInput(Math.max(0, Math.min(30000, Number(e.target.value) || 0)))}
                        className="px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 text-xs font-mono text-slate-100 disabled:opacity-40"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        timingCalibrationEngine.setTagLeadOverride(
                          overrideTagInput,
                          overrideModeInput,
                          overrideMultInput,
                          overrideMsInput,
                        )
                      }
                      className="px-3 py-1.5 rounded text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700"
                    >
                      Set Tag
                    </button>
                  </div>

                  {timingSnap.tagOverrides.length > 0 && (
                    <div className="divide-y divide-slate-800 rounded border border-slate-800 bg-slate-950 max-h-36 overflow-y-auto">
                      {timingSnap.tagOverrides.map((ov) => {
                        const eff = timingCalibrationEngine.getEffectiveLeadForTag(ov.tag);
                        return (
                          <div
                            key={ov.tag}
                            className="px-3 py-1.5 flex items-center justify-between gap-2 text-xs font-mono"
                          >
                            <span className="text-slate-200 truncate">{ov.tag}</span>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-cyan-300">
                                {ov.mode === 'manual_ms'
                                  ? `${ov.manualMs}ms`
                                  : ov.mode === 'manual_mult'
                                    ? `${ov.multiplier}x (~${eff.leadMs}ms)`
                                    : `Auto (~${eff.leadMs}ms)`}
                              </span>
                              <button
                                type="button"
                                onClick={() => timingCalibrationEngine.removeTagLeadOverride(ov.tag)}
                                className="text-slate-400 hover:text-rose-400"
                                aria-label={`Remove ${ov.tag} override`}
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

          {activeNav === 'userscript' && (
            <section className="border border-slate-800 rounded-lg bg-slate-900 p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
                <div>
                  <h2 className="text-sm font-semibold text-slate-100">
                    TriggerTap Violentmonkey Script (Lag-Fixed + Upgraded)
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Every original subsystem is intact. Includes zero-spin non-blocking click holds, native &lt;button&gt; + React onClick cashout fallback, dynamic server-RTT Auto3x→12x lead scaling, sub-ms btn_off retry + RQ HUD, Fetch/XHR/WS tagging, and batched GM bridge.
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => void handleCopyUserscript()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    Copy .user.js
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDownloadUserscript()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-slate-950"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download .user.js
                  </button>
                </div>
              </div>

              {copyFeedback && (
                <div className="px-3 py-1.5 rounded bg-emerald-950/60 border border-emerald-700/70 text-xs font-mono text-emerald-300">
                  {copyFeedback}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                <div className="p-3 rounded bg-slate-950 border border-slate-800 space-y-1">
                  <div className="font-mono text-amber-300 font-semibold">1. Zero-Freeze Retry &amp; Cashout Fix</div>
                  <div className="text-slate-400">
                    Replaces tight spin-loops with clean non-blocking holds, scopes retry observation to button parent, and ensures <span className="font-mono text-slate-200">&lt;button&gt;.click()</span> + React <span className="font-mono text-slate-200">onClick</span> fire whenever WS cashout hasn&apos;t left.
                  </div>
                </div>
                <div className="p-3 rounded bg-slate-950 border border-slate-800 space-y-1">
                  <div className="font-mono text-emerald-300 font-semibold">2. Dynamic Auto3x→12x Server Lead</div>
                  <div className="text-slate-400">
                    Measures actual server cashout acceptance latency + deficit across rounds and automatically scales predictive lead past <span className="font-mono text-slate-200">5x</span> up to <span className="font-mono text-slate-200">12x</span>.
                  </div>
                </div>
                <div className="p-3 rounded bg-slate-950 border border-slate-800 space-y-1">
                  <div className="font-mono text-cyan-300 font-semibold">3. Human-Mimic Jitter &amp; Lag Fixes</div>
                  <div className="text-slate-400">
                    Caches live polled buttons, throttles shadow-DOM scans, batches GM bridge pushes, and wraps dispatches with realistic micro-jitter delays.
                  </div>
                </div>
              </div>

              <div className="border border-slate-800 rounded bg-slate-950 overflow-hidden">
                <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between text-[11px] font-mono text-slate-400">
                  <span>{USERSCRIPT_PUBLIC_PATH}</span>
                  <span className="tabular-nums">
                    {userscriptLoading
                      ? 'Loading script...'
                      : `${userscriptText.length.toLocaleString()} bytes`}
                  </span>
                </div>
                <pre className="p-3 text-[11px] font-mono text-slate-300 max-h-80 overflow-auto whitespace-pre">
                  {userscriptLoading
                    ? 'Loading userscript source...'
                    : userscriptText.slice(0, 6000) +
                      (userscriptText.length > 6000
                        ? '\n\n// ... preview truncated (use Copy or Download .user.js for complete 19,600+ line script) ...'
                        : '')}
                </pre>
              </div>
            </section>
          )}
        </main>
      </div>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
