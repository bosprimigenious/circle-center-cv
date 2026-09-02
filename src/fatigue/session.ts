import { median } from '../cheat/geometry.ts';
import type { FatigueFrameInput, FatigueLevel, FatigueLive } from './types.ts';

/**
 * 几何疲劳：Soukupová EAR + PERCLOS（e-candeloro/Driver-State-Detection，MIT）
 * + 连续闭眼计时（浏览器 demo hargunsiingh/driver-drowsiness-detection）。
 * 视线模糊 = 眼裂变窄 / 虹膜被眼皮挡住，不是另训一个模型。
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
    MAR_YAWN: 0.50,
    YAWN_SEC: 0.6,
    CLOSED_WARN_SEC: 0.5,
    MICROSLEEP_SEC: 1.5,
    PERCLOS_WINDOW_SEC: 60,
    PERCLOS_WARMUP_SEC: 8,
    PERCLOS_WARN: 0.12,
    PERCLOS_TIRED: 0.20,
    BLINK_MIN_SEC: 0.06,
    BLINK_MAX_SEC: 0.45,
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
    earThreshold: FATIGUE_THRESHOLDS.EAR_CLOSED,
    earOpen: null,
    eyesClosed: false,
    closedSec: 0,
    perclos: null,
    gazeBlurry: false,
    yawn: false,
    yawnSec: 0,
    headDown: false,
    blinkPerMin: null,
    blinkCount: 0,
    orbitAspect: null,
    irisRadius: null,
    irisBaseline: null,
    eyeBlink: null,
    level: 'ok',
    label: '清醒',
    reasons: [],
});

export class FatigueSession {
    private ticks: Tick[] = [];
    private earOpen: number[] = [];
    private irisOpen: number[] = [];
    private closedSince: number | null = null;
    private yawnSince: number | null = null;
    private blinks: number[] = [];
    private last: FatigueLive = emptyLive();

    reset() {
        this.ticks = [];
        this.earOpen = [];
        this.irisOpen = [];
        this.closedSince = null;
        this.yawnSince = null;
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
        const eyesClosed = (input.ear != null && input.ear < earThreshold) || slit || blinkShut;

        if (input.ear != null && input.ear > FATIGUE_THRESHOLDS.EAR_CLOSED && !input.headDown && !eyesClosed) {
            if (this.earOpen.length < 40) this.earOpen.push(input.ear);
        }
        if (input.irisRadius != null && !eyesClosed && !slit) {
            if (this.irisOpen.length < 40) this.irisOpen.push(input.irisRadius);
        }

        const irisBaseline = median(this.irisOpen);
        const irisCovered = input.irisRadius != null && irisBaseline != null
            && input.irisRadius < irisBaseline * FATIGUE_THRESHOLDS.IRIS_COVERED_RATIO;
        const halfOpen = input.ear != null && input.ear < earThreshold * 1.12;
        const gazeBlurry = eyesClosed || slit || halfOpen || blinkShut || irisCovered;

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

        const yawningNow = (input.mar != null && input.mar > FATIGUE_THRESHOLDS.MAR_YAWN)
            || (input.jawOpen != null && input.jawOpen > 0.45);
        if (yawningNow) this.yawnSince ??= input.tSec;
        else this.yawnSince = null;
        const yawnSec = this.yawnSince == null ? 0 : Math.max(0, input.tSec - this.yawnSince);
        const yawn = yawnSec >= FATIGUE_THRESHOLDS.YAWN_SEC;

        this.ticks.push({ t: input.tSec, closed: eyesClosed });
        const windowStart = input.tSec - FATIGUE_THRESHOLDS.PERCLOS_WINDOW_SEC;
        this.ticks = this.ticks.filter((tick) => tick.t >= windowStart - 1e-6);
        this.blinks = this.blinks.filter((time) => time >= windowStart);

        const perclos = perclosFromTicks(this.ticks, input.tSec, FATIGUE_THRESHOLDS.PERCLOS_WINDOW_SEC);
        const closedSec = this.closedSince == null ? 0 : Math.max(0, input.tSec - this.closedSince);
        const span = this.ticks.length >= 2 ? this.ticks[this.ticks.length - 1].t - this.ticks[0].t : 0;
        const blinkPerMin = span >= FATIGUE_THRESHOLDS.PERCLOS_WARMUP_SEC
            ? this.blinks.length * (60 / Math.max(span, 1e-6))
            : null;

        const reasons: string[] = [];
        if (input.headDown) reasons.push('低头');
        if (gazeBlurry) reasons.push('视线模糊');
        if (closedSec >= FATIGUE_THRESHOLDS.MICROSLEEP_SEC) reasons.push('持续闭眼');
        if (perclos != null && perclos >= FATIGUE_THRESHOLDS.PERCLOS_TIRED) reasons.push('PERCLOS高');
        if (yawn) reasons.push('打哈欠');

        let level: FatigueLevel = 'ok';
        if (
            closedSec >= FATIGUE_THRESHOLDS.MICROSLEEP_SEC
            || (perclos != null && perclos >= FATIGUE_THRESHOLDS.PERCLOS_TIRED)
            || (input.headDown && gazeBlurry)
        ) {
            level = 'danger';
        } else if (
            input.headDown
            || gazeBlurry
            || yawn
            || closedSec >= FATIGUE_THRESHOLDS.CLOSED_WARN_SEC
            || (perclos != null && perclos >= FATIGUE_THRESHOLDS.PERCLOS_WARN)
        ) {
            level = 'warn';
        }

        const label = level === 'danger' ? '疲劳' : level === 'warn' ? '疑似疲劳' : '清醒';
        this.last = {
            ear: input.ear,
            earThreshold,
            earOpen: median(this.earOpen),
            eyesClosed,
            closedSec,
            perclos,
            gazeBlurry,
            yawn,
            yawnSec,
            headDown: input.headDown,
            blinkPerMin,
            blinkCount: this.blinks.length,
            orbitAspect: input.orbitAspect ?? null,
            irisRadius: input.irisRadius ?? null,
            irisBaseline,
            eyeBlink: input.eyeBlink ?? null,
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
