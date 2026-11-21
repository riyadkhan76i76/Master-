/**
 * TimingCalibrationEngine
 *
 * Manages round-offset predictive lead calibration (Auto 3x -> 4x -> 5x)
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
  outcome: 'CASHED' | 'LATE' | 'BTN_OFF_RECOVERED' | 'MISSED';
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
}

export interface SubMsRetryOptions {
  id?: string;
  tag?: string;
  target?: HTMLElement | null;
  resolveTarget?: () => HTMLElement | null;
  maxAttempts?: number;
  maxDurationMs?: number;
  subMsBudgetMs?: number;
  onReady: (el: HTMLElement, meta: { attempts: number; elapsedMs: number; lastIntervalMs: number }) => void;
  onAttempt?: (attempt: number, inspection: ButtonInspectionResult, intervalMs: number) => void;
  onExhausted?: (reason: string, attempts: number, elapsedMs: number) => void;
}

const MAX_PRETRIG_LEAD_MS = 30_000;
const AUTO_LEAD_MIN_ROUNDS = 2;
const AUTO_LEAD_MAX_ROUNDS = 12;
const AUTO_LEAD_MIN_MULTIPLIER = 1;
const AUTO_LEAD_MAX_MULTIPLIER = 12;

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
  private globalManualLeadMs = 100;
  private autoHumanProfile: AutoHumanAntiBotProfile = createDefaultAutoHumanProfile();
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
    };
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
    const baseBudget = existing
      ? Math.max(existing.medianDeficitMs, existing.measuredServerAcceptMs, 60) +
        (this.autoHumanProfile.enabled ? Math.round(this.autoHumanProfile.avgHumanSpanMs) : 0)
      : 90;
    const computedLead =
      ov.mode === 'manual_ms'
        ? ov.manualMs
        : ov.mode === 'manual_mult'
          ? Math.min(MAX_PRETRIG_LEAD_MS, Math.max(15, Math.round(baseBudget * (ov.multiplier / 3) * 1.15)))
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

  public getEffectiveLeadForTag(tag: string): { mode: TagLeadMode; multiplier: number; leadMs: number } {
    const key = tag.trim() || 'DEFAULT';
    const ov = this.tagOverrides.get(key);
    const rec = this.calibratedTags.get(key);
    if (ov) {
      if (ov.mode === 'manual_ms') {
        return { mode: 'manual_ms', multiplier: ov.multiplier, leadMs: ov.manualMs };
      }
      if (ov.mode === 'manual_mult') {
        const base = rec && rec.recommendedLeadMs > 0
          ? Math.max(45, rec.measuredServerAcceptMs + (this.autoHumanProfile.enabled ? Math.round(this.autoHumanProfile.avgHumanSpanMs) : 0))
          : 90;
        const scaled = Math.min(MAX_PRETRIG_LEAD_MS, Math.max(15, Math.round(base * (ov.multiplier / 3) * 1.15)));
        return { mode: 'manual_mult', multiplier: ov.multiplier, leadMs: rec?.recommendedLeadMs || scaled };
      }
    }
    if (this.globalLeadMode === 'manual_ms') {
      return { mode: 'manual_ms', multiplier: this.globalLeadMultiplier, leadMs: this.globalManualLeadMs };
    }
    if (this.globalLeadMode === 'manual_mult') {
      const base = rec ? Math.max(45, rec.measuredServerAcceptMs + (this.autoHumanProfile.enabled ? Math.round(this.autoHumanProfile.avgHumanSpanMs) : 0)) : 90;
      return {
        mode: 'manual_mult',
        multiplier: this.globalLeadMultiplier,
        leadMs: Math.min(MAX_PRETRIG_LEAD_MS, Math.max(15, Math.round(base * (this.globalLeadMultiplier / 3) * 1.15))),
      };
    }
    return {
      mode: 'auto',
      multiplier: rec?.appliedMultiplier ?? this.globalLeadMultiplier,
      leadMs: rec?.recommendedLeadMs ?? this.globalManualLeadMs,
    };
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

      // Auto-compensate calibrated Pre-Trigger leads so wider human click still beats crash
      for (const [k, rec] of this.calibratedTags.entries()) {
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
      // Sub-millisecond recursive MessageChannel burst for initial 2ms (<=16 checks) or DOM-unlock wake-up,
      // then low-overhead 1ms step pacing across maxDurationMs so wait windows (10-600ms) never burn out in <6ms.
      if (forceSubMs || (elapsed < 2.0 && entry.attempts < 16)) {
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
   * Dynamic server-acceptance predictive lead calibration (3x -> 4x -> 5x -> ... -> 16x)
   * Automatically scales above 5x when server cashout acceptance requires wider lead time.
   */
  public recordRoundTimingSample(sample: RoundTimingSample): AutoLeadCalibrationResult {
    const key = sample.tag.trim() || 'DEFAULT';
    const arr = this.roundSamples.get(key) ?? [];
    arr.push(sample);
    if (arr.length > AUTO_LEAD_MAX_ROUNDS) {
      arr.splice(0, arr.length - AUTO_LEAD_MAX_ROUNDS);
    }
    this.roundSamples.set(key, arr);

    const deficits = arr
      .map((s) => Math.max(0, s.clickMono - s.crashMono))
      .sort((a, b) => a - b);

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

    const mid = Math.floor(deficits.length / 2);
    const medianDeficitMs =
      deficits.length === 0
        ? 0
        : deficits.length % 2 === 1
          ? deficits[mid]
          : (deficits[mid - 1] + deficits[mid]) / 2;

    const lateCount = deficits.filter((d) => d > 0).length;
    const roundCount = arr.length;
    const prevRec = this.calibratedTags.get(key);
    const prevMult = prevRec ? prevRec.appliedMultiplier : 3;
    const prevLead = prevRec ? prevRec.recommendedLeadMs : 0;
    const lastSample = arr[arr.length - 1];
    const lastDeficit = Math.max(0, lastSample.clickMono - lastSample.crashMono);

    const ov = this.tagOverrides.get(key);
    const effMode: TagLeadMode = ov ? ov.mode : this.globalLeadMode;

    let multiplier = this.globalLeadMultiplier >= AUTO_LEAD_MIN_MULTIPLIER ? this.globalLeadMultiplier : 3;
    if (effMode === 'manual_mult') {
      multiplier = ov ? ov.multiplier : this.globalLeadMultiplier;
    } else if (lastDeficit > 0 || lastSample.outcome === 'LATE' || lastSample.outcome === 'MISSED') {
      multiplier = Math.min(
        AUTO_LEAD_MAX_MULTIPLIER,
        Math.max(multiplier, prevMult + (lastDeficit > 0 ? 1 : 0) + (lastDeficit > 180 ? 1 : 0)),
      );
    } else {
      multiplier = Math.max(AUTO_LEAD_MIN_MULTIPLIER, Math.min(AUTO_LEAD_MAX_MULTIPLIER, prevMult));
    }

    const humanEnvelopeCompMs = this.autoHumanProfile.enabled
      ? Math.round(this.autoHumanProfile.avgHumanSpanMs)
      : 0;
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
      recommendedLeadMs =
        medianDeficitMs > 0
          ? Math.min(MAX_PRETRIG_LEAD_MS, Math.round(baseBudget * (multiplier / 3) * 1.15 + 24))
          : Math.max(prevLead, Math.min(MAX_PRETRIG_LEAD_MS, Math.round(measuredServerAcceptMs + humanEnvelopeCompMs + 45)), 100);

      if (lastDeficit > 0 && prevLead > 0 && recommendedLeadMs <= prevLead) {
        recommendedLeadMs = Math.min(
          MAX_PRETRIG_LEAD_MS,
          Math.round(prevLead + Math.max(lastDeficit, measuredServerAcceptMs * 0.5, 35) * (multiplier / 3)),
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
      calibrated: effMode !== 'auto' || roundCount >= AUTO_LEAD_MIN_ROUNDS || lateCount >= 1 || measuredServerAcceptMs > 0,
    };

    this.calibratedTags.set(key, result);
    this.scheduleNotify(false);
    return result;
  }

  public resetTelemetry(): void {
    this.cancelAllRetries('RESET');
    this.totalBtnOffDetections = 0;
    this.totalRetriesScheduled = 0;
    this.totalChecksExecuted = 0;
    this.totalRecoveries = 0;
    this.totalExhausted = 0;
    this.lastCheckIntervalMs = 0;
    this.avgCheckIntervalMs = 0;
    this.recentEvents = [];
    this.scheduleNotify(true);
  }
}

export const timingCalibrationEngine = new TimingCalibrationEngine();
