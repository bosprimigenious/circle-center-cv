import { median } from '../cheat/geometry.ts';
import type { FatigueFrameInput, FatigueLevel, FatigueLive } from './types.ts';

/**
 * 面试眼部作弊：Soukupová EAR + PERCLOS 几何，不当疲劳报。
 * 眯眼看稿 / 闭眼离镜 / 眨眼过稀（盯屏）/ 眨眼过密（扫读）/ 虹膜被挡 / 左右眼不对称 / 凝视读稿。
 * 口径仍对齐 e-candeloro/Driver-State-Detection（MIT）的 PERCLOS 与连续闭眼计时，只改语义。
 */
export const FATIGUE_THRESHOLDS = {
    EAR_CLOSED: 0.21,
    EAR_MIN: 0.15,
    EAR_MAX: 0.28,
    EAR_CALIB_RATIO: 0.75,
    EAR_CALIB_SAMPLES: 8,
    ORBIT_SLIT: 0.28,
    BLINK_SHAPE: 0.45,
    IRIS_COVERED_RATIO: 0.55,
    CLOSED_WARN_SEC: 0.5,
    MICROSLEEP_SEC: 1.5,
    PERCLOS_WINDOW_SEC: 60,
    PERCLOS_WARMUP_SEC: 8,
    PERCLOS_WARN: 0.12,
    PERCLOS_OFFCAM: 0.20,
    BLINK_MIN_SEC: 0.06,
    BLINK_MAX_SEC: 0.45,
    BLINK_RATE_WARMUP_SEC: 20,
    BLINK_SPARSE_PER_MIN: 8,
    BLINK_BURST_PER_MIN: 28,
    STARE_SEC: 3.5,
    SQUINT_EAR_RATIO: 0.78,
    SQUINT_HOLD_SEC: 0.8,
    EAR_ASYM: 0.28,
};

type Tick = { t: number; closed: boolean };

export const perclosFromTicks = (ticks: Tick[], now: number, windowSec: number) => {
    const start = now - windowSec;
    const inWindow = ticks.filter((tick) => tick.t >= start - 1e-6);
    if (inWindow.length < 2) return null;
    const span = inWindow[inWindow.length - 1].t - inWindow[0].t;
    if (span < FATIGUE_THRESHOLDS.PERCLOS_WARMUP_SEC) return null;
    let closed = 0;
    for (let index = 1; index < inWindow.length; index += 1) {
        const dt = inWindow[index].t - inWindow[index - 1].t;
        if (dt <= 0) continue;
        if (inWindow[index - 1].closed) closed += dt;
    }
    return closed / span;
};

const emptyLive = (): FatigueLive => ({
    ear: null,
    earLeft: null,
    earRight: null,
    earAsym: null,
    earThreshold: FATIGUE_THRESHOLDS.EAR_CLOSED,
    earOpen: null,
    earDrop: null,
    eyesClosed: false,
    closedSec: 0,
    perclos: null,
    gazeBlurry: false,
    headDown: false,
    lookingDown: false,
    blinkPerMin: null,
    blinkCount: 0,
    ibiSec: null,
    stareSec: 0,
    orbitAspect: null,
    irisRadius: null,
    irisBaseline: null,
    eyeBlink: null,
    squintNotes: false,
    squintSec: 0,
    eyesOffCam: false,
    irisOccluded: false,
    blinkSparse: false,
    blinkBurst: false,
    earAsymFlag: false,
    stare: false,
    level: 'ok',
    label: '眼部正常',
    reasons: [],
});

export class FatigueSession {
    private ticks: Tick[] = [];
    private earOpen: number[] = [];
    private irisOpen: number[] = [];
    private closedSince: number | null = null;
    private squintSince: number | null = null;
    private blinks: number[] = [];
    private last: FatigueLive = emptyLive();

    reset() {
        this.ticks = [];
        this.earOpen = [];
        this.irisOpen = [];
        this.closedSince = null;
        this.squintSince = null;
        this.blinks = [];
        this.last = emptyLive();
    }

    snapshot() {
        return this.last;
    }

    ingest(input: FatigueFrameInput): FatigueLive {
        if (this.ticks.length && input.tSec + 0.4 < this.ticks[this.ticks.length - 1].t) this.reset();

        const earThreshold = this.earThreshold();
        const slit = input.orbitAspect != null && input.orbitAspect < FATIGUE_THRESHOLDS.ORBIT_SLIT;
        const blinkShut = input.eyeBlink != null && input.eyeBlink > FATIGUE_THRESHOLDS.BLINK_SHAPE;
        const eyesClosed = (input.ear != null && input.ear < earThreshold) || blinkShut;
        const lookingDown = input.lookingDown === true || input.headDown;

        if (input.ear != null && input.ear > FATIGUE_THRESHOLDS.EAR_CLOSED && !input.headDown && !eyesClosed && !slit) {
            if (this.earOpen.length < 40) this.earOpen.push(input.ear);
        }
        if (input.irisRadius != null && !eyesClosed && !slit) {
            if (this.irisOpen.length < 40) this.irisOpen.push(input.irisRadius);
        }

        const earOpen = median(this.earOpen);
        const earDrop = earOpen != null && input.ear != null ? earOpen - input.ear : null;
        const irisBaseline = median(this.irisOpen);
        const irisOccluded = input.irisRadius != null && irisBaseline != null
            && input.irisRadius < irisBaseline * FATIGUE_THRESHOLDS.IRIS_COVERED_RATIO;
        const earSquint = earOpen != null && input.ear != null
            && input.ear < earOpen * FATIGUE_THRESHOLDS.SQUINT_EAR_RATIO
            && input.ear >= earThreshold;
        const squintNotes = lookingDown && (slit || earSquint || eyesClosed);

        if (eyesClosed) {
            this.closedSince ??= input.tSec;
        } else {
            if (this.closedSince != null) {
                const duration = input.tSec - this.closedSince;
                if (duration >= FATIGUE_THRESHOLDS.BLINK_MIN_SEC && duration <= FATIGUE_THRESHOLDS.BLINK_MAX_SEC) {
                    this.blinks.push(input.tSec);
                }
            }
            this.closedSince = null;
        }

        if (squintNotes) this.squintSince ??= input.tSec;
        else this.squintSince = null;

        this.ticks.push({ t: input.tSec, closed: eyesClosed });
        const windowStart = input.tSec - FATIGUE_THRESHOLDS.PERCLOS_WINDOW_SEC;
        this.ticks = this.ticks.filter((tick) => tick.t >= windowStart - 1e-6);
        this.blinks = this.blinks.filter((time) => time >= windowStart);

        const perclos = perclosFromTicks(this.ticks, input.tSec, FATIGUE_THRESHOLDS.PERCLOS_WINDOW_SEC);
        const closedSec = this.closedSince == null ? 0 : Math.max(0, input.tSec - this.closedSince);
        const squintSec = this.squintSince == null ? 0 : Math.max(0, input.tSec - this.squintSince);
        const span = this.ticks.length >= 2 ? this.ticks[this.ticks.length - 1].t - this.ticks[0].t : 0;
        const blinkPerMin = span >= FATIGUE_THRESHOLDS.PERCLOS_WARMUP_SEC
            ? this.blinks.length * (60 / Math.max(span, 1e-6))
            : null;
        const ibiSec = this.blinks.length >= 2
            ? this.blinks[this.blinks.length - 1] - this.blinks[this.blinks.length - 2]
            : null;
        const lastBlinkAt = this.blinks.length ? this.blinks[this.blinks.length - 1] : null;
        const stareSec = eyesClosed || lastBlinkAt == null
            ? 0
            : Math.max(0, input.tSec - lastBlinkAt);
        const stare = lastBlinkAt != null && !eyesClosed && stareSec >= FATIGUE_THRESHOLDS.STARE_SEC;
        const rateReady = span >= FATIGUE_THRESHOLDS.BLINK_RATE_WARMUP_SEC && blinkPerMin != null;
        const blinkSparse = rateReady && blinkPerMin < FATIGUE_THRESHOLDS.BLINK_SPARSE_PER_MIN;
        const blinkBurst = rateReady && blinkPerMin > FATIGUE_THRESHOLDS.BLINK_BURST_PER_MIN;

        const earLeft = input.earLeft ?? null;
        const earRight = input.earRight ?? null;
        const earAsym = earLeft != null && earRight != null
            ? Math.abs(earLeft - earRight) / Math.max(earLeft, earRight, 1e-6)
            : null;
        const earAsymFlag = earAsym != null && earAsym >= FATIGUE_THRESHOLDS.EAR_ASYM && !eyesClosed;
        const eyesOffCam = closedSec >= FATIGUE_THRESHOLDS.MICROSLEEP_SEC;
        const gazeBlurry = eyesClosed || irisOccluded;

        const reasons: string[] = [];
        if (eyesOffCam) reasons.push('闭眼离镜');
        if (squintNotes) reasons.push('眯眼看稿');
        if (stare && input.gazeAway) reasons.push('凝视读稿');
        else if (stare) reasons.push('凝视过久');
        if (blinkSparse) reasons.push('眨眼过稀');
        if (blinkBurst) reasons.push('眨眼过密');
        if (irisOccluded) reasons.push('虹膜被挡');
        if (earAsymFlag) reasons.push('左右眼不对称');
        if (perclos != null && perclos >= FATIGUE_THRESHOLDS.PERCLOS_OFFCAM) reasons.push('闭眼占比高');

        let level: FatigueLevel = 'ok';
        if (
            eyesOffCam
            || (squintNotes && squintSec >= FATIGUE_THRESHOLDS.SQUINT_HOLD_SEC)
            || (stare && input.gazeAway && stareSec >= 5)
            || (perclos != null && perclos >= FATIGUE_THRESHOLDS.PERCLOS_OFFCAM)
        ) {
            level = 'danger';
        } else if (reasons.length || closedSec >= FATIGUE_THRESHOLDS.CLOSED_WARN_SEC) {
            level = 'warn';
        }

        const label = reasons[0] ?? (level === 'ok' ? '眼部正常' : '眼部异常');
        this.last = {
            ear: input.ear,
            earLeft,
            earRight,
            earAsym,
            earThreshold,
            earOpen,
            earDrop,
            eyesClosed,
            closedSec,
            perclos,
            gazeBlurry,
            headDown: input.headDown,
            lookingDown,
            blinkPerMin,
            blinkCount: this.blinks.length,
            ibiSec,
            stareSec,
            orbitAspect: input.orbitAspect ?? null,
            irisRadius: input.irisRadius ?? null,
            irisBaseline,
            eyeBlink: input.eyeBlink ?? null,
            squintNotes,
            squintSec,
            eyesOffCam,
            irisOccluded,
            blinkSparse,
            blinkBurst,
            earAsymFlag,
            stare,
            level,
            label,
            reasons,
        };
        return this.last;
    }

    private earThreshold() {
        if (this.earOpen.length < FATIGUE_THRESHOLDS.EAR_CALIB_SAMPLES) return FATIGUE_THRESHOLDS.EAR_CLOSED;
        const baseline = median(this.earOpen);
        if (baseline == null) return FATIGUE_THRESHOLDS.EAR_CLOSED;
        return Math.max(
            FATIGUE_THRESHOLDS.EAR_MIN,
            Math.min(FATIGUE_THRESHOLDS.EAR_MAX, baseline * FATIGUE_THRESHOLDS.EAR_CALIB_RATIO),
        );
    }
}
