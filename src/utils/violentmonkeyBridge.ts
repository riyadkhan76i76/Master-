import {
  inspectCashoutButtonState,
  timingCalibrationEngine,
  type CashoutButtonState,
  type TimingCalibrationEngine,
} from './timingEngine';

export type StreamTransport = 'WS' | 'FETCH' | 'XHR' | 'DOM' | 'VM-BRIDGE';

export type TelemetrySource =
  | 'WS-IN'
  | 'WS-OUT'
  | 'FETCH-REQ'
  | 'FETCH-RES'
  | 'XHR-REQ'
  | 'XHR-RES'
  | 'API-REQ'
  | 'API-RES'
  | 'TAP-RES'
  | 'CSS-STATE'
  | 'JS-HOOK'
  | 'DOM-TAG'
  | 'CLICK'
  | 'RETRY';

export interface ConsolidatedTelemetryEvent {
  uid: string;
  transport: StreamTransport;
  src: TelemetrySource | string;
  direction: 'IN' | 'OUT' | 'DOM' | 'SYS';
  method?: string;
  url?: string;
  status?: number;
  durationMs?: number;
  matched: boolean;
  matchedTag?: string;
  inspectorMatched?: boolean;
  reasons?: string[];
  heldMs?: number;
  retryQueueDepth?: number;
  text: string;
  time: string;
  monoMs: number;
}

export interface BatcherMetrics {
  batchIntervalMs: number;
  totalIngested: number;
  totalFlushes: number;
  coalescedFramesSaved: number;
  droppedOverflow: number;
  pendingCount: number;
  avgBatchSize: number;
  lastFlushDurationMs: number;
  effectiveUiHz: number;
}

export interface HumanMimicJitterConfig {
  enabled: boolean;
  autoScale?: boolean;
  preHoverJitterMinMs: number;
  preHoverJitterMaxMs: number;
  holdDurationMinMs: number;
  holdDurationMaxMs: number;
  postUpJitterMinMs: number;
  postUpJitterMaxMs: number;
  minFlightReactionMs?: number;
  coordinateJitterPx: number;
  retryOnBtnOff: boolean;
  maxBtnOffRetryMs: number;
  maxBtnOffAttempts: number;
}

export interface DispatchPhaseTrace {
  phase:
    | 'INSPECT'
    | 'RETRY_QUEUE_WAIT'
    | 'POINTER_HOVER'
    | 'PRE_DOWN_JITTER'
    | 'POINTER_DOWN'
    | 'HUMAN_HOLD_JITTER'
    | 'POINTER_UP'
    | 'POST_UP_JITTER'
    | 'CLICK_COMPLETE';
  atMonoMs: number;
  deltaFromPrevMs: number;
  detail: string;
}

export interface HumanMimicClickResult {
  dispatched: boolean;
  recoveredFromBtnOff: boolean;
  retriesUsed: number;
  buttonStateBefore: CashoutButtonState;
  buttonStateAfter: CashoutButtonState;
  clickX: number;
  clickY: number;
  totalDispatchMs: number;
  preJitterMs: number;
  holdJitterMs: number;
  postJitterMs: number;
  traces: DispatchPhaseTrace[];
  error?: string;
}

export interface BridgeStateSnapshot {
  roomId: string;
  gmBridgeReady: boolean;
  userscriptVersion: string;
  userscriptOrigin: string;
  interceptorsActive: boolean;
  lastHeartbeatAt: number;
  events: ConsolidatedTelemetryEvent[];
  totalByTransport: Record<StreamTransport, number>;
  batcher: BatcherMetrics;
  lastClickResult: HumanMimicClickResult | null;
}

const DEFAULT_JITTER_CONFIG: HumanMimicJitterConfig = {
  enabled: true,
  autoScale: true,
  preHoverJitterMinMs: 5.5,
  preHoverJitterMaxMs: 15.0,
  holdDurationMinMs: 16.0,
  holdDurationMaxMs: 36.0,
  postUpJitterMinMs: 1.0,
  postUpJitterMaxMs: 3.5,
  minFlightReactionMs: 125,
  coordinateJitterPx: 4.0,
  retryOnBtnOff: true,
  maxBtnOffRetryMs: 600,
  maxBtnOffAttempts: 300,
};

function nowMono(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function fmtClockMs(): string {
  const d = new Date();
  return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

function triangularRandom(min: number, max: number): number {
  if (max <= min) return min;
  const u = (Math.random() + Math.random()) * 0.5;
  return min + u * (max - min);
}

/**
 * Sub-millisecond / low-overhead micro-wait using MessageChannel when delay < 4ms,
 * preventing timer clamping while keeping browser event queue yields natural.
 */
export function waitHumanJitterMs(ms: number): Promise<number> {
  if (ms <= 0.05) return Promise.resolve(0);
  const start = nowMono();

  if (ms < 1.5 && typeof MessageChannel === 'function') {
    return new Promise((resolve) => {
      const ch = new MessageChannel();
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(safety);
        try {
          ch.port1.onmessage = null;
          ch.port1.close();
          ch.port2.close();
        } catch {
          // ignore
        }
        resolve(Number((nowMono() - start).toFixed(3)));
      };
      const safety = setTimeout(done, 4);
      // Single clean macrotask yield (never spin-loop)
      ch.port1.onmessage = done;
      ch.port2.postMessage(null);
    });
  }

  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(Number((nowMono() - start).toFixed(3)));
    }, Math.max(1, Math.round(ms)));
  });
}

function inferTransport(src: string, rawUrl?: string): StreamTransport {
  const s = src.toUpperCase();
  if (s.startsWith('WS') || s === 'SSE' || s === 'WORKER' || s === 'TAP-RTC' || s === 'TAP-WT' || s === 'TAP-PM') {
    return 'WS';
  }
  if (s.startsWith('FETCH')) return 'FETCH';
  if (s.startsWith('XHR')) return 'XHR';
  if (s === 'API-REQ' || s === 'API-RES' || s === 'TAP-RES' || s === 'TAP-NET') {
    if (rawUrl && /xhr/i.test(rawUrl)) return 'XHR';
    return 'FETCH';
  }
  if (s === 'CSS-STATE' || s === 'JS-HOOK' || s === 'DOM-TAG' || s === 'DOC-TAG' || s === 'SMS/DOM') {
    return 'DOM';
  }
  return 'VM-BRIDGE';
}

function inferDirection(src: string): 'IN' | 'OUT' | 'DOM' | 'SYS' {
  const s = src.toUpperCase();
  if (s.endsWith('-OUT') || s.endsWith('-REQ') || s === 'CLICK') return 'OUT';
  if (s.startsWith('CSS') || s.startsWith('DOM') || s.startsWith('JS') || s.startsWith('DOC') || s === 'SMS/DOM') {
    return 'DOM';
  }
  if (s === 'RETRY' || s === 'LATENCY') return 'SYS';
  return 'IN';
}

function isStaticOrInternalUrl(url: string): boolean {
  const lc = url.toLowerCase();
  if (!lc) return false;
  if (
    lc.includes('broker.emqx.io') ||
    lc.includes('broker.hivemq.com') ||
    lc.includes('test.mosquitto.org') ||
    lc.includes('/api/relay/') ||
    lc.startsWith('data:') ||
    lc.startsWith('blob:')
  ) {
    return true;
  }
  const path = lc.split('?')[0].split('#')[0];
  return /\.(?:m?js|css|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|mp3|mp4|webm|wasm|map)$/i.test(path);
}

/**
 * ViolentmonkeyBridge
 * - Connects to Violentmonkey userscript GM bridge events
 * - Taps WebSocket, Fetch, and XMLHttpRequest responses into one consolidated telemetry feed
 * - Batches state updates to prevent React UI frame drops during heavy traffic
 * - Dispatches clicks via a human-mimic jitter sequence integrated with TimingCalibrationEngine
 */
export class ViolentmonkeyBridge {
  private roomId = 'TT-2026';
  private gmBridgeReady = false;
  private userscriptVersion = '';
  private userscriptOrigin = '';
  private lastHeartbeatAt = 0;

  private events: ConsolidatedTelemetryEvent[] = [];
  private pendingQueue: ConsolidatedTelemetryEvent[] = [];
  private seenUids = new Set<string>();
  private maxEvents = 320;
  private maxPendingQueue = 600;
  private batchIntervalMs = 50; // ~20Hz React flush ceiling -> zero UI frame drops
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private rafScheduled = false;

  private totalByTransport: Record<StreamTransport, number> = {
    WS: 0,
    FETCH: 0,
    XHR: 0,
    DOM: 0,
    'VM-BRIDGE': 0,
  };

  private totalIngested = 0;
  private totalFlushes = 0;
  private coalescedFramesSaved = 0;
  private droppedOverflow = 0;
  private batchSizeSum = 0;
  private lastFlushDurationMs = 0;
  private lastFlushAt = 0;
  private effectiveUiHz = 0;

  private interceptorsActive = false;
  private restoreFns: Array<() => void> = [];
  private bridgeListenersAttached = false;
  private bridgeCleanupFns: Array<() => void> = [];

  private jitterConfig: HumanMimicJitterConfig = { ...DEFAULT_JITTER_CONFIG };
  private lastClickResult: HumanMimicClickResult | null = null;
  private lastClickCoords: { x: number; y: number } | null = null;
  private subscribers = new Set<(snap: BridgeStateSnapshot) => void>();
  private seq = 0;
  private timingEngine: TimingCalibrationEngine;

  constructor(engine: TimingCalibrationEngine = timingCalibrationEngine) {
    this.timingEngine = engine;
  }

  public subscribe(listener: (snap: BridgeStateSnapshot) => void): () => void {
    this.subscribers.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.subscribers.delete(listener);
    };
  }

  private emitSnapshot(): void {
    const snap = this.getSnapshot();
    for (const sub of this.subscribers) {
      try {
        sub(snap);
      } catch {
        // ignore subscriber errors
      }
    }
  }

  public getSnapshot(): BridgeStateSnapshot {
    return {
      roomId: this.roomId,
      gmBridgeReady: this.gmBridgeReady,
      userscriptVersion: this.userscriptVersion,
      userscriptOrigin: this.userscriptOrigin,
      interceptorsActive: this.interceptorsActive,
      lastHeartbeatAt: this.lastHeartbeatAt,
      events: this.events,
      totalByTransport: { ...this.totalByTransport },
      batcher: {
        batchIntervalMs: this.batchIntervalMs,
        totalIngested: this.totalIngested,
        totalFlushes: this.totalFlushes,
        coalescedFramesSaved: this.coalescedFramesSaved,
        droppedOverflow: this.droppedOverflow,
        pendingCount: this.pendingQueue.length,
        avgBatchSize:
          this.totalFlushes > 0 ? Number((this.batchSizeSum / this.totalFlushes).toFixed(1)) : 0,
        lastFlushDurationMs: Number(this.lastFlushDurationMs.toFixed(3)),
        effectiveUiHz: Number(this.effectiveUiHz.toFixed(1)),
      },
      lastClickResult: this.lastClickResult,
    };
  }

  public setBatchIntervalMs(ms: number): void {
    this.batchIntervalMs = Math.max(16, Math.min(250, Math.round(ms)));
    this.emitSnapshot();
  }

  public setJitterConfig(patch: Partial<HumanMimicJitterConfig>): void {
    this.jitterConfig = { ...this.jitterConfig, ...patch };
  }

  public getJitterConfig(): HumanMimicJitterConfig {
    return { ...this.jitterConfig };
  }

  public setRoomId(nextRoom: string): void {
    const clean = nextRoom.trim() || 'TT-2026';
    if (clean === this.roomId) return;
    this.roomId = clean;
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.triggertapRoom = clean;
    }
    this.pullFromUserscript(clean);
    this.emitSnapshot();
  }

  /**
   * High-throughput batching pipeline:
   * Events are buffered in `pendingQueue` without triggering React renders per packet,
   * then coalesced into a single frame-aligned state emission.
   */
  public ingestTelemetry(raw: Partial<ConsolidatedTelemetryEvent> & { text: string; src: string }): void {
    const uid = raw.uid || `loc_${++this.seq}_${Date.now().toString(36)}`;
    if (this.seenUids.has(uid)) return;
    this.seenUids.add(uid);
    if (this.seenUids.size > 1200) {
      const oldest = this.seenUids.values().next().value;
      if (oldest !== undefined) this.seenUids.delete(oldest);
    }

    const transport = raw.transport || inferTransport(raw.src, raw.url);
    const direction = raw.direction || inferDirection(raw.src);

    const item: ConsolidatedTelemetryEvent = {
      uid,
      transport,
      src: raw.src,
      direction,
      method: raw.method,
      url: raw.url,
      status: raw.status,
      durationMs: raw.durationMs,
      matched: Boolean(raw.matched),
      matchedTag: raw.matchedTag,
      inspectorMatched: Boolean(raw.inspectorMatched),
      reasons: raw.reasons,
      heldMs: raw.heldMs,
      retryQueueDepth: raw.retryQueueDepth,
      text: String(raw.text || '').slice(0, 4000),
      time: raw.time || fmtClockMs(),
      monoMs: typeof raw.monoMs === 'number' ? raw.monoMs : Number(nowMono().toFixed(2)),
    };

    if (typeof item.retryQueueDepth === 'number') {
      this.timingEngine.setExternalRetryQueueDepth(item.retryQueueDepth);
    }

    this.totalIngested += 1;
    this.totalByTransport[transport] = (this.totalByTransport[transport] || 0) + 1;

    if (this.pendingQueue.length >= this.maxPendingQueue) {
      this.pendingQueue.shift();
      this.droppedOverflow += 1;
    }
    this.pendingQueue.push(item);
    this.scheduleBatchFlush();
  }

  private scheduleBatchFlush(): void {
    if (this.flushTimer !== null || this.rafScheduled) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      if (typeof requestAnimationFrame === 'function') {
        this.rafScheduled = true;
        requestAnimationFrame(() => {
          this.rafScheduled = false;
          this.flushPendingBatch();
        });
      } else {
        this.flushPendingBatch();
      }
    }, this.batchIntervalMs);
  }

  public flushPendingBatch(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.rafScheduled = false;
    if (!this.pendingQueue.length) return;

    const flushStart = nowMono();
    const drained = this.pendingQueue.splice(0, this.pendingQueue.length);
    const batchLen = drained.length;

    if (batchLen > 1) {
      this.coalescedFramesSaved += batchLen - 1;
    }
    this.totalFlushes += 1;
    this.batchSizeSum += batchLen;

    // Prepend newest events in reverse order cleanly without N array copies
    const nextList = drained.reverse().concat(this.events);
    if (nextList.length > this.maxEvents) {
      nextList.length = this.maxEvents;
    }
    this.events = nextList;

    const now = nowMono();
    if (this.lastFlushAt > 0) {
      const dt = Math.max(1, now - this.lastFlushAt);
      const instHz = 1000 / dt;
      this.effectiveUiHz = this.effectiveUiHz === 0 ? instHz : this.effectiveUiHz * 0.75 + instHz * 0.25;
    }
    this.lastFlushAt = now;
    this.lastFlushDurationMs = now - flushStart;
    this.emitSnapshot();
  }

  public clearEvents(): void {
    this.events = [];
    this.pendingQueue = [];
    this.seenUids.clear();
    this.totalByTransport = { WS: 0, FETCH: 0, XHR: 0, DOM: 0, 'VM-BRIDGE': 0 };
    this.totalIngested = 0;
    this.totalFlushes = 0;
    this.coalescedFramesSaved = 0;
    this.droppedOverflow = 0;
    this.batchSizeSum = 0;
    this.effectiveUiHz = 0;
    this.emitSnapshot();
  }

  /**
   * Connects the Relay Monitor to the Violentmonkey userscript GM bridge
   */
  public connectGMBridge(): () => void {
    if (this.bridgeListenersAttached || typeof window === 'undefined') {
      return () => {};
    }
    this.bridgeListenersAttached = true;

    document.documentElement.dataset.triggertapApp = '1';
    document.documentElement.dataset.triggertapRoom = this.roomId;

    const handleReadyDetail = (raw: unknown) => {
      try {
        const d = typeof raw === 'string' ? JSON.parse(raw) : (raw as Record<string, unknown>);
        if (!d || typeof d !== 'object') return;
        this.gmBridgeReady = true;
        if (typeof d.version === 'string') this.userscriptVersion = d.version;
        if (typeof d.origin === 'string') this.userscriptOrigin = d.origin;
        this.lastHeartbeatAt = Date.now();
        this.emitSnapshot();
      } catch {
        // ignore
      }
    };

    const handleBridgeBatch = (raw: unknown) => {
      try {
        const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!Array.isArray(arr)) return;
        this.gmBridgeReady = true;
        this.lastHeartbeatAt = Date.now();
        for (const ev of arr) {
          if (!ev || typeof ev !== 'object') continue;
          const rec = ev as Record<string, unknown>;
          const src = String(rec.src || 'WS-IN');
          const text = String(rec.text || '');
          const transportHeader = typeof rec.transport === 'string' ? (rec.transport as StreamTransport) : undefined;
          if (src === 'HUMAN_AUTO' || src === 'LATENCY') {
            try {
              const parsed = JSON.parse(text) as Record<string, unknown>;
              if (parsed && parsed.event === 'AUTO_HUMAN_PROFILE') {
                this.timingEngine.applyExternalAutoHumanProfile({
                  enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : true,
                  preDownMinMs: typeof parsed.preMin === 'number' ? parsed.preMin : undefined,
                  preDownMaxMs: typeof parsed.preMax === 'number' ? parsed.preMax : undefined,
                  holdMinMs: typeof parsed.holdMin === 'number' ? parsed.holdMin : undefined,
                  holdMaxMs: typeof parsed.holdMax === 'number' ? parsed.holdMax : undefined,
                  postUpMinMs: typeof parsed.postMin === 'number' ? parsed.postMin : undefined,
                  postUpMaxMs: typeof parsed.postMax === 'number' ? parsed.postMax : undefined,
                  minFlightReactionMs: typeof parsed.minFlightMs === 'number' ? parsed.minFlightMs : undefined,
                  coordinateJitterPx: typeof parsed.coordPx === 'number' ? parsed.coordPx : undefined,
                  acceptStreak: typeof parsed.acceptStreak === 'number' ? parsed.acceptStreak : undefined,
                  rejectCount: typeof parsed.rejectCount === 'number' ? parsed.rejectCount : undefined,
                  avgHumanSpanMs: typeof parsed.avgSpanMs === 'number' ? parsed.avgSpanMs : undefined,
                  lastAdaptationReason: typeof parsed.reason === 'string' ? parsed.reason : undefined,
                });
              } else if (parsed && parsed.event === 'FRAME_TO_CASHOUT') {
                if (parsed.status === 'REJECTED') {
                  const errStr = String(parsed.serverVerdict || '');
                  const isRateLimit = /limit|spam|frequent|cooldown|wait/i.test(errStr);
                  this.timingEngine.recordServerClickFeedback({
                    outcome: isRateLimit ? 'RATE_LIMITED' : 'BOT_REJECTED',
                    serverRttMs: typeof parsed.serverRttMs === 'number' ? parsed.serverRttMs : undefined,
                    errText: errStr,
                  });
                } else if (parsed.status === 'CASHED' || parsed.status === 'ACCEPTED') {
                  this.timingEngine.recordServerClickFeedback({
                    outcome: 'ACCEPTED',
                    serverRttMs: typeof parsed.serverRttMs === 'number' ? parsed.serverRttMs : undefined,
                  });
                }
              }
            } catch {
              // ignore non-json telemetry
            }
          }
          this.ingestTelemetry({
            uid: typeof rec.uid === 'string' ? rec.uid : undefined,
            transport: transportHeader || inferTransport(src, text),
            src,
            direction: (rec.direction as 'IN' | 'OUT' | 'DOM' | 'SYS') || undefined,
            matched: Boolean(rec.matched),
            matchedTag: typeof rec.matchedTag === 'string' ? rec.matchedTag : undefined,
            inspectorMatched: Boolean(rec.inspectorMatched),
            reasons: Array.isArray(rec.reasons) ? (rec.reasons as string[]) : undefined,
            heldMs: typeof rec.heldMs === 'number' ? rec.heldMs : undefined,
            retryQueueDepth: typeof rec.retryQueueDepth === 'number' ? rec.retryQueueDepth : undefined,
            text,
            time: typeof rec.time === 'string' ? rec.time : undefined,
            monoMs: typeof rec.monoMs === 'number' ? rec.monoMs : undefined,
          });
        }
      } catch {
        // ignore
      }
    };

    const onGmReadyEv = (ev: Event) => handleReadyDetail((ev as CustomEvent).detail);
    const onGmBridgeEv = (ev: Event) => handleBridgeBatch((ev as CustomEvent).detail);
    const onRetryDepthEv = (ev: Event) => {
      try {
        const d = typeof (ev as CustomEvent).detail === 'string'
          ? JSON.parse((ev as CustomEvent).detail)
          : (ev as CustomEvent).detail;
        if (d && typeof d.depth === 'number') {
          this.timingEngine.setExternalRetryQueueDepth(d.depth);
        }
      } catch {
        // ignore
      }
    };

    const onWindowMessage = (ev: MessageEvent) => {
      const d = ev.data;
      if (!d || typeof d !== 'object') return;
      if (d.__tt_gm_ready) {
        handleReadyDetail(d);
      } else if (d.__tt_gm_msg && Array.isArray(d.events)) {
        handleBridgeBatch(d.events);
      } else if (d.__tt_retry_queue && typeof d.depth === 'number') {
        this.timingEngine.setExternalRetryQueueDepth(d.depth);
      }
    };

    window.addEventListener('__triggertap_gm_ready__', onGmReadyEv);
    document.addEventListener('__triggertap_gm_ready__', onGmReadyEv);
    window.addEventListener('__triggertap_bridge__', onGmBridgeEv);
    document.addEventListener('__triggertap_bridge__', onGmBridgeEv);
    window.addEventListener('__triggertap_retry_queue__', onRetryDepthEv);
    document.addEventListener('__triggertap_retry_queue__', onRetryDepthEv);
    window.addEventListener('message', onWindowMessage);

    // Check if userscript already flagged GM bridge before React mounted
    const winAny = window as unknown as Record<string, unknown>;
    if (winAny.__TRIGGERTAP_GM_BRIDGE__ || document.documentElement.dataset.triggertapGmBridge === '1') {
      this.gmBridgeReady = true;
      this.lastHeartbeatAt = Date.now();
    }

    this.pullFromUserscript(this.roomId);
    this.emitSnapshot();

    const cleanup = () => {
      window.removeEventListener('__triggertap_gm_ready__', onGmReadyEv);
      document.removeEventListener('__triggertap_gm_ready__', onGmReadyEv);
      window.removeEventListener('__triggertap_bridge__', onGmBridgeEv);
      document.removeEventListener('__triggertap_bridge__', onGmBridgeEv);
      window.removeEventListener('__triggertap_retry_queue__', onRetryDepthEv);
      document.removeEventListener('__triggertap_retry_queue__', onRetryDepthEv);
      window.removeEventListener('message', onWindowMessage);
      this.bridgeListenersAttached = false;
    };
    this.bridgeCleanupFns.push(cleanup);
    return cleanup;
  }

  public pullFromUserscript(roomId = this.roomId): void {
    if (typeof window === 'undefined') return;
    const payload = JSON.stringify({ roomId });
    window.dispatchEvent(new CustomEvent('__triggertap_pull__', { detail: payload }));
    document.dispatchEvent(new CustomEvent('__triggertap_pull__', { detail: payload }));
    window.postMessage({ __tt_dash_pull: true, roomId }, '*');
  }

  public pushConfigToUserscript(cfg: Record<string, unknown>, roomId = this.roomId): void {
    if (typeof window === 'undefined') return;
    const payload = JSON.stringify({ roomId, cfg });
    window.dispatchEvent(new CustomEvent('__triggertap_push_cfg__', { detail: payload }));
    document.dispatchEvent(new CustomEvent('__triggertap_push_cfg__', { detail: payload }));
    window.postMessage({ __tt_dash_push_cfg: true, roomId, cfg }, '*');
  }

  /**
   * Installs consolidated WebSocket + Fetch + XMLHttpRequest interception
   * so all game telemetry is captured seamlessly into the batched Relay Monitor stream.
   */
  public installTelemetryInterceptors(): () => void {
    if (this.interceptorsActive || typeof window === 'undefined') {
      return () => {};
    }
    this.interceptorsActive = true;
    const self = this;
    const restorers: Array<() => void> = [];

    const safePatchProp = <T extends object, K extends keyof T>(
      target: T,
      prop: K,
      nextValue: T[K],
    ): (() => void) | null => {
      try {
        const ownDesc = Object.getOwnPropertyDescriptor(target, prop);
        const proto = Object.getPrototypeOf(target);
        const protoDesc = !ownDesc && proto ? Object.getOwnPropertyDescriptor(proto, prop) : undefined;
        const effectiveDesc = ownDesc || protoDesc;

        // If getter-only & non-configurable on target itself, see if direct assignment works or bail safely
        if (ownDesc && !ownDesc.configurable) {
          if (ownDesc.writable) {
            const prev = target[prop];
            target[prop] = nextValue;
            return () => {
              try {
                target[prop] = prev;
              } catch {
                // ignore
              }
            };
          }
          return null;
        }

        // Configurable own property OR inherited from prototype -> define safely as own property
        if (!ownDesc || ownDesc.configurable) {
          Object.defineProperty(target, prop, {
            value: nextValue,
            writable: true,
            configurable: true,
            enumerable: effectiveDesc ? Boolean(effectiveDesc.enumerable) : true,
          });
          return () => {
            try {
              if (ownDesc) {
                Object.defineProperty(target, prop, ownDesc);
              } else {
                delete (target as Record<PropertyKey, unknown>)[prop];
              }
            } catch {
              // ignore
            }
          };
        }
      } catch {
        // Fallback: try direct assignment inside try/catch
        try {
          const prev = target[prop];
          target[prop] = nextValue;
          return () => {
            try {
              target[prop] = prev;
            } catch {
              // ignore
            }
          };
        } catch {
          return null;
        }
      }
      return null;
    };

    // 1. Fetch Interception (Request + Cloned Response)
    try {
      if (typeof window.fetch === 'function') {
        const origFetch = window.fetch.bind(window);
        const wrappedFetch: typeof window.fetch = async (input, init) => {
          const urlStr =
            typeof input === 'string'
              ? input
              : input instanceof Request
                ? input.url
                : String((input as URL)?.href || input || '');
          if (isStaticOrInternalUrl(urlStr)) {
            return origFetch(input, init);
          }

          const method = String(
            init?.method || (input instanceof Request ? input.method : 'GET'),
          ).toUpperCase();
          const t0 = nowMono();

          let reqPreview = `${method} ${urlStr}`;
          if (init?.body != null && typeof init.body === 'string') {
            reqPreview += `\n${init.body.slice(0, 1200)}`;
          }
          self.ingestTelemetry({
            transport: 'FETCH',
            src: 'FETCH-REQ',
            direction: 'OUT',
            method,
            url: urlStr,
            text: reqPreview,
          });

          const res = await origFetch(input, init);
          const durationMs = Number((nowMono() - t0).toFixed(2));
          try {
            if (res.body && !res.bodyUsed && res.type !== 'opaque') {
              const ct = (res.headers.get('content-type') || '').toLowerCase();
              if (!ct.startsWith('image/') && !ct.startsWith('audio/') && !ct.startsWith('video/')) {
                const cloned = res.clone();
                cloned
                  .text()
                  .then((bodyTxt) => {
                    self.ingestTelemetry({
                      transport: 'FETCH',
                      src: 'FETCH-RES',
                      direction: 'IN',
                      method,
                      url: res.url || urlStr,
                      status: res.status,
                      durationMs,
                      text: `${res.status} ${method} ${res.url || urlStr}\n${bodyTxt.slice(0, 2400)}`,
                    });
                  })
                  .catch(() => {
                    // Ignore stream read errors on aborted clones
                  });
              }
            }
          } catch {
            // Never interfere with caller response
          }
          return res;
        };
        const restoreFetch = safePatchProp(window, 'fetch', wrappedFetch);
        if (restoreFetch) {
          restorers.push(restoreFetch);
        } else {
          let protoHooked = false;
          if (typeof Window !== 'undefined' && Window.prototype) {
            const restoreProtoFetch = safePatchProp(Window.prototype, 'fetch', wrappedFetch);
            if (restoreProtoFetch) {
              restorers.push(restoreProtoFetch);
              protoHooked = true;
            }
          }
          if (!protoHooked && typeof PerformanceObserver === 'function') {
            try {
              const po = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                  const resEntry = entry as PerformanceResourceTiming;
                  if (resEntry.initiatorType !== 'fetch') continue;
                  const urlStr = resEntry.name || '';
                  if (isStaticOrInternalUrl(urlStr)) continue;
                  self.ingestTelemetry({
                    transport: 'FETCH',
                    src: 'FETCH-RES',
                    direction: 'IN',
                    method: 'FETCH',
                    url: urlStr,
                    status: resEntry.responseStatus || 200,
                    durationMs: Number((resEntry.duration || 0).toFixed(2)),
                    text: `${resEntry.responseStatus || 200} FETCH ${urlStr}`,
                  });
                }
              });
              po.observe({ type: 'resource', buffered: false });
              restorers.push(() => po.disconnect());
            } catch {
              // ignore unsupported resource observer
            }
          }
        }
      }
    } catch {
      // Ignore if sandbox prevents fetch hooking
    }

    // 2. XMLHttpRequest Interception (open + send + load response)
    try {
      if (typeof window.XMLHttpRequest === 'function' && window.XMLHttpRequest.prototype) {
        const xp = window.XMLHttpRequest.prototype;
        const origOpen = xp.open;
        const origSend = xp.send;

        type TrackedXhr = XMLHttpRequest & {
          __ttMethod?: string;
          __ttUrl?: string;
          __ttStartMono?: number;
          __ttHooked?: boolean;
        };

        const patchedOpen: typeof xp.open = function (
          this: TrackedXhr,
          method: string,
          url: string | URL,
        ) {
          this.__ttMethod = String(method || 'GET').toUpperCase();
          this.__ttUrl = String(url || '');
          return origOpen.apply(this, arguments as unknown as Parameters<typeof origOpen>);
        };

        const patchedSend: typeof xp.send = function (
          this: TrackedXhr,
          body?: Document | XMLHttpRequestBodyInit | null,
        ) {
          const urlStr = this.__ttUrl || '';
          const method = this.__ttMethod || 'GET';
          if (isStaticOrInternalUrl(urlStr)) {
            return origSend.apply(this, arguments as unknown as Parameters<typeof origSend>);
          }

          this.__ttStartMono = nowMono();
          const bodyPreview = typeof body === 'string' ? `\n${body.slice(0, 1200)}` : '';
          self.ingestTelemetry({
            transport: 'XHR',
            src: 'XHR-REQ',
            direction: 'OUT',
            method,
            url: urlStr,
            text: `${method} ${urlStr}${bodyPreview}`,
          });

          if (!this.__ttHooked) {
            this.__ttHooked = true;
            this.addEventListener('load', () => {
              const durationMs = Number((nowMono() - (this.__ttStartMono || nowMono())).toFixed(2));
              let resPreview = '';
              try {
                if (this.responseType === '' || this.responseType === 'text') {
                  resPreview = this.responseText || '';
                } else if (this.responseType === 'json' && this.response != null) {
                  resPreview = JSON.stringify(this.response);
                } else if (this.response instanceof ArrayBuffer) {
                  resPreview = `<ArrayBuffer ${this.response.byteLength}B>`;
                }
              } catch {
                resPreview = '';
              }
              const finalUrl = this.responseURL || urlStr;
              self.ingestTelemetry({
                transport: 'XHR',
                src: 'XHR-RES',
                direction: 'IN',
                method,
                url: finalUrl,
                status: this.status,
                durationMs,
                text: `${this.status} ${method} ${finalUrl}${resPreview ? `\n${resPreview.slice(0, 2400)}` : ''}`,
              });
            });
          }

          return origSend.apply(this, arguments as unknown as Parameters<typeof origSend>);
        };

        const restoreOpen = safePatchProp(xp, 'open', patchedOpen);
        const restoreSend = safePatchProp(xp, 'send', patchedSend);
        if (restoreOpen) restorers.push(restoreOpen);
        if (restoreSend) restorers.push(restoreSend);
      }
    } catch {
      // Ignore if XHR prototype is sealed
    }

    // 3. WebSocket Interception (WS-OUT send + WS-IN message)
    try {
      if (typeof window.WebSocket === 'function') {
        const OrigWS = window.WebSocket;
        const origSend = OrigWS.prototype.send;
        const attachedSockets = new WeakSet<WebSocket>();

        const attachWs = (ws: WebSocket) => {
          if (attachedSockets.has(ws) || isStaticOrInternalUrl(ws.url || '')) return;
          attachedSockets.add(ws);
          ws.addEventListener('message', (ev: MessageEvent) => {
            const preview =
              typeof ev.data === 'string'
                ? ev.data.slice(0, 2400)
                : ev.data instanceof ArrayBuffer
                  ? `<WS Binary ${ev.data.byteLength}B>`
                  : String(ev.data || '').slice(0, 800);
            self.ingestTelemetry({
              transport: 'WS',
              src: 'WS-IN',
              direction: 'IN',
              url: ws.url,
              text: preview,
            });
          });
        };

        const patchedWsSend: typeof OrigWS.prototype.send = function (this: WebSocket, data) {
          attachWs(this);
          if (!isStaticOrInternalUrl(this.url || '')) {
            const preview =
              typeof data === 'string'
                ? data.slice(0, 1200)
                : data instanceof ArrayBuffer
                  ? `<WS Out ${data.byteLength}B>`
                  : '<WS Out Binary>';
            self.ingestTelemetry({
              transport: 'WS',
              src: 'WS-OUT',
              direction: 'OUT',
              url: this.url,
              text: preview,
            });
          }
          return origSend.call(this, data);
        };

        const restoreWsSend = safePatchProp(OrigWS.prototype, 'send', patchedWsSend);
        if (restoreWsSend) restorers.push(restoreWsSend);

        const WrappedWS = new Proxy(OrigWS, {
          construct(target, args, newTarget) {
            const ws = Reflect.construct(target, args, newTarget || target) as WebSocket;
            attachWs(ws);
            return ws;
          },
        });
        const restoreWs = safePatchProp(window, 'WebSocket', WrappedWS);
        if (restoreWs) restorers.push(restoreWs);
      }
    } catch {
      // Ignore if WebSocket is non-configurable
    }

    this.restoreFns = restorers;
    this.emitSnapshot();

    return () => {
      this.uninstallTelemetryInterceptors();
    };
  }

  public uninstallTelemetryInterceptors(): void {
    for (const fn of this.restoreFns) {
      try {
        fn();
      } catch {
        // ignore
      }
    }
    this.restoreFns = [];
    this.interceptorsActive = false;
    this.emitSnapshot();
  }

  /**
   * Human-Mimic / Jitter Click Dispatch Wrapper
   * Wraps pointerover -> pointerenter -> pointermove -> mouseover -> mousemove
   * -> [pre-down jitter] -> pointerdown -> touchstart -> [human hold jitter]
   * -> pointerup -> touchend -> mousedown -> mouseup -> [post-up jitter] -> click
   * -> pointerout / pointerleave.
   *
   * Automatically invokes TimingCalibrationEngine's sub-millisecond recursive retry
   * queue if the cashout button is disabled / `btn_off`, preventing wasted triggers
   * and server-side rate-limiter rejections.
   */
  public async dispatchHumanMimicClick(
    targetOrResolver: HTMLElement | null | (() => HTMLElement | null),
    opts?: {
      tag?: string;
      flightAgeMs?: number;
      jitter?: Partial<HumanMimicJitterConfig>;
    },
  ): Promise<HumanMimicClickResult> {
    const startMono = nowMono();
    const autoProf = this.timingEngine.getAutoHumanProfile();
    const shouldAutoScale = (opts?.jitter?.autoScale ?? this.jitterConfig.autoScale) !== false && autoProf.enabled;
    const cfg: HumanMimicJitterConfig = {
      ...this.jitterConfig,
      ...(shouldAutoScale && !opts?.jitter
        ? {
            preHoverJitterMinMs: autoProf.preDownMinMs,
            preHoverJitterMaxMs: autoProf.preDownMaxMs,
            holdDurationMinMs: autoProf.holdMinMs,
            holdDurationMaxMs: autoProf.holdMaxMs,
            postUpJitterMinMs: autoProf.postUpMinMs,
            postUpJitterMaxMs: autoProf.postUpMaxMs,
            minFlightReactionMs: autoProf.minFlightReactionMs,
            coordinateJitterPx: autoProf.coordinateJitterPx,
          }
        : {}),
      ...(opts?.jitter || {}),
    };
    const tag = opts?.tag || 'CASHOUT';
    const resolveEl =
      typeof targetOrResolver === 'function' ? targetOrResolver : () => targetOrResolver;

    const traces: DispatchPhaseTrace[] = [];
    let lastTraceMono = startMono;
    const recordTrace = (phase: DispatchPhaseTrace['phase'], detail: string) => {
      const now = nowMono();
      traces.push({
        phase,
        atMonoMs: Number((now - startMono).toFixed(3)),
        deltaFromPrevMs: Number((now - lastTraceMono).toFixed(3)),
        detail,
      });
      lastTraceMono = now;
    };

    let el = resolveEl();
    const initialInsp = inspectCashoutButtonState(el);
    recordTrace('INSPECT', `Initial state=${initialInsp.state} ("${initialInsp.text}")`);

    let recoveredFromBtnOff = false;
    let retriesUsed = 0;

    if (!initialInsp.isReady) {
      if (!cfg.retryOnBtnOff) {
        const failedRes: HumanMimicClickResult = {
          dispatched: false,
          recoveredFromBtnOff: false,
          retriesUsed: 0,
          buttonStateBefore: initialInsp.state,
          buttonStateAfter: initialInsp.state,
          clickX: 0,
          clickY: 0,
          totalDispatchMs: Number((nowMono() - startMono).toFixed(3)),
          preJitterMs: 0,
          holdJitterMs: 0,
          postJitterMs: 0,
          traces,
          error: initialInsp.reason,
        };
        this.lastClickResult = failedRes;
        this.emitSnapshot();
        return failedRes;
      }

      // Delegate to TimingCalibrationEngine sub-millisecond recursive retry queue
      const retryResult = await new Promise<{
        el: HTMLElement | null;
        attempts: number;
        elapsedMs: number;
        error?: string;
      }>((resolve) => {
        this.timingEngine.enqueueBtnOffRetry({
          tag,
          target: el,
          resolveTarget: resolveEl,
          maxAttempts: cfg.maxBtnOffAttempts,
          maxDurationMs: cfg.maxBtnOffRetryMs,
          onReady: (activeEl, meta) => {
            resolve({
              el: activeEl,
              attempts: meta.attempts,
              elapsedMs: meta.elapsedMs,
            });
          },
          onExhausted: (reason, attempts, elapsedMs) => {
            resolve({
              el: null,
              attempts,
              elapsedMs,
              error: reason,
            });
          },
        });
      });

      retriesUsed = retryResult.attempts;
      if (!retryResult.el) {
        recordTrace(
          'RETRY_QUEUE_WAIT',
          `Exhausted after ${retryResult.attempts} checks (${retryResult.elapsedMs}ms)`,
        );
        const exhaustedRes: HumanMimicClickResult = {
          dispatched: false,
          recoveredFromBtnOff: false,
          retriesUsed,
          buttonStateBefore: initialInsp.state,
          buttonStateAfter: inspectCashoutButtonState(resolveEl()).state,
          clickX: 0,
          clickY: 0,
          totalDispatchMs: Number((nowMono() - startMono).toFixed(3)),
          preJitterMs: 0,
          holdJitterMs: 0,
          postJitterMs: 0,
          traces,
          error: retryResult.error || 'Cashout button remained disabled/btn_off',
        };
        this.lastClickResult = exhaustedRes;
        this.emitSnapshot();
        return exhaustedRes;
      }

      el = retryResult.el;
      recoveredFromBtnOff = true;
      recordTrace(
        'RETRY_QUEUE_WAIT',
        `Recovered from ${initialInsp.state} in ${retryResult.elapsedMs}ms (${retryResult.attempts} sub-ms checks)`,
      );
    }

    if (!el) {
      const missingRes: HumanMimicClickResult = {
        dispatched: false,
        recoveredFromBtnOff,
        retriesUsed,
        buttonStateBefore: initialInsp.state,
        buttonStateAfter: 'missing',
        clickX: 0,
        clickY: 0,
        totalDispatchMs: Number((nowMono() - startMono).toFixed(3)),
        preJitterMs: 0,
        holdJitterMs: 0,
        postJitterMs: 0,
        traces,
        error: 'Target element unavailable',
      };
      this.lastClickResult = missingRes;
      this.emitSnapshot();
      return missingRes;
    }

    // Compute natural coordinate within safe inset of button rect & avoid identical consecutive coordinates
    const rect = el.getBoundingClientRect();
    const baseCx = rect.width > 0 ? rect.left + rect.width * 0.5 : 0;
    const baseCy = rect.height > 0 ? rect.top + rect.height * 0.5 : 0;
    const jRadius = cfg.enabled ? Math.min(cfg.coordinateJitterPx, Math.max(1.2, rect.width * 0.22)) : 0;
    let jx = cfg.enabled ? triangularRandom(-jRadius, jRadius) : 0;
    let jy = cfg.enabled ? triangularRandom(-jRadius * 0.75, jRadius * 0.75) : 0;
    if (cfg.enabled && this.lastClickCoords && rect.width > 12) {
      const candidateX = Math.round(baseCx + jx);
      const candidateY = Math.round(baseCy + jy);
      if (Math.abs(candidateX - Math.round(this.lastClickCoords.x)) < 1 && Math.abs(candidateY - Math.round(this.lastClickCoords.y)) < 1) {
        jx += jx >= 0 ? -1.7 : 1.7;
        jy += jy >= 0 ? -1.2 : 1.2;
      }
    }
    const clientX = Number((baseCx + jx).toFixed(2));
    const clientY = Number((baseCy + jy).toFixed(2));
    this.lastClickCoords = { x: clientX, y: clientY };
    const win = el.ownerDocument?.defaultView || (typeof window !== 'undefined' ? window : null);
    const screenX = Number((clientX + (win?.screenX || 0)).toFixed(2));
    const screenY = Number((clientY + (win?.screenY || 0)).toFixed(2));
    const pressure = Number((0.64 + Math.random() * 0.30).toFixed(3));
    const pointerId = 100 + Math.floor(Math.random() * 5000);

    const commonMouse = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: win || undefined,
      clientX,
      clientY,
      screenX,
      screenY,
    };

    const dispatchPointer = (type: string, optsExtra: Partial<PointerEventInit>) => {
      if (typeof PointerEvent === 'function') {
        el!.dispatchEvent(
          new PointerEvent(type, {
            ...commonMouse,
            pointerId,
            pointerType: 'touch',
            isPrimary: true,
            width: 18 + Math.floor(Math.random() * 10),
            height: 18 + Math.floor(Math.random() * 10),
            ...optsExtra,
          }),
        );
      }
    };

    const dispatchMouse = (type: string, optsExtra: Partial<MouseEventInit>) => {
      if (typeof MouseEvent === 'function') {
        el!.dispatchEvent(new MouseEvent(type, { ...commonMouse, ...optsExtra }));
      }
    };

    // Phase 1: Pointer hover & approach
    dispatchPointer('pointerover', { buttons: 0, pressure: 0 });
    dispatchPointer('pointerenter', { bubbles: false, buttons: 0, pressure: 0 });
    dispatchPointer('pointermove', { buttons: 0, pressure: 0 });
    dispatchMouse('mouseover', { buttons: 0, detail: 0 });
    dispatchMouse('mousemove', { buttons: 0, detail: 0 });
    recordTrace('POINTER_HOVER', `Hovered (${clientX}, ${clientY})`);

    // Phase 2: Pre-down human-mimic reaction jitter + optional takeoff human-reaction floor
    let preJitterTarget = cfg.enabled
      ? triangularRandom(cfg.preHoverJitterMinMs, cfg.preHoverJitterMaxMs)
      : 0;
    const minFlightFloor = cfg.minFlightReactionMs ?? autoProf.minFlightReactionMs;
    if (
      cfg.enabled &&
      typeof opts?.flightAgeMs === 'number' &&
      opts.flightAgeMs >= 0 &&
      opts.flightAgeMs < minFlightFloor
    ) {
      const needed = Math.min(180, Math.max(0, minFlightFloor - opts.flightAgeMs));
      preJitterTarget = Math.max(preJitterTarget, needed);
    }
    const actualPreJitter = await waitHumanJitterMs(preJitterTarget);
    if (actualPreJitter > 0) {
      recordTrace('PRE_DOWN_JITTER', `Yielded ${actualPreJitter.toFixed(2)}ms before pointerdown`);
    }

    // Phase 3: Pointer down + touchstart
    dispatchPointer('pointerdown', { button: 0, buttons: 1, detail: 1, pressure });
    try {
      el.focus({ preventScroll: true });
    } catch {
      // ignore
    }
    recordTrace('POINTER_DOWN', `pointerdown pressure=${pressure}`);

    // Phase 4: Human hold jitter (realistic tap contact duration)
    const holdTarget = cfg.enabled
      ? triangularRandom(cfg.holdDurationMinMs, cfg.holdDurationMaxMs)
      : 0;
    const actualHoldJitter = await waitHumanJitterMs(holdTarget);
    if (actualHoldJitter > 0) {
      recordTrace('HUMAN_HOLD_JITTER', `Held contact ${actualHoldJitter.toFixed(2)}ms`);
    }

    // Phase 5: Pointer up + mouse down/up
    dispatchPointer('pointerup', { button: 0, buttons: 0, detail: 1, pressure: 0 });
    dispatchMouse('mousedown', { button: 0, buttons: 1, detail: 1 });
    dispatchMouse('mouseup', { button: 0, buttons: 0, detail: 1 });
    recordTrace('POINTER_UP', 'pointerup + mousedown/mouseup released');

    // Phase 6: Post-up micro-jitter before final DOM click event
    const postTarget = cfg.enabled
      ? triangularRandom(cfg.postUpJitterMinMs, cfg.postUpJitterMaxMs)
      : 0;
    const actualPostJitter = await waitHumanJitterMs(postTarget);
    if (actualPostJitter > 0) {
      recordTrace('POST_UP_JITTER', `Post-up DOM queue yield ${actualPostJitter.toFixed(2)}ms`);
    }

    // Phase 7: Trigger native click & pointer leave
    el.click();
    dispatchPointer('pointerout', { buttons: 0, pressure: 0 });
    dispatchPointer('pointerleave', { bubbles: false, buttons: 0, pressure: 0 });
    dispatchMouse('mouseout', { buttons: 0, detail: 0 });

    const afterInsp = inspectCashoutButtonState(el);
    const totalDispatchMs = Number((nowMono() - startMono).toFixed(3));
    recordTrace('CLICK_COMPLETE', `Click accepted; post-state=${afterInsp.state}`);

    const result: HumanMimicClickResult = {
      dispatched: true,
      recoveredFromBtnOff,
      retriesUsed,
      buttonStateBefore: initialInsp.state,
      buttonStateAfter: afterInsp.state,
      clickX: clientX,
      clickY: clientY,
      totalDispatchMs,
      preJitterMs: actualPreJitter,
      holdJitterMs: actualHoldJitter,
      postJitterMs: actualPostJitter,
      traces,
    };

    this.lastClickResult = result;
    this.ingestTelemetry({
      transport: 'VM-BRIDGE',
      src: 'CLICK',
      direction: 'OUT',
      matched: true,
      matchedTag: tag,
      retryQueueDepth: this.timingEngine.getRetryQueueDepth(),
      text: `Human-mimic click (${clientX}, ${clientY}) pre=${actualPreJitter.toFixed(2)}ms hold=${actualHoldJitter.toFixed(2)}ms post=${actualPostJitter.toFixed(2)}ms retries=${retriesUsed}`,
    });
    this.emitSnapshot();
    return result;
  }

  public destroy(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.uninstallTelemetryInterceptors();
    for (const fn of this.bridgeCleanupFns) {
      try {
        fn();
      } catch {
        // ignore
      }
    }
    this.bridgeCleanupFns = [];
  }
}

export const violentmonkeyBridge = new ViolentmonkeyBridge(timingCalibrationEngine);
