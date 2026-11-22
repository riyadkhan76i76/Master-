/**
 * TimingCalibrationEngine
 *
 * Manages round-offset predictive lead calibration (Auto 3x -> 10x),
 * +2x advance tool pre-signal windows (2 * L horizon -> L ms ahead),
 * and a sub-millisecond recursive retry queue when the target cashout button
 * is temporarily disabled (e.g., `btn_off`, `disabled`, `aria-disabled="true"`).
 */

export type CashoutButtonState =
  | 'ready'
  | 'btn_off'
  | 'disabled'
  | 'bet_phase'
  | 'ended'
  | 'missing';

export interface ButtonInspectionResult {
  state: CashoutButtonState;
  isReady: boolean;
  isRetryableOff: boolean;
  text: string;
  reason: string;
  classes: string;
}

export interface RetryQueueItem {
  id: string;
  tag: string;
  enqueuedAtMono: number;
  lastCheckedMono: number;
  attempts: number;
  maxAttempts: number;
  maxDurationMs: number;
  state: CashoutButtonState;
  lastReason: string;
}

export interface RetryTelemetryEvent {
  id: string;
  tag: string;
  status: 'ENQUEUED' | 'CHECKING' | 'RECOVERED' | 'EXHAUSTED' | 'CANCELLED';
  attempts: number;
  elapsedMs: number;
  intervalMs: number;
  buttonState: CashoutButtonState;
  reason: string;
  timestamp: string;
}

export interface RoundTimingSample {
  roundId: string;
  tag: string;
  flightStartMono: number;
  tagArrivalMono: number;
  clickMono: number;
  crashMono: number;
  outCashMono?: number;
  serverAckMono?: number;
  serverAckX?: number;
  intendedX?: number;
  growthRateK?: number;
  outcome: 'CASHED' | 'LATE' | 'BTN_OFF_RECOVERED' | 'MISSED';
}

export interface ClickXVerificationInput {
  roundId?: string;
  tag?: string;
  clickMono: number;
  serverAckX: number;
  serverAckMono?: number;
  intendedX?: number;
  flightStartMono?: number;
  growthRateK?: number;
}

export interface ClickXVerificationRecord {
  id: string;
  roundId: string;
  tag: string;
  clickMono: number;
  serverAckX: number;
  intendedX?: number;
  resolvedServerXMono: number;
  signedDeltaMs: number;
  discrepancyMs: number;
  discrepancyExceeded: boolean;
  calibrationAdjustmentMs: number;
  previousLeadMs: number;
  adjustedLeadMs: number;
  timestamp: string;
}

export type TagLeadMode = 'auto' | 'manual_mult' | 'manual_ms';

export interface TagLeadOverride {
  tag: string;
  mode: TagLeadMode;
  multiplier: number;
  manualMs: number;
  updatedAt: number;
}

export interface AutoLeadCalibrationResult {
  tag: string;
  sampleCount: number;
  medianDeficitMs: number;
  measuredServerAcceptMs: number;
  recommendedLeadMs: number;
  appliedMultiplier: number;
  mode: TagLeadMode;
  calibrated: boolean;
  late400Streak: number;
  late400RuleActive: boolean;
  late400BoostMs: number;
  lastCrashGapMs: number;
}

export interface AutoHumanAntiBotProfile {
  enabled: boolean;
  preDownMinMs: number;
  preDownMaxMs: number;
  holdMinMs: number;
  holdMaxMs: number;
  postUpMinMs: number;
  postUpMaxMs: number;
  minFlightReactionMs: number;
  coordinateJitterPx: number;
  acceptStreak: number;
  rejectCount: number;
  avgHumanSpanMs: number;
  lastAdaptationReason: string;
  updatedAt: number;
}

export interface ServerClickFeedback {
  outcome: 'ACCEPTED' | 'BOT_REJECTED' | 'RATE_LIMITED' | 'LATE';
  reactionFromFlightMs?: number;
  actualHumanSpanMs?: number;
  serverRttMs?: number;
  errText?: string;
}

export interface LatencyGuardSample {
  id: string;
  roundId: string;
  tag: string;
  intendedClickMono: number;
  serverAckMono: number;
  latencyDeltaMs: number;
  frameDropCount: number;
  stuckDetected: boolean;
  forceReflowTriggered: boolean;
  outcome: 'ACCEPTED' | 'STUCK' | 'LATE' | 'REJECTED';
  time: string;
}

export interface LatencyGuardState {
  active: boolean;
  criticalCashoutPhase: boolean;
  consecutiveFrameDrops: number;
  lastFrameDeltaMs: number;
  lastLatencyDeltaMs: number;
  stuckStateDetected: boolean;
  totalFrameDrops: number;
  totalForceReflows: number;
  lastForceReflowAt: number;
  lastForceReflowReason: string;
  thresholdMs: number;
  samples: LatencyGuardSample[];
}

export interface TimingEngineSnapshot {
  retryQueueDepth: number;
  externalRetryQueueDepth: number;
  totalRetryQueueDepth: number;
  activeRetries: RetryQueueItem[];
  totalBtnOffDetections: number;
  totalRetriesScheduled: number;
  totalChecksExecuted: number;
  totalRecoveries: number;
  totalExhausted: number;
  lastCheckIntervalMs: number;
  avgCheckIntervalMs: number;
  recentEvents: RetryTelemetryEvent[];
  calibratedTags: AutoLeadCalibrationResult[];
  globalLeadMode: TagLeadMode;
  globalLeadMultiplier: number;
  globalManualLeadMs: number;
  tagOverrides: TagLeadOverride[];
  autoHumanProfile: AutoHumanAntiBotProfile;
  latencyGuard: LatencyGuardState;
  clickXVerifications: ClickXVerificationRecord[];
  totalClickXDiscrepancies: number;
  lastCalibrationAdjustmentMs: number;
  performanceTimerQueue: PerformanceTimerQueueState;
}

export interface PrecalculatedXTriggerInput {
  roundId?: string;
  tag?: string;
  targetX: number;
  flightStartMono: number;
  currentX?: number;
  sampleMono?: number;
  growthRateK?: number;
  leadOffsetMs?: number;
  useCalibratedLead?: boolean;
  preCalcAdvanceMs?: number;
}

export interface PrecalculatedXTriggerItem {
  id: string;
  roundId: string;
  tag: string;
  targetX: number;
  estimatedGrowthRateK: number;
  predictedXAtMono: number;
  leadOffsetMs: number;
  triggerAtMono: number;
  preCalcAtMono: number;
  preCalcAdvanceMs: number;
  precalculatedXAtGate: number;
  stage: 'QUEUED' | 'ARMED_10MS' | 'TRIGGERED' | 'CANCELLED';
  firedAtMono?: number;
  jitterErrorMs?: number;
}

export interface PerformanceTimerQueueState {
  preCalcAdvanceMs: number;
  activeCount: number;
  armed10msCount: number;
  totalScheduled: number;
  totalPrecalculated: number;
  totalTriggered: number;
  avgTriggerJitterMs: number;
  lastPrecalculatedItem: PrecalculatedXTriggerItem | null;
  queue: PrecalculatedXTriggerItem[];
}

export interface EnqueueXTriggerOptions extends PrecalculatedXTriggerInput {
  id?: string;
  onPrecalculate10ms?: (item: PrecalculatedXTriggerItem) => void;
  onTrigger: (meta: {
    item: PrecalculatedXTriggerItem;
    firedAtMono: number;
    jitterErrorMs: number;
    precalculatedAdvanceMs: number;
  }) => void;
  onCancelled?: (reason: string, item: PrecalculatedXTriggerItem) => void;
}

export interface SubMsRetryOptions {
  id?: string;
  tag?: string;
  target?: HTMLElement | null;
  resolveTarget?: () => HTMLElement | null;
  maxAttempts?: number;
  maxDurationMs?: number;
  subMsBudgetMs?: number;
  adaptiveWindow?: boolean;
  forceSubMsFrequency?: boolean;
  onReady: (el: HTMLElement, meta: { attempts: number; elapsedMs: number; lastIntervalMs: number }) => void;
  onAttempt?: (attempt: number, inspection: ButtonInspectionResult, intervalMs: number) => void;
  onExhausted?: (reason: string, attempts: number, elapsedMs: number) => void;
}

export const AUTO_LEAD_MULTIPLIER_PRESETS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

export interface PreSignal2xWindow {
  baseLeadMs: number;
  extraBoostMs: number;
  totalHorizonMs: number;
  advanceAheadMs: number;
}

export const LATE_400_THRESHOLD_MS = 400;
export const LATE_400_BASE_MS = 800;
export const LATE_400_MULTIPLIER = 6;
export const LATE_400_BOOST_MS = LATE_400_BASE_MS * LATE_400_MULTIPLIER;
export const LATENCY_GUARD_THRESHOLD_MS = 50;
export const CLICK_X_DISCREPANCY_THRESHOLD_MS = 1.0;
export const PRECALC_X_ADVANCE_MS = 10.0;

const DEFAULT_CRASH_GROWTH_K = 0.00006;
const MAX_PRETRIG_LEAD_MS = 30_000;
const AUTO_LEAD_MIN_ROUNDS = 2;
const AUTO_LEAD_MAX_ROUNDS = 12;
const AUTO_LEAD_MIN_MULTIPLIER = 1;
const AUTO_LEAD_MAX_MULTIPLIER = 10;

export function computePreSignal2xWindow(baseLeadMs: number, extraBoostMs = 0): PreSignal2xWindow {
  const base = Math.max(0, Math.min(MAX_PRETRIG_LEAD_MS, Math.round(Number(baseLeadMs) || 0)));
  const boost = Math.max(0, Math.min(MAX_PRETRIG_LEAD_MS, Math.round(Number(extraBoostMs) || 0)));
  const totalHorizonMs = Math.min(MAX_PRETRIG_LEAD_MS, base * 2 + boost);
  return {
    baseLeadMs: base,
    extraBoostMs: boost,
    totalHorizonMs,
    advanceAheadMs: Math.max(0, totalHorizonMs - base),
  };
}

function createDefaultAutoHumanProfile(): AutoHumanAntiBotProfile {
  return {
    enabled: true,
    preDownMinMs: 5.5,
    preDownMaxMs: 15.0,
    holdMinMs: 16.0,
    holdMaxMs: 36.0,
    postUpMinMs: 1.0,
    postUpMaxMs: 3.5,
    minFlightReactionMs: 125,
    coordinateJitterPx: 4.0,
    acceptStreak: 0,
    rejectCount: 0,
    avgHumanSpanMs: 38.5,
    lastAdaptationReason: 'Auto-tuned default human tap envelope active',
    updatedAt: Date.now(),
  };
}

const BET_PHASE_WORDS = [
  'place bet',
  'bet',
  'cancel',
  'wait',
  'waiting',
  'next round',
  'next game',
  'rebet',
  'repeat',
  'starting',
  'বাজি',
  'বাতিল',
  'অপেক্ষা',
];

const CASHOUT_WORDS = [
  'cash out',
  'cashout',
  'cash_out',
  'take win',
  'take',
  'collect',
  'claim',
  'withdraw',
  'sell',
  'payout',
  'redeem',
  'settle',
  'উত্তোলন',
  'ক্যাশ',
  'নিন',
  'তুলে',
  'সেল',
];

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function fmtTimeMs(): string {
  const d = new Date();
  return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

export function inspectCashoutButtonState(el: HTMLElement | null): ButtonInspectionResult {
  if (!el || !el.isConnected) {
    return {
      state: 'missing',
      isReady: false,
      isRetryableOff: true,
      text: '',
      reason: 'Target element missing or detached',
      classes: '',
    };
  }

  const rawText = (el.textContent || (el as HTMLInputElement).value || el.getAttribute('aria-label') || '')
    .replace(/\s+/g, ' ')
    .trim();
  const lcText = rawText.toLowerCase();
  const classStr = typeof el.className === 'string' ? el.className : '';
  const lcClass = classStr.toLowerCase();
  const dataState = (el.getAttribute('data-state') || el.getAttribute('data-status') || '').toLowerCase();
  const ariaDisabled = el.getAttribute('aria-disabled') === 'true';
  const htmlDisabled = Boolean((el as HTMLButtonElement).disabled) || el.hasAttribute('disabled') || el.getAttribute('data-disabled') === 'true';

  const hasBtnOffMarker =
    /\bbtn[_-]?off\b/.test(lcClass) ||
    /\bis[_-]?disabled\b/.test(lcClass) ||
    /\bdisabled\b/.test(lcClass) ||
    /\boff\b/.test(lcClass) ||
    dataState === 'off' ||
    dataState === 'disabled' ||
    dataState === 'btn_off' ||
    dataState === 'locked';

  if (htmlDisabled || ariaDisabled || hasBtnOffMarker) {
    const state: CashoutButtonState = /\bbtn[_-]?off\b/.test(lcClass) || dataState === 'btn_off' || dataState === 'off'
      ? 'btn_off'
      : 'disabled';
    return {
      state,
      isReady: false,
      isRetryableOff: true,
      text: rawText,
      reason: state === 'btn_off' ? 'Cashout button in btn_off state' : 'Cashout button disabled',
      classes: classStr,
    };
  }

  // Check if computed style blocks interaction
  if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
    const cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.pointerEvents === 'none') {
      return {
        state: 'btn_off',
        isReady: false,
        isRetryableOff: true,
        text: rawText,
        reason: `Pointer interaction blocked (${cs.pointerEvents}/${cs.visibility})`,
        classes: classStr,
      };
    }
  }

  const hasCashWord = CASHOUT_WORDS.some((w) => lcText.includes(w)) || /^\d+(?:[.,]\d+)?\s*[x×৳$€£₹]?$/.test(lcText);
  const hasBetWord = BET_PHASE_WORDS.some((w) => lcText === w || lcText.startsWith(w + ' '));

  if (hasBetWord && !hasCashWord) {
    return {
      state: 'bet_phase',
      isReady: false,
      isRetryableOff: true,
      text: rawText,
      reason: `Button still in bet/wait phase ("${rawText.slice(0, 24)}")`,
      classes: classStr,
    };
  }

  return {
    state: 'ready',
    isReady: true,
    isRetryableOff: false,
    text: rawText,
    reason: 'Cashout button active',
    classes: classStr,
  };
}

interface InternalRetryTask {
  entry: RetryQueueItem;
  options: SubMsRetryOptions;
  cancelled: boolean;
  finished: boolean;
  channel: MessageChannel | null;
  safetyTimer: ReturnType<typeof setTimeout> | null;
  observer: MutationObserver | null;
  intervalSumMs: number;
  intervalSamples: number;
}

interface InternalPerfTimerJob {
  item: PrecalculatedXTriggerItem;
  options: EnqueueXTriggerOptions;
  coarseTimer: ReturnType<typeof setTimeout> | null;
  precalcFired: boolean;
  finished: boolean;
  cancelled: boolean;
  channel: MessageChannel | null;
  flightStartMono: number;
}

export class TimingCalibrationEngine {
  private retryTasks = new Map<string, InternalRetryTask>();
  private externalRetryQueueDepth = 0;
  private totalBtnOffDetections = 0;
  private totalRetriesScheduled = 0;
  private totalChecksExecuted = 0;
  private totalRecoveries = 0;
  private totalExhausted = 0;
  private lastCheckIntervalMs = 0;
  private avgCheckIntervalMs = 0;
  private recentEvents: RetryTelemetryEvent[] = [];
  private roundSamples = new Map<string, RoundTimingSample[]>();
  private calibratedTags = new Map<string, AutoLeadCalibrationResult>();
  private tagOverrides = new Map<string, TagLeadOverride>();
  private globalLeadMode: TagLeadMode = 'auto';
  private globalLeadMultiplier = 3;
  private globalManualLeadMs = 260;
  private autoHumanProfile: AutoHumanAntiBotProfile = createDefaultAutoHumanProfile();
  private latencyGuard: LatencyGuardState = {
    active: true,
    criticalCashoutPhase: false,
    consecutiveFrameDrops: 0,
    lastFrameDeltaMs: 0,
    lastLatencyDeltaMs: 0,
    stuckStateDetected: false,
    totalFrameDrops: 0,
    totalForceReflows: 0,
    lastForceReflowAt: 0,
    lastForceReflowReason: 'Standby · threshold > 50ms',
    thresholdMs: LATENCY_GUARD_THRESHOLD_MS,
    samples: [],
  };
  private clickXVerifications: ClickXVerificationRecord[] = [];
  private totalClickXDiscrepancies = 0;
  private lastCalibrationAdjustmentMs = 0;
  private perfTimerJobs = new Map<string, InternalPerfTimerJob>();
  private perfQueueScheduledCount = 0;
  private perfQueuePrecalculatedCount = 0;
  private perfQueueTriggeredCount = 0;
  private perfTriggerJitterSumMs = 0;
  private lastPrecalculatedItem: PrecalculatedXTriggerItem | null = null;
  private listeners = new Set<(snap: TimingEngineSnapshot) => void>();
  private notifyScheduled = false;
  private seq = 0;

  public subscribe(listener: (snap: TimingEngineSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private scheduleNotify(immediate = false): void {
    if (immediate) {
      this.emitSnapshot();
      return;
    }
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    const flush = () => {
      this.notifyScheduled = false;
      this.emitSnapshot();
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(flush);
    } else {
      setTimeout(flush, 16);
    }
  }

  private emitSnapshot(): void {
    const snap = this.getSnapshot();
    for (const listener of this.listeners) {
      try {
        listener(snap);
      } catch {
        // Ignore subscriber exceptions
      }
    }
  }

  private pushEvent(ev: RetryTelemetryEvent): void {
    this.recentEvents.unshift(ev);
    if (this.recentEvents.length > 40) {
      this.recentEvents.length = 40;
    }
  }

  public setExternalRetryQueueDepth(depth: number): void {
    const clean = Math.max(0, Math.round(Number(depth) || 0));
    if (clean === this.externalRetryQueueDepth) return;
    this.externalRetryQueueDepth = clean;
    this.scheduleNotify(true);
  }

  public getRetryQueueDepth(): number {
    return this.retryTasks.size + this.externalRetryQueueDepth;
  }

  public getSnapshot(): TimingEngineSnapshot {
    const activeRetries: RetryQueueItem[] = [];
    for (const task of this.retryTasks.values()) {
      activeRetries.push({ ...task.entry });
    }
    return {
      retryQueueDepth: this.retryTasks.size,
      externalRetryQueueDepth: this.externalRetryQueueDepth,
      totalRetryQueueDepth: this.retryTasks.size + this.externalRetryQueueDepth,
      activeRetries,
      totalBtnOffDetections: this.totalBtnOffDetections,
      totalRetriesScheduled: this.totalRetriesScheduled,
      totalChecksExecuted: this.totalChecksExecuted,
      totalRecoveries: this.totalRecoveries,
      totalExhausted: this.totalExhausted,
      lastCheckIntervalMs: Number(this.lastCheckIntervalMs.toFixed(3)),
      avgCheckIntervalMs: Number(this.avgCheckIntervalMs.toFixed(3)),
      recentEvents: this.recentEvents.slice(0, 20),
      calibratedTags: Array.from(this.calibratedTags.values()),
      globalLeadMode: this.globalLeadMode,
      globalLeadMultiplier: this.globalLeadMultiplier,
      globalManualLeadMs: this.globalManualLeadMs,
      tagOverrides: Array.from(this.tagOverrides.values()),
      autoHumanProfile: { ...this.autoHumanProfile },
      latencyGuard: {
        ...this.latencyGuard,
        samples: this.latencyGuard.samples.slice(),
      },
      clickXVerifications: this.clickXVerifications.slice(),
      totalClickXDiscrepancies: this.totalClickXDiscrepancies,
      lastCalibrationAdjustmentMs: this.lastCalibrationAdjustmentMs,
      performanceTimerQueue: this.getPerformanceTimerQueueState(),
    };
  }

  public getPerformanceTimerQueueState(): PerformanceTimerQueueState {
    const queue = Array.from(this.perfTimerJobs.values())
      .filter((j) => !j.finished && !j.cancelled)
      .sort((a, b) => a.item.triggerAtMono - b.item.triggerAtMono)
      .map((j) => ({ ...j.item }));
    const armed10msCount = queue.filter((q) => q.stage === 'ARMED_10MS').length;
    return {
      preCalcAdvanceMs: PRECALC_X_ADVANCE_MS,
      activeCount: queue.length,
      armed10msCount,
      totalScheduled: this.perfQueueScheduledCount,
      totalPrecalculated: this.perfQueuePrecalculatedCount,
      totalTriggered: this.perfQueueTriggeredCount,
      avgTriggerJitterMs:
        this.perfQueueTriggeredCount > 0
          ? Number((this.perfTriggerJitterSumMs / this.perfQueueTriggeredCount).toFixed(3))
          : 0,
      lastPrecalculatedItem: this.lastPrecalculatedItem ? { ...this.lastPrecalculatedItem } : null,
      queue,
    };
  }

  /**
   * Pre-calculates the next 'X' trigger point (default 10ms ahead of the trigger deadline)
   * using monotonic `performance.now()` timestamps and live/fitted multiplier growth rate `k`.
   */
  public precalculateNextXTrigger(input: PrecalculatedXTriggerInput): PrecalculatedXTriggerItem {
    const tag = String(input.tag || 'CASHOUT').trim() || 'CASHOUT';
    const roundId = String(input.roundId || `R${this.perfQueueScheduledCount + 1}`).slice(0, 28);
    const targetX = Math.max(1.001, Number(input.targetX) || 1.01);
    const flightStartMono = Math.max(0, Number(input.flightStartMono) || nowMs());
    const preCalcAdvanceMs = Math.max(1, Math.min(250, Number(input.preCalcAdvanceMs ?? PRECALC_X_ADVANCE_MS)));

    let k =
      typeof input.growthRateK === 'number' && Number.isFinite(input.growthRateK) && input.growthRateK > 0
        ? input.growthRateK
        : DEFAULT_CRASH_GROWTH_K;

    const currentX = typeof input.currentX === 'number' && input.currentX > 1 ? input.currentX : undefined;
    const sampleMono =
      typeof input.sampleMono === 'number' && input.sampleMono > flightStartMono
        ? input.sampleMono
        : undefined;

    if (currentX && sampleMono && (!input.growthRateK || input.growthRateK <= 0)) {
      const elapsed = Math.max(1, sampleMono - flightStartMono);
      const fitted = Math.log(currentX) / elapsed;
      if (Number.isFinite(fitted) && fitted > 0.00001 && fitted < 0.001) {
        k = fitted;
      }
    }

    const predictedXAtMono =
      currentX && sampleMono && targetX >= currentX
        ? sampleMono + Math.log(targetX / currentX) / k
        : flightStartMono + Math.log(targetX) / k;

    const leadOffsetMs =
      typeof input.leadOffsetMs === 'number' && Number.isFinite(input.leadOffsetMs)
        ? Math.max(0, input.leadOffsetMs)
        : input.useCalibratedLead
          ? this.getEffectiveLeadForTag(tag).leadMs
          : 0;

    const triggerAtMono = Math.max(nowMs(), predictedXAtMono - leadOffsetMs);
    const preCalcAtMono = Math.max(0, triggerAtMono - preCalcAdvanceMs);
    const elapsedAtPrecalc = Math.max(0, preCalcAtMono - flightStartMono);
    const precalculatedXAtGate = Number(Math.exp(k * elapsedAtPrecalc).toFixed(4));

    return {
      id: `ptq_${++this.seq}_${Date.now().toString(36)}`,
      roundId,
      tag,
      targetX: Number(targetX.toFixed(4)),
      estimatedGrowthRateK: Number(k.toFixed(8)),
      predictedXAtMono: Number(predictedXAtMono.toFixed(3)),
      leadOffsetMs: Number(leadOffsetMs.toFixed(2)),
      triggerAtMono: Number(triggerAtMono.toFixed(3)),
      preCalcAtMono: Number(preCalcAtMono.toFixed(3)),
      preCalcAdvanceMs,
      precalculatedXAtGate,
      stage: 'QUEUED',
    };
  }

  /**
   * Enqueues an 'X' cashout trigger into a high-resolution performance-timer queue
   * that pre-calculates and arms the trigger 10ms ahead (`preCalcAtMono`), then drives
   * the final 10ms over MessageChannel + monotonic `performance.now()` deadlines
   * to avoid depending on event-loop timer availability during the critical phase.
   */
  public enqueueXTrigger(options: EnqueueXTriggerOptions): {
    id: string;
    prediction: PrecalculatedXTriggerItem;
  } {
    const prediction = this.precalculateNextXTrigger(options);
    if (options.id) {
      prediction.id = options.id;
      if (this.perfTimerJobs.has(options.id)) {
        this.cancelXTrigger(options.id, 'REPLACED');
      }
    }

    const job: InternalPerfTimerJob = {
      item: prediction,
      options,
      coarseTimer: null,
      precalcFired: false,
      finished: false,
      cancelled: false,
      channel: typeof MessageChannel === 'function' ? new MessageChannel() : null,
      flightStartMono: Math.max(0, Number(options.flightStartMono) || nowMs()),
    };

    this.perfTimerJobs.set(prediction.id, job);
    this.perfQueueScheduledCount += 1;
    this.scheduleNotify(true);

    const cleanupJob = () => {
      job.finished = true;
      if (job.coarseTimer !== null) {
        clearTimeout(job.coarseTimer);
        job.coarseTimer = null;
      }
      if (job.channel) {
        try {
          job.channel.port1.onmessage = null;
          job.channel.port1.close();
          job.channel.port2.close();
        } catch {
          // ignore
        }
        job.channel = null;
      }
      this.perfTimerJobs.delete(prediction.id);
    };

    const fireTrigger = (firedAtMono: number) => {
      if (job.finished || job.cancelled) return;
      const jitterErrorMs = Number((firedAtMono - job.item.triggerAtMono).toFixed(3));
      job.item.stage = 'TRIGGERED';
      job.item.firedAtMono = Number(firedAtMono.toFixed(3));
      job.item.jitterErrorMs = jitterErrorMs;

      this.perfQueueTriggeredCount += 1;
      this.perfTriggerJitterSumMs += Math.abs(jitterErrorMs);
      const snapshotItem = { ...job.item };
      cleanupJob();
      this.setCriticalCashoutPhase(false);
      this.scheduleNotify(true);

      try {
        options.onTrigger({
          item: snapshotItem,
          firedAtMono: snapshotItem.firedAtMono!,
          jitterErrorMs,
          precalculatedAdvanceMs: snapshotItem.preCalcAdvanceMs,
        });
      } catch {
        // ignore callback errors
      }
    };

    const enterPrecalc10msWindow = () => {
      if (job.finished || job.cancelled) return;
      if (!job.precalcFired) {
        job.precalcFired = true;
        job.item.stage = 'ARMED_10MS';
        // Re-anchor exact precalculated 'X' right at the T-10ms mark
        const elapsedGate = Math.max(0, nowMs() - job.flightStartMono);
        job.item.precalculatedXAtGate = Number(
          Math.exp(job.item.estimatedGrowthRateK * elapsedGate).toFixed(4),
        );
        this.perfQueuePrecalculatedCount += 1;
        this.lastPrecalculatedItem = { ...job.item };
        this.setCriticalCashoutPhase(true);
        this.scheduleNotify(true);
        try {
          options.onPrecalculate10ms?.({ ...job.item });
        } catch {
          // ignore callback errors
        }
      }
      pumpHighResUntilTarget();
    };

    const pumpHighResUntilTarget = () => {
      if (job.finished || job.cancelled) return;
      const tNow = nowMs();
      const remaining = job.item.triggerAtMono - tNow;
      if (remaining <= 0.15) {
        fireTrigger(tNow);
        return;
      }
      // Sub-1.2ms precision guard: bounded monotonic performance.now() latch avoids extra event-loop hops
      if (remaining <= 1.2 && typeof performance !== 'undefined' && typeof performance.now === 'function') {
        const spinLimitMono = tNow + 1.5;
        let cur = performance.now();
        while (cur < job.item.triggerAtMono && cur < spinLimitMono) {
          cur = performance.now();
        }
        if (cur >= job.item.triggerAtMono) {
          fireTrigger(cur);
          return;
        }
      }
      if (job.channel) {
        job.channel.port2.postMessage(null);
      } else {
        queueMicrotask(pumpHighResUntilTarget);
      }
    };

    if (job.channel) {
      job.channel.port1.onmessage = () => {
        if (!job.precalcFired && nowMs() >= job.item.preCalcAtMono) {
          enterPrecalc10msWindow();
        } else {
          pumpHighResUntilTarget();
        }
      };
    }

    const msUntilPrecalc = job.item.preCalcAtMono - nowMs();
    if (msUntilPrecalc <= 1.5) {
      // Already within or past the 10ms pre-calculation window -> arm immediately
      enterPrecalc10msWindow();
    } else {
      // Coarse sleep only until 2ms before the T-10ms pre-calculation boundary
      const coarseDelay = Math.max(0, Math.floor(msUntilPrecalc - 2));
      job.coarseTimer = setTimeout(() => {
        job.coarseTimer = null;
        if (job.finished || job.cancelled) return;
        const remPre = job.item.preCalcAtMono - nowMs();
        if (remPre <= 0.5) {
          enterPrecalc10msWindow();
        } else if (job.channel) {
          job.channel.port2.postMessage(null);
        } else {
          queueMicrotask(enterPrecalc10msWindow);
        }
      }, coarseDelay);
    }

    return {
      id: prediction.id,
      prediction: { ...prediction },
    };
  }

  /**
   * Feeds a live multiplier tick during flight so queued triggers not yet inside the locked
   * T-10ms pre-calculation window refine their `k` growth rate & `triggerAtMono` deadline.
   */
  public feedMultiplierTick(roundId: string, currentX: number, sampleMono = nowMs()): number {
    if (!roundId || !(currentX > 1)) return 0;
    let updated = 0;
    for (const job of this.perfTimerJobs.values()) {
      if (job.finished || job.cancelled || job.item.roundId !== roundId) continue;
      if (job.item.stage === 'ARMED_10MS') continue; // locked 10ms ahead -> immune to event-loop jitter

      const elapsed = Math.max(1, sampleMono - job.flightStartMono);
      const fittedK = Math.log(currentX) / elapsed;
      if (!Number.isFinite(fittedK) || fittedK <= 0.00001 || fittedK >= 0.001) continue;

      const blendedK = job.item.estimatedGrowthRateK * 0.4 + fittedK * 0.6;
      const nextPredictedAtMono = sampleMono + Math.log(job.item.targetX / currentX) / blendedK;
      const nextTriggerAtMono = Math.max(nowMs(), nextPredictedAtMono - job.item.leadOffsetMs);
      const nextPreCalcAtMono = Math.max(0, nextTriggerAtMono - job.item.preCalcAdvanceMs);

      job.item.estimatedGrowthRateK = Number(blendedK.toFixed(8));
      job.item.predictedXAtMono = Number(nextPredictedAtMono.toFixed(3));
      job.item.triggerAtMono = Number(nextTriggerAtMono.toFixed(3));
      job.item.preCalcAtMono = Number(nextPreCalcAtMono.toFixed(3));
      updated += 1;
    }
    if (updated > 0) {
      this.scheduleNotify(false);
    }
    return updated;
  }

  public cancelXTrigger(id: string, reason = 'CANCELLED'): boolean {
    const job = this.perfTimerJobs.get(id);
    if (!job) return false;
    job.cancelled = true;
    job.item.stage = 'CANCELLED';
    if (job.coarseTimer !== null) {
      clearTimeout(job.coarseTimer);
      job.coarseTimer = null;
    }
    if (job.channel) {
      try {
        job.channel.port1.onmessage = null;
        job.channel.port1.close();
        job.channel.port2.close();
      } catch {
        // ignore
      }
      job.channel = null;
    }
    this.perfTimerJobs.delete(id);
    this.scheduleNotify(true);
    try {
      job.options.onCancelled?.(reason, { ...job.item });
    } catch {
      // ignore
    }
    return true;
  }

  public cancelAllXTriggers(reason = 'ROUND_END'): number {
    const ids = Array.from(this.perfTimerJobs.keys());
    for (const id of ids) {
      this.cancelXTrigger(id, reason);
    }
    return ids.length;
  }

  public setCriticalCashoutPhase(active: boolean): void {
    const next = Boolean(active);
    if (this.latencyGuard.criticalCashoutPhase === next) return;
    this.latencyGuard.criticalCashoutPhase = next;
    if (!next) {
      this.latencyGuard.consecutiveFrameDrops = 0;
    }
    this.scheduleNotify(true);
  }

  /**
   * Aggressive force-reflow triggered by Latency Guard when latency delta exceeds 50ms
   * or consecutive frame drops threaten to stall the critical cashout phase.
   */
  public performForceReflow(targetEl?: HTMLElement | null, reason = 'Latency delta > 50ms'): boolean {
    try {
      if (typeof document !== 'undefined' && document.documentElement) {
        const root = document.documentElement;
        void root.offsetHeight;
        void root.getBoundingClientRect();
        if (document.body) {
          void document.body.offsetWidth;
          void document.body.scrollTop;
        }
      }
      if (targetEl && targetEl.isConnected) {
        void targetEl.offsetTop;
        void targetEl.offsetWidth;
        void targetEl.offsetHeight;
        const rect = targetEl.getBoundingClientRect();
        void rect.width;
        if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
          const cs = window.getComputedStyle(targetEl);
          void cs.pointerEvents;
          void cs.transform;
          void cs.opacity;
        }
      }
    } catch {
      // Ignore DOM read errors in restricted frames
    }
    this.latencyGuard.totalForceReflows += 1;
    this.latencyGuard.lastForceReflowAt = Date.now();
    this.latencyGuard.lastForceReflowReason = reason.slice(0, 120);
    this.scheduleNotify(true);
    return true;
  }

  /**
   * Monitors consecutive frame drops during critical cashout phase.
   * Performs aggressive force-reflow automatically if frame drop delta exceeds 50ms
   * or consecutive drops stack while latency drift exceeds 50ms.
   */
  public monitorFrameDrop(
    frameDeltaMs: number,
    targetEl?: HTMLElement | null,
  ): { dropped: boolean; consecutiveDrops: number; reflowTriggered: boolean } {
    const cleanDelta = Math.max(0, Number(frameDeltaMs) || 0);
    this.latencyGuard.lastFrameDeltaMs = Number(cleanDelta.toFixed(2));
    const dropped = cleanDelta > 24;
    if (dropped) {
      this.latencyGuard.consecutiveFrameDrops += 1;
      this.latencyGuard.totalFrameDrops += 1;
    } else {
      this.latencyGuard.consecutiveFrameDrops = 0;
    }

    const stuckByDrops =
      this.latencyGuard.criticalCashoutPhase &&
      (cleanDelta > LATENCY_GUARD_THRESHOLD_MS ||
        (this.latencyGuard.consecutiveFrameDrops >= 2 &&
          this.latencyGuard.lastLatencyDeltaMs > LATENCY_GUARD_THRESHOLD_MS));

    let reflowTriggered = false;
    if (stuckByDrops) {
      this.latencyGuard.stuckStateDetected = true;
      reflowTriggered = this.performForceReflow(
        targetEl,
        `Critical cashout frame drop (${cleanDelta.toFixed(1)}ms, streak=${this.latencyGuard.consecutiveFrameDrops})`,
      );
    } else if (dropped) {
      this.scheduleNotify(false);
    }

    return {
      dropped,
      consecutiveDrops: this.latencyGuard.consecutiveFrameDrops,
      reflowTriggered,
    };
  }

  /**
   * Records delta between intended click timestamp and actual server acknowledgment time
   * for the Latency Drift monitor & triggers aggressive force-reflow if delta > 50ms.
   */
  public recordLatencyDriftSample(params: {
    roundId?: string;
    tag?: string;
    intendedClickMono: number;
    serverAckMono: number;
    latencyDeltaMs?: number;
    frameDropCount?: number;
    outcome?: LatencyGuardSample['outcome'];
    targetEl?: HTMLElement | null;
  }): LatencyGuardSample {
    const intended = Math.max(0, Number(params.intendedClickMono) || 0);
    const ack = Math.max(intended, Number(params.serverAckMono) || intended);
    const deltaMs = Number(
      Math.max(
        0,
        typeof params.latencyDeltaMs === 'number' && Number.isFinite(params.latencyDeltaMs)
          ? params.latencyDeltaMs
          : ack - intended,
      ).toFixed(2),
    );
    const drops =
      typeof params.frameDropCount === 'number' && Number.isFinite(params.frameDropCount)
        ? Math.max(0, Math.round(params.frameDropCount))
        : this.latencyGuard.consecutiveFrameDrops;

    if (drops > 0 && drops > this.latencyGuard.consecutiveFrameDrops) {
      this.latencyGuard.consecutiveFrameDrops = drops;
      this.latencyGuard.totalFrameDrops += drops;
    }

    const exceedsThreshold = deltaMs > LATENCY_GUARD_THRESHOLD_MS;
    const outcome: LatencyGuardSample['outcome'] =
      params.outcome ?? (exceedsThreshold ? 'STUCK' : 'ACCEPTED');
    const stuckDetected = exceedsThreshold || outcome === 'STUCK' || outcome === 'LATE' || outcome === 'REJECTED';

    this.latencyGuard.lastLatencyDeltaMs = deltaMs;
    this.latencyGuard.stuckStateDetected = stuckDetected || this.latencyGuard.consecutiveFrameDrops >= 2;

    let forceReflowTriggered = false;
    if (exceedsThreshold) {
      forceReflowTriggered = this.performForceReflow(
        params.targetEl,
        `Latency drift ${deltaMs.toFixed(1)}ms > ${LATENCY_GUARD_THRESHOLD_MS}ms (${params.tag || 'CASHOUT'})`,
      );
    }

    const sample: LatencyGuardSample = {
      id: `lg_${++this.seq}_${Date.now().toString(36)}`,
      roundId: String(params.roundId || `R${this.latencyGuard.samples.length + 1}`).slice(0, 28),
      tag: String(params.tag || 'CASHOUT').slice(0, 32),
      intendedClickMono: Number(intended.toFixed(2)),
      serverAckMono: Number(ack.toFixed(2)),
      latencyDeltaMs: deltaMs,
      frameDropCount: drops,
      stuckDetected,
      forceReflowTriggered,
      outcome,
      time: fmtTimeMs(),
    };

    this.latencyGuard.samples.push(sample);
    if (this.latencyGuard.samples.length > 36) {
      this.latencyGuard.samples.splice(0, this.latencyGuard.samples.length - 36);
    }
    this.scheduleNotify(true);
    return sample;
  }

  /**
   * Verification step comparing the exact `clickMono` injection timestamp against
   * the game's actual server-acknowledged 'X' value/timestamp. Logs any discrepancy > 1ms
   * and applies an immediate real-time calibration lead adjustment.
   */
  public verifyClickAgainstServerAckX(input: ClickXVerificationInput): ClickXVerificationRecord {
    const key = String(input.tag || 'CASHOUT').trim() || 'CASHOUT';
    const clickMono = Math.max(0, Number(input.clickMono) || 0);
    const serverAckX = Number(input.serverAckX) || 0;
    const intendedX =
      typeof input.intendedX === 'number' && Number.isFinite(input.intendedX) && input.intendedX > 0
        ? input.intendedX
        : undefined;
    const k =
      typeof input.growthRateK === 'number' && Number.isFinite(input.growthRateK) && input.growthRateK > 0
        ? input.growthRateK
        : DEFAULT_CRASH_GROWTH_K;

    let resolvedServerXMono: number;
    if (typeof input.serverAckMono === 'number' && Number.isFinite(input.serverAckMono) && input.serverAckMono > 0) {
      resolvedServerXMono = input.serverAckMono;
    } else if (
      typeof input.flightStartMono === 'number' &&
      Number.isFinite(input.flightStartMono) &&
      input.flightStartMono > 0 &&
      serverAckX >= 1
    ) {
      resolvedServerXMono = input.flightStartMono + Math.log(serverAckX) / k;
    } else if (intendedX && intendedX >= 1 && serverAckX >= 1) {
      resolvedServerXMono = clickMono + Math.log(serverAckX / intendedX) / k;
    } else {
      resolvedServerXMono = nowMs();
    }

    const signedTimeDeltaMs = resolvedServerXMono - clickMono;
    const xCurveDeltaMs =
      intendedX && intendedX >= 1 && serverAckX >= 1 ? Math.log(serverAckX / intendedX) / k : undefined;

    let chosenDelta = signedTimeDeltaMs;
    if (
      typeof xCurveDeltaMs === 'number' &&
      Number.isFinite(xCurveDeltaMs) &&
      Math.abs(chosenDelta) <= CLICK_X_DISCREPANCY_THRESHOLD_MS &&
      Math.abs(xCurveDeltaMs) > Math.abs(chosenDelta)
    ) {
      chosenDelta = xCurveDeltaMs;
    }

    const signedDeltaMs = Number(chosenDelta.toFixed(3));
    const discrepancyMs = Number(Math.abs(signedDeltaMs).toFixed(3));
    const discrepancyExceeded = discrepancyMs > CLICK_X_DISCREPANCY_THRESHOLD_MS;

    const existing = this.calibratedTags.get(key);
    const ov = this.tagOverrides.get(key);
    const previousLeadMs = existing?.recommendedLeadMs ?? this.globalManualLeadMs;
    let adjustedLeadMs = previousLeadMs;
    let calibrationAdjustmentMs = 0;

    if (discrepancyExceeded) {
      this.totalClickXDiscrepancies += 1;
      const effMode: TagLeadMode = ov?.mode ?? existing?.mode ?? this.globalLeadMode;

      if (effMode !== 'manual_ms') {
        const directionSign = signedDeltaMs >= 0 ? 1 : -1;
        const stepMag =
          directionSign > 0
            ? Math.min(250, Math.max(1, Math.round(discrepancyMs * 0.65)))
            : Math.min(120, Math.max(1, Math.round(discrepancyMs * 0.45)));
        const candidateLead = Math.max(
          15,
          Math.min(MAX_PRETRIG_LEAD_MS, previousLeadMs + directionSign * stepMag),
        );
        calibrationAdjustmentMs = candidateLead - previousLeadMs;
        adjustedLeadMs = candidateLead;

        const nextMeasuredAccept =
          existing && existing.measuredServerAcceptMs > 0
            ? Math.round(existing.measuredServerAcceptMs * 0.7 + discrepancyMs * 0.3)
            : Math.round(discrepancyMs);

        this.calibratedTags.set(key, {
          tag: key,
          sampleCount: existing?.sampleCount ?? 0,
          medianDeficitMs: existing?.medianDeficitMs ?? 0,
          measuredServerAcceptMs: nextMeasuredAccept,
          recommendedLeadMs: adjustedLeadMs,
          appliedMultiplier: existing?.appliedMultiplier ?? this.globalLeadMultiplier,
          mode: effMode,
          calibrated: true,
          late400Streak: existing?.late400Streak ?? 0,
          late400RuleActive: existing?.late400RuleActive ?? false,
          late400BoostMs: existing?.late400BoostMs ?? 0,
          lastCrashGapMs: existing?.lastCrashGapMs ?? 0,
        });
      }

      this.lastCalibrationAdjustmentMs = calibrationAdjustmentMs;

      const xInfo = intendedX ? ` (target=${intendedX.toFixed(2)}x, ack=${serverAckX.toFixed(2)}x)` : ` (ack=${serverAckX.toFixed(2)}x)`;
      const msg = `Click-X discrepancy ${discrepancyMs.toFixed(3)}ms (>1ms)${xInfo} · clickMono=${clickMono.toFixed(2)}ms vs X-ack=${resolvedServerXMono.toFixed(2)}ms -> lead ${previousLeadMs}ms -> ${adjustedLeadMs}ms`;
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn(`[TriggerTap TimingEngine] ${msg}`);
      }
      this.pushEvent({
        id: `cxv_${++this.seq}_${Date.now().toString(36)}`,
        tag: key,
        status: 'CHECKING',
        attempts: 1,
        elapsedMs: discrepancyMs,
        intervalMs: discrepancyMs,
        buttonState: 'ready',
        reason: msg,
        timestamp: fmtTimeMs(),
      });
    }

    const record: ClickXVerificationRecord = {
      id: `cxv_${++this.seq}_${Date.now().toString(36)}`,
      roundId: String(input.roundId || `R${this.clickXVerifications.length + 1}`).slice(0, 28),
      tag: key,
      clickMono: Number(clickMono.toFixed(3)),
      serverAckX: Number(serverAckX.toFixed(4)),
      intendedX,
      resolvedServerXMono: Number(resolvedServerXMono.toFixed(3)),
      signedDeltaMs,
      discrepancyMs,
      discrepancyExceeded,
      calibrationAdjustmentMs,
      previousLeadMs,
      adjustedLeadMs,
      timestamp: fmtTimeMs(),
    };

    this.clickXVerifications.unshift(record);
    if (this.clickXVerifications.length > 40) {
      this.clickXVerifications.length = 40;
    }

    this.scheduleNotify(true);
    return record;
  }

  public setGlobalLeadConfig(mode: TagLeadMode, multiplier?: number, manualMs?: number): void {
    this.globalLeadMode = mode === 'manual_mult' || mode === 'manual_ms' ? mode : 'auto';
    if (typeof multiplier === 'number' && Number.isFinite(multiplier)) {
      this.globalLeadMultiplier = Math.max(
        AUTO_LEAD_MIN_MULTIPLIER,
        Math.min(AUTO_LEAD_MAX_MULTIPLIER, Math.round(multiplier * 2) / 2),
      );
    }
    if (typeof manualMs === 'number' && Number.isFinite(manualMs)) {
      this.globalManualLeadMs = Math.max(0, Math.min(MAX_PRETRIG_LEAD_MS, Math.round(manualMs)));
    }
    this.scheduleNotify(true);
  }

  public setTagLeadOverride(tag: string, mode: TagLeadMode, multiplier?: number, manualMs?: number): TagLeadOverride {
    const key = tag.trim() || 'DEFAULT';
    const prev = this.tagOverrides.get(key);
    const nextMult =
      typeof multiplier === 'number' && Number.isFinite(multiplier)
        ? Math.max(AUTO_LEAD_MIN_MULTIPLIER, Math.min(AUTO_LEAD_MAX_MULTIPLIER, Math.round(multiplier * 2) / 2))
        : prev?.multiplier ?? this.globalLeadMultiplier;
    const nextMs =
      typeof manualMs === 'number' && Number.isFinite(manualMs)
        ? Math.max(0, Math.min(MAX_PRETRIG_LEAD_MS, Math.round(manualMs)))
        : prev?.manualMs ?? this.globalManualLeadMs;
    const ov: TagLeadOverride = {
      tag: key,
      mode: mode === 'manual_mult' || mode === 'manual_ms' ? mode : 'auto',
      multiplier: nextMult,
      manualMs: nextMs,
      updatedAt: Date.now(),
    };
    this.tagOverrides.set(key, ov);

    const existing = this.calibratedTags.get(key);
    const humanComp = this.autoHumanProfile.enabled ? Math.round(this.autoHumanProfile.avgHumanSpanMs) : 0;
    const rttFloor = 75;
    const baseBudget = existing
      ? Math.max(existing.medianDeficitMs, existing.measuredServerAcceptMs, rttFloor, 85) + humanComp
      : Math.max(115, rttFloor + humanComp);
    const scaledMultLead = Math.round(baseBudget * (ov.multiplier / 3) * 1.15);
    const monoMultFloor = Math.round(rttFloor + humanComp * 0.5 + (ov.multiplier - 1) * 18);
    const computedLead =
      ov.mode === 'manual_ms'
        ? ov.manualMs
        : ov.mode === 'manual_mult'
          ? Math.min(MAX_PRETRIG_LEAD_MS, Math.max(15, scaledMultLead, monoMultFloor))
          : existing?.recommendedLeadMs ?? this.globalManualLeadMs;
    this.calibratedTags.set(key, {
      tag: key,
      sampleCount: existing?.sampleCount ?? 0,
      medianDeficitMs: existing?.medianDeficitMs ?? 0,
      measuredServerAcceptMs: existing?.measuredServerAcceptMs ?? 0,
      recommendedLeadMs: computedLead,
      appliedMultiplier: ov.mode === 'manual_mult' ? ov.multiplier : (existing?.appliedMultiplier ?? ov.multiplier),
      mode: ov.mode,
      calibrated: Boolean(existing?.calibrated || ov.mode !== 'auto'),
      late400Streak: existing?.late400Streak ?? 0,
      late400RuleActive: existing?.late400RuleActive ?? false,
      late400BoostMs: existing?.late400BoostMs ?? 0,
      lastCrashGapMs: existing?.lastCrashGapMs ?? 0,
    });

    this.scheduleNotify(true);
    return ov;
  }

  public removeTagLeadOverride(tag: string): void {
    const key = tag.trim();
    if (!key) return;
    this.tagOverrides.delete(key);
    const existing = this.calibratedTags.get(key);
    if (existing) {
      this.calibratedTags.set(key, { ...existing, mode: 'auto' });
    }
    this.scheduleNotify(true);
  }

  public getEffectiveLeadForTag(
    tag: string,
  ): {
    mode: TagLeadMode;
    multiplier: number;
    leadMs: number;
    late400Streak: number;
    late400RuleActive: boolean;
    late400BoostMs: number;
    lastCrashGapMs: number;
  } {
    const key = tag.trim() || 'DEFAULT';
    const ov = this.tagOverrides.get(key);
    const rec = this.calibratedTags.get(key);
    const lateMeta = {
      late400Streak: rec?.late400Streak ?? 0,
      late400RuleActive: Boolean(rec?.late400RuleActive),
      late400BoostMs: rec?.late400BoostMs ?? 0,
      lastCrashGapMs: rec?.lastCrashGapMs ?? 0,
    };
    const computeScaledForMult = (mult: number): number => {
      const humanComp = this.autoHumanProfile.enabled ? Math.round(this.autoHumanProfile.avgHumanSpanMs) : 0;
      const rttFloor = 75;
      const base = rec
        ? Math.max(rec.medianDeficitMs, rec.measuredServerAcceptMs, rttFloor, 85) + humanComp
        : Math.max(115, rttFloor + humanComp);
      const scaled = Math.round(base * (mult / 3) * 1.15);
      const monoFloor = Math.round(rttFloor + humanComp * 0.5 + (mult - 1) * 18);
      return Math.min(MAX_PRETRIG_LEAD_MS, Math.max(15, scaled, monoFloor));
    };
    if (ov) {
      if (ov.mode === 'manual_ms') {
        return { mode: 'manual_ms', multiplier: ov.multiplier, leadMs: ov.manualMs, ...lateMeta };
      }
      if (ov.mode === 'manual_mult') {
        return { mode: 'manual_mult', multiplier: ov.multiplier, leadMs: computeScaledForMult(ov.multiplier), ...lateMeta };
      }
    }
    if (this.globalLeadMode === 'manual_ms') {
      return { mode: 'manual_ms', multiplier: this.globalLeadMultiplier, leadMs: this.globalManualLeadMs, ...lateMeta };
    }
    if (this.globalLeadMode === 'manual_mult') {
      return {
        mode: 'manual_mult',
        multiplier: this.globalLeadMultiplier,
        leadMs: computeScaledForMult(this.globalLeadMultiplier),
        ...lateMeta,
      };
    }
    return {
      mode: 'auto',
      multiplier: rec?.appliedMultiplier ?? this.globalLeadMultiplier,
      leadMs: rec?.recommendedLeadMs ?? this.globalManualLeadMs,
      ...lateMeta,
    };
  }

  public getTagPreSignalWindow(tag: string): PreSignal2xWindow {
    const eff = this.getEffectiveLeadForTag(tag);
    return computePreSignal2xWindow(eff.leadMs, eff.late400RuleActive ? eff.late400BoostMs : 0);
  }

  public getAutoHumanProfile(): AutoHumanAntiBotProfile {
    return { ...this.autoHumanProfile };
  }

  public setAutoHumanClickEnabled(enabled: boolean): AutoHumanAntiBotProfile {
    this.autoHumanProfile.enabled = Boolean(enabled);
    this.autoHumanProfile.lastAdaptationReason = enabled
      ? 'Auto human-mimic envelope enabled'
      : 'Auto human-mimic envelope paused';
    this.autoHumanProfile.updatedAt = Date.now();
    this.scheduleNotify(true);
    return { ...this.autoHumanProfile };
  }

  public applyExternalAutoHumanProfile(patch: Partial<AutoHumanAntiBotProfile>): AutoHumanAntiBotProfile {
    const p = this.autoHumanProfile;
    if (typeof patch.enabled === 'boolean') p.enabled = patch.enabled;
    if (typeof patch.preDownMinMs === 'number') p.preDownMinMs = Math.max(1, Math.min(80, Number(patch.preDownMinMs.toFixed(1))));
    if (typeof patch.preDownMaxMs === 'number') p.preDownMaxMs = Math.max(p.preDownMinMs + 2, Math.min(120, Number(patch.preDownMaxMs.toFixed(1))));
    if (typeof patch.holdMinMs === 'number') p.holdMinMs = Math.max(8, Math.min(90, Number(patch.holdMinMs.toFixed(1))));
    if (typeof patch.holdMaxMs === 'number') p.holdMaxMs = Math.max(p.holdMinMs + 4, Math.min(140, Number(patch.holdMaxMs.toFixed(1))));
    if (typeof patch.postUpMinMs === 'number') p.postUpMinMs = Math.max(0.5, Math.min(20, Number(patch.postUpMinMs.toFixed(1))));
    if (typeof patch.postUpMaxMs === 'number') p.postUpMaxMs = Math.max(p.postUpMinMs + 0.5, Math.min(35, Number(patch.postUpMaxMs.toFixed(1))));
    if (typeof patch.minFlightReactionMs === 'number') p.minFlightReactionMs = Math.max(90, Math.min(600, Math.round(patch.minFlightReactionMs)));
    if (typeof patch.coordinateJitterPx === 'number') p.coordinateJitterPx = Math.max(1.5, Math.min(10, Number(patch.coordinateJitterPx.toFixed(1))));
    if (typeof patch.acceptStreak === 'number') p.acceptStreak = Math.max(0, Math.round(patch.acceptStreak));
    if (typeof patch.rejectCount === 'number') p.rejectCount = Math.max(0, Math.round(patch.rejectCount));
    if (typeof patch.avgHumanSpanMs === 'number') p.avgHumanSpanMs = Math.max(8, Math.min(300, Number(patch.avgHumanSpanMs.toFixed(1))));
    if (typeof patch.lastAdaptationReason === 'string' && patch.lastAdaptationReason) {
      p.lastAdaptationReason = patch.lastAdaptationReason.slice(0, 140);
    }
    p.updatedAt = Date.now();
    this.scheduleNotify(false);
    return { ...p };
  }

  /**
   * Closed-loop server anti-bot & rate-limit adaptation.
   * Escalates human reaction/hold/jitter automatically on fast-click or rate-limit rejections,
   * and gently optimizes while keeping a realistic human floor on clean acceptances.
   */
  public recordServerClickFeedback(feedback: ServerClickFeedback): AutoHumanAntiBotProfile {
    const p = this.autoHumanProfile;
    const midPre = (p.preDownMinMs + p.preDownMaxMs) * 0.5;
    const midHold = (p.holdMinMs + p.holdMaxMs) * 0.5;
    const midPost = (p.postUpMinMs + p.postUpMaxMs) * 0.5;
    const measuredSpan =
      typeof feedback.actualHumanSpanMs === 'number' && feedback.actualHumanSpanMs > 0
        ? feedback.actualHumanSpanMs
        : midPre + midHold + midPost;
    p.avgHumanSpanMs = Number((p.avgHumanSpanMs * 0.65 + measuredSpan * 0.35).toFixed(1));

    if (feedback.outcome === 'BOT_REJECTED' || feedback.outcome === 'RATE_LIMITED') {
      p.acceptStreak = 0;
      p.rejectCount += 1;
      const stepBoost = feedback.outcome === 'RATE_LIMITED' ? 1.45 : 1.0;
      p.preDownMinMs = Math.min(48, Number((p.preDownMinMs + 5.5 * stepBoost).toFixed(1)));
      p.preDownMaxMs = Math.min(95, Number((Math.max(p.preDownMinMs + 6, p.preDownMaxMs + 12.0 * stepBoost)).toFixed(1)));
      p.holdMinMs = Math.min(55, Number((p.holdMinMs + 6.0 * stepBoost).toFixed(1)));
      p.holdMaxMs = Math.min(115, Number((Math.max(p.holdMinMs + 10, p.holdMaxMs + 13.0 * stepBoost)).toFixed(1)));
      p.postUpMinMs = Math.min(12, Number((p.postUpMinMs + 0.8 * stepBoost).toFixed(1)));
      p.postUpMaxMs = Math.min(24, Number((Math.max(p.postUpMinMs + 1.5, p.postUpMaxMs + 1.8 * stepBoost)).toFixed(1)));
      p.minFlightReactionMs = Math.min(480, Math.round(p.minFlightReactionMs + 35 * stepBoost));
      p.coordinateJitterPx = Math.min(8.5, Number((p.coordinateJitterPx + 0.6).toFixed(1)));
      p.avgHumanSpanMs = Number(
        (
          (p.preDownMinMs + p.preDownMaxMs) * 0.5 +
          (p.holdMinMs + p.holdMaxMs) * 0.5 +
          (p.postUpMinMs + p.postUpMaxMs) * 0.5
        ).toFixed(1),
      );
      p.lastAdaptationReason = `${feedback.outcome}${feedback.errText ? ` (${feedback.errText.slice(0, 32)})` : ''} -> auto-widened hold ${p.holdMinMs}-${p.holdMaxMs}ms, pre ${p.preDownMinMs}-${p.preDownMaxMs}ms`;

      // Auto-compensate calibrated Pre-Trigger leads so wider human click still beats crash (never overwrite manual_ms)
      for (const [k, rec] of this.calibratedTags.entries()) {
        const effMode = this.tagOverrides.get(k)?.mode ?? rec.mode;
        if (effMode === 'manual_ms' || (effMode === 'auto' && this.globalLeadMode === 'manual_ms' && !this.tagOverrides.has(k))) {
          continue;
        }
        const compLead = Math.min(
          MAX_PRETRIG_LEAD_MS,
          Math.max(rec.recommendedLeadMs, Math.round(rec.recommendedLeadMs + p.avgHumanSpanMs * 0.55)),
        );
        this.calibratedTags.set(k, { ...rec, recommendedLeadMs: compLead });
      }
    } else if (feedback.outcome === 'ACCEPTED') {
      p.acceptStreak += 1;
      if (p.acceptStreak >= 4) {
        p.preDownMinMs = Math.max(4.5, Number((p.preDownMinMs * 0.94).toFixed(1)));
        p.preDownMaxMs = Math.max(p.preDownMinMs + 5, Number((p.preDownMaxMs * 0.94).toFixed(1)));
        p.holdMinMs = Math.max(14.0, Number((p.holdMinMs * 0.94).toFixed(1)));
        p.holdMaxMs = Math.max(p.holdMinMs + 10, Number((p.holdMaxMs * 0.94).toFixed(1)));
        p.minFlightReactionMs = Math.max(110, Math.round(p.minFlightReactionMs * 0.96));
      }
      p.lastAdaptationReason = `Server ACCEPTED (${p.acceptStreak} streak) · span ~${p.avgHumanSpanMs.toFixed(0)}ms`;
    } else if (feedback.outcome === 'LATE') {
      p.acceptStreak = 0;
      p.lastAdaptationReason = `Late crash gap logged · Auto-Lead advancing while keeping human floor ${p.holdMinMs}-${p.holdMaxMs}ms`;
    }

    p.updatedAt = Date.now();
    this.scheduleNotify(true);
    return { ...p };
  }

  /**
   * Sub-millisecond recursive retry check for disabled / `btn_off` cashout buttons.
   * Uses a MessageChannel pump + DOM MutationObserver wake-up so every recursive tick
   * yields to the browser without blocking layout/painting, achieving ~0.15ms-0.5ms resolution.
   */
  public enqueueBtnOffRetry(options: SubMsRetryOptions): string {
    const id = options.id || `retry_${++this.seq}_${Date.now().toString(36)}`;
    if (this.retryTasks.has(id)) {
      this.cancelRetry(id, 'REPLACED');
    }

    const startMono = nowMs();
    const maxAttempts = Math.max(1, Math.min(1200, options.maxAttempts ?? 300));
    const maxDurationMs = Math.max(2, Math.min(5000, options.maxDurationMs ?? 600));
    const tag = String(options.tag || 'CASHOUT').slice(0, 40);

    const resolveEl = (): HTMLElement | null => {
      if (typeof options.resolveTarget === 'function') {
        const resolved = options.resolveTarget();
        if (resolved) return resolved;
      }
      return options.target ?? null;
    };

    const initialInsp = inspectCashoutButtonState(resolveEl());
    this.totalBtnOffDetections += 1;
    this.totalRetriesScheduled += 1;

    const entry: RetryQueueItem = {
      id,
      tag,
      enqueuedAtMono: startMono,
      lastCheckedMono: startMono,
      attempts: 0,
      maxAttempts,
      maxDurationMs,
      state: initialInsp.state,
      lastReason: initialInsp.reason,
    };

    const task: InternalRetryTask = {
      entry,
      options,
      cancelled: false,
      finished: false,
      channel: typeof MessageChannel === 'function' ? new MessageChannel() : null,
      safetyTimer: null,
      observer: null,
      intervalSumMs: 0,
      intervalSamples: 0,
    };

    this.retryTasks.set(id, task);
    this.pushEvent({
      id,
      tag,
      status: 'ENQUEUED',
      attempts: 0,
      elapsedMs: 0,
      intervalMs: 0,
      buttonState: initialInsp.state,
      reason: initialInsp.reason,
      timestamp: fmtTimeMs(),
    });
    this.scheduleNotify(true);

    let stepTimer: ReturnType<typeof setTimeout> | null = null;
    const cleanupTask = () => {
      task.finished = true;
      if (stepTimer !== null) {
        clearTimeout(stepTimer);
        stepTimer = null;
      }
      if (task.safetyTimer !== null) {
        clearTimeout(task.safetyTimer);
        task.safetyTimer = null;
      }
      if (task.observer) {
        try {
          task.observer.disconnect();
        } catch {
          // ignore
        }
        task.observer = null;
      }
      if (task.channel) {
        try {
          task.channel.port1.onmessage = null;
          task.channel.port1.close();
          task.channel.port2.close();
        } catch {
          // ignore
        }
        task.channel = null;
      }
      this.retryTasks.delete(id);
    };

    const finishExhausted = (reason: string) => {
      if (task.finished || task.cancelled) return;
      const elapsed = Number((nowMs() - startMono).toFixed(3));
      cleanupTask();
      this.totalExhausted += 1;
      this.pushEvent({
        id,
        tag,
        status: 'EXHAUSTED',
        attempts: entry.attempts,
        elapsedMs: elapsed,
        intervalMs: this.lastCheckIntervalMs,
        buttonState: entry.state,
        reason,
        timestamp: fmtTimeMs(),
      });
      this.scheduleNotify(true);
      try {
        options.onExhausted?.(reason, entry.attempts, elapsed);
      } catch {
        // ignore callback errors
      }
    };

    let checkScheduled = false;
    const scheduleNextRecursiveCheck = (forceSubMs = false) => {
      if (task.finished || task.cancelled) return;
      if (checkScheduled && !forceSubMs) return;
      if (forceSubMs && stepTimer !== null) {
        clearTimeout(stepTimer);
        stepTimer = null;
        checkScheduled = false;
      }
      if (checkScheduled) return;
      checkScheduled = true;

      const elapsed = nowMs() - startMono;
      // Sub-millisecond recursive MessageChannel burst for initial window or when Adaptive Retry Windowing
      // elevates retry frequency during a stuck state (`forceSubMsFrequency`).
      const subMsAttemptCap = options.forceSubMsFrequency ? 96 : 16;
      const subMsTimeCapMs = options.forceSubMsFrequency ? 30.0 : 2.0;
      if (forceSubMs || (elapsed < subMsTimeCapMs && entry.attempts < subMsAttemptCap)) {
        if (task.channel) {
          task.channel.port2.postMessage(null);
        } else {
          queueMicrotask(runRecursiveCheck);
        }
      } else {
        stepTimer = setTimeout(() => {
          stepTimer = null;
          runRecursiveCheck();
        }, 1);
      }
    };

    const runRecursiveCheck = () => {
      checkScheduled = false;
      if (task.finished || task.cancelled) return;

      const checkStart = nowMs();
      const stepDelta = Math.max(0.01, checkStart - entry.lastCheckedMono);
      entry.lastCheckedMono = checkStart;
      entry.attempts += 1;
      this.totalChecksExecuted += 1;

      task.intervalSumMs += stepDelta;
      task.intervalSamples += 1;
      this.lastCheckIntervalMs = stepDelta;
      this.avgCheckIntervalMs =
        this.avgCheckIntervalMs === 0
          ? stepDelta
          : this.avgCheckIntervalMs * 0.8 + stepDelta * 0.2;

      const el = resolveEl();
      if (stepDelta > 24) {
        this.monitorFrameDrop(stepDelta, el);
      }
      const insp = inspectCashoutButtonState(el);
      entry.state = insp.state;
      entry.lastReason = insp.reason;

      try {
        options.onAttempt?.(entry.attempts, insp, stepDelta);
      } catch {
        // ignore
      }

      if (insp.isReady && el) {
        const elapsed = Number((nowMs() - startMono).toFixed(3));
        cleanupTask();
        this.totalRecoveries += 1;
        this.pushEvent({
          id,
          tag,
          status: 'RECOVERED',
          attempts: entry.attempts,
          elapsedMs: elapsed,
          intervalMs: Number(stepDelta.toFixed(3)),
          buttonState: insp.state,
          reason: `Button became active after ${entry.attempts} sub-ms check(s)`,
          timestamp: fmtTimeMs(),
        });
        this.scheduleNotify(true);
        try {
          options.onReady(el, {
            attempts: entry.attempts,
            elapsedMs: elapsed,
            lastIntervalMs: Number(stepDelta.toFixed(3)),
          });
        } catch {
          // ignore
        }
        return;
      }

      const elapsedSoFar = nowMs() - startMono;
      if (entry.attempts >= entry.maxAttempts || elapsedSoFar >= entry.maxDurationMs) {
        finishExhausted(
          `Retry budget reached (${entry.attempts}/${entry.maxAttempts} checks, ${elapsedSoFar.toFixed(2)}ms): ${insp.reason}`,
        );
        return;
      }

      // Throttled UI telemetry update every few attempts so UI never stutters
      if (entry.attempts === 1 || entry.attempts % 10 === 0) {
        this.scheduleNotify(false);
      }

      // Recursive sub-millisecond continuation
      scheduleNextRecursiveCheck(false);
    };

    if (task.channel) {
      task.channel.port1.onmessage = runRecursiveCheck;
    }

    // Safety hard-deadline timer in case tab throttles background timers
    task.safetyTimer = setTimeout(() => {
      if (!task.finished && !task.cancelled) {
        finishExhausted(`Max retry duration (${maxDurationMs}ms) expired`);
      }
    }, maxDurationMs + 12);

    // Lightweight attribute-only MutationObserver scoped strictly to target button (zero body/subtree lag)
    const initialEl = resolveEl();
    if (typeof MutationObserver === 'function' && initialEl) {
      try {
        task.observer = new MutationObserver(() => {
          if (task.finished || task.cancelled) return;
          const curEl = resolveEl();
          if (inspectCashoutButtonState(curEl).isReady) {
            scheduleNextRecursiveCheck(true);
          }
        });
        task.observer.observe(initialEl, {
          attributes: true,
          attributeFilter: ['disabled', 'aria-disabled', 'class', 'style', 'hidden', 'data-state', 'data-status', 'data-disabled'],
          childList: false,
          characterData: false,
          subtree: false,
        });
      } catch {
        // ignore observer attach failures
      }
    }

    // Kick off first sub-millisecond recursive check immediately
    scheduleNextRecursiveCheck();
    return id;
  }

  public cancelRetry(id: string, reason = 'CANCELLED'): boolean {
    const task = this.retryTasks.get(id);
    if (!task) return false;
    task.cancelled = true;
    const elapsed = Number((nowMs() - task.entry.enqueuedAtMono).toFixed(3));
    if (task.safetyTimer !== null) clearTimeout(task.safetyTimer);
    if (task.observer) {
      try {
        task.observer.disconnect();
      } catch {
        // ignore
      }
    }
    if (task.channel) {
      try {
        task.channel.port1.onmessage = null;
        task.channel.port1.close();
        task.channel.port2.close();
      } catch {
        // ignore
      }
    }
    this.retryTasks.delete(id);
    this.pushEvent({
      id,
      tag: task.entry.tag,
      status: 'CANCELLED',
      attempts: task.entry.attempts,
      elapsedMs: elapsed,
      intervalMs: this.lastCheckIntervalMs,
      buttonState: task.entry.state,
      reason,
      timestamp: fmtTimeMs(),
    });
    this.scheduleNotify(true);
    return true;
  }

  public cancelAllRetries(reason = 'ROUND_END'): number {
    const ids = Array.from(this.retryTasks.keys());
    for (const id of ids) {
      this.cancelRetry(id, reason);
    }
    return ids.length;
  }

  /**
   * Dynamic server-acceptance predictive lead calibration (Auto 3x -> 10x)
   * Automatically scales up to 10x when server cashout acceptance requires wider lead time.
   */
  public recordRoundTimingSample(sample: RoundTimingSample): AutoLeadCalibrationResult {
    const key = sample.tag.trim() || 'DEFAULT';
    const arr = this.roundSamples.get(key) ?? [];
    arr.push(sample);
    if (arr.length > AUTO_LEAD_MAX_ROUNDS) {
      arr.splice(0, arr.length - AUTO_LEAD_MAX_ROUNDS);
    }
    this.roundSamples.set(key, arr);

    const humanEnvelopeCompMs = this.autoHumanProfile.enabled
      ? Math.round(this.autoHumanProfile.avgHumanSpanMs)
      : 0;

    const serverAcceptWindows = arr
      .map((s) => {
        const tagToClick = Math.max(0, s.clickMono - s.tagArrivalMono);
        const clickToAck =
          typeof s.serverAckMono === 'number' && s.serverAckMono > s.clickMono
            ? s.serverAckMono - s.clickMono
            : typeof s.outCashMono === 'number' && s.outCashMono > s.clickMono
              ? (s.outCashMono - s.clickMono) * 2
              : 0;
        return tagToClick + clickToAck;
      })
      .filter((v) => v > 0);

    const measuredServerAcceptMs =
      serverAcceptWindows.length > 0
        ? Math.round(serverAcceptWindows.reduce((a, b) => a + b, 0) / serverAcceptWindows.length)
        : 0;

    const deficits = arr
      .map((s) => {
        const rawGap = s.crashMono > 0 ? Math.max(0, s.clickMono - s.crashMono) : 0;
        if (s.outcome === 'MISSED' || s.outcome === 'LATE') {
          const tagToClick = Math.max(0, s.clickMono - s.tagArrivalMono);
          const clickToAck =
            typeof s.serverAckMono === 'number' && s.serverAckMono > s.clickMono
              ? s.serverAckMono - s.clickMono
              : typeof s.outCashMono === 'number' && s.outCashMono > s.clickMono
                ? (s.outCashMono - s.clickMono) * 2
                : 0;
          const acceptEst = tagToClick + clickToAck;
          return Math.max(
            rawGap,
            Math.round((acceptEst > 0 ? acceptEst : measuredServerAcceptMs || 90) + humanEnvelopeCompMs + 140),
            180,
          );
        }
        return rawGap;
      })
      .sort((a, b) => a - b);

    const mid = Math.floor(deficits.length / 2);
    const medianDeficitMs =
      deficits.length === 0
        ? 0
        : deficits.length % 2 === 1
          ? deficits[mid]
          : (deficits[mid - 1] + deficits[mid]) / 2;

    const lateCount = deficits.filter((d) => d > 0).length;
    const roundCount = arr.length;
    let late400Streak = 0;
    for (let i = arr.length - 1; i >= 0; i--) {
      const smp = arr[i];
      const crashAfterDeficit = smp.crashMono > 0 ? smp.clickMono - smp.crashMono : 0;
      if (crashAfterDeficit >= LATE_400_THRESHOLD_MS) {
        late400Streak += 1;
      } else {
        break;
      }
    }
    const late400RuleActive = late400Streak >= AUTO_LEAD_MIN_ROUNDS;
    const late400BoostMs = late400RuleActive ? LATE_400_BOOST_MS : 0;

    const prevRec = this.calibratedTags.get(key);
    const prevMult = prevRec ? prevRec.appliedMultiplier : 3;
    const prevLead = prevRec ? prevRec.recommendedLeadMs : 0;
    const lastSample = arr[arr.length - 1];
    const lastRawGap = lastSample.crashMono > 0 ? Math.max(0, lastSample.clickMono - lastSample.crashMono) : 0;
    const lastIsMissOrLate = lastSample.outcome === 'LATE' || lastSample.outcome === 'MISSED';
    const lastAcceptEst =
      Math.max(0, lastSample.clickMono - lastSample.tagArrivalMono) +
      (typeof lastSample.serverAckMono === 'number' && lastSample.serverAckMono > lastSample.clickMono
        ? lastSample.serverAckMono - lastSample.clickMono
        : typeof lastSample.outCashMono === 'number' && lastSample.outCashMono > lastSample.clickMono
          ? (lastSample.outCashMono - lastSample.clickMono) * 2
          : 0);
    const lastDeficit = lastIsMissOrLate
      ? Math.max(
          lastRawGap,
          Math.round((lastAcceptEst > 0 ? lastAcceptEst : measuredServerAcceptMs || 90) + humanEnvelopeCompMs + 140),
          180,
        )
      : lastRawGap;
    const lastCrashGapMs =
      lastSample.crashMono > 0 ? Math.round(lastSample.crashMono - lastSample.clickMono) : 0;

    const ov = this.tagOverrides.get(key);
    const effMode: TagLeadMode = ov ? ov.mode : this.globalLeadMode;

    let multiplier = this.globalLeadMultiplier >= AUTO_LEAD_MIN_MULTIPLIER ? this.globalLeadMultiplier : 3;
    if (effMode === 'manual_mult') {
      multiplier = ov ? ov.multiplier : this.globalLeadMultiplier;
    } else if (lastDeficit > 0 || lastIsMissOrLate) {
      multiplier = Math.min(
        AUTO_LEAD_MAX_MULTIPLIER,
        Math.max(
          multiplier,
          prevMult + (lastDeficit > 0 || lastIsMissOrLate ? 1 : 0) + (lastDeficit > 180 ? 1 : 0),
          late400RuleActive ? LATE_400_MULTIPLIER : 1,
        ),
      );
    } else {
      multiplier = Math.max(AUTO_LEAD_MIN_MULTIPLIER, Math.min(AUTO_LEAD_MAX_MULTIPLIER, prevMult));
    }

    const baseBudget = Math.max(medianDeficitMs, measuredServerAcceptMs, 35) + humanEnvelopeCompMs;
    let recommendedLeadMs: number;
    if (effMode === 'manual_ms') {
      recommendedLeadMs = ov ? ov.manualMs : this.globalManualLeadMs;
    } else if (effMode === 'manual_mult') {
      recommendedLeadMs = Math.min(
        MAX_PRETRIG_LEAD_MS,
        Math.max(15, Math.round(baseBudget * (multiplier / 3) * 1.15 + (medianDeficitMs > 0 ? 18 : 0))),
      );
    } else {
      const basePrevLead = prevLead > 0 ? prevLead : this.globalManualLeadMs;
      recommendedLeadMs =
        medianDeficitMs > 0
          ? Math.min(MAX_PRETRIG_LEAD_MS, Math.round(baseBudget * (multiplier / 3) * 1.15 + 24))
          : Math.max(basePrevLead, Math.min(MAX_PRETRIG_LEAD_MS, Math.round(measuredServerAcceptMs + humanEnvelopeCompMs + 45)), 260);

      if ((lastDeficit > 0 || lastIsMissOrLate) && prevLead > 0 && recommendedLeadMs <= prevLead) {
        recommendedLeadMs = Math.min(
          MAX_PRETRIG_LEAD_MS,
          Math.round(prevLead + Math.max(lastDeficit, measuredServerAcceptMs * 0.5, 45) * (multiplier / 3)),
        );
      }
    }

    const result: AutoLeadCalibrationResult = {
      tag: key,
      sampleCount: roundCount,
      medianDeficitMs: Math.round(medianDeficitMs),
      measuredServerAcceptMs,
      recommendedLeadMs,
      appliedMultiplier: multiplier,
      mode: effMode,
      calibrated: effMode !== 'auto' || roundCount >= AUTO_LEAD_MIN_ROUNDS || lateCount >= 1 || lastIsMissOrLate || measuredServerAcceptMs > 0,
      late400Streak,
      late400RuleActive,
      late400BoostMs,
      lastCrashGapMs,
    };

    this.calibratedTags.set(key, result);
    if (sample.serverAckMono || sample.outCashMono) {
      const ackTime = sample.serverAckMono ?? sample.outCashMono ?? sample.clickMono;
      this.recordLatencyDriftSample({
        roundId: sample.roundId,
        tag: key,
        intendedClickMono: sample.clickMono,
        serverAckMono: ackTime,
        outcome:
          sample.outcome === 'MISSED' || sample.outcome === 'LATE'
            ? sample.outcome === 'LATE'
              ? 'LATE'
              : 'STUCK'
            : 'ACCEPTED',
      });
    } else {
      this.scheduleNotify(false);
    }
    if (typeof sample.serverAckX === 'number' && Number.isFinite(sample.serverAckX) && sample.serverAckX > 0) {
      this.verifyClickAgainstServerAckX({
        roundId: sample.roundId,
        tag: key,
        clickMono: sample.clickMono,
        serverAckX: sample.serverAckX,
        serverAckMono: sample.serverAckMono ?? sample.outCashMono,
        intendedX: sample.intendedX,
        flightStartMono: sample.flightStartMono,
        growthRateK: sample.growthRateK,
      });
    }
    return result;
  }

  public resetTelemetry(): void {
    this.cancelAllRetries('RESET');
    this.cancelAllXTriggers('RESET');
    this.totalBtnOffDetections = 0;
    this.totalRetriesScheduled = 0;
    this.totalChecksExecuted = 0;
    this.totalRecoveries = 0;
    this.totalExhausted = 0;
    this.lastCheckIntervalMs = 0;
    this.avgCheckIntervalMs = 0;
    this.recentEvents = [];
    this.clickXVerifications = [];
    this.totalClickXDiscrepancies = 0;
    this.lastCalibrationAdjustmentMs = 0;
    this.perfQueueScheduledCount = 0;
    this.perfQueuePrecalculatedCount = 0;
    this.perfQueueTriggeredCount = 0;
    this.perfTriggerJitterSumMs = 0;
    this.lastPrecalculatedItem = null;
    this.latencyGuard.consecutiveFrameDrops = 0;
    this.latencyGuard.lastFrameDeltaMs = 0;
    this.latencyGuard.lastLatencyDeltaMs = 0;
    this.latencyGuard.stuckStateDetected = false;
    this.latencyGuard.totalFrameDrops = 0;
    this.latencyGuard.totalForceReflows = 0;
    this.latencyGuard.lastForceReflowAt = 0;
    this.latencyGuard.lastForceReflowReason = 'Reset · threshold > 50ms';
    this.latencyGuard.samples = [];
    this.scheduleNotify(true);
  }
}

export const timingCalibrationEngine = new TimingCalibrationEngine();
