import { median } from '../cheat/geometry.ts';
import type { SpeechFrameInput, SpeechLive, SpeechTick, SpeechUtterance } from './types.ts';

/**
 * 视觉说话活动：MAR + jawOpen，不加新模型、不采音频。
 * 说话 = 嘴在动（MAR 方差），不是张着不动（哈欠/吃惊）。
 * 产物是带时间戳的说话段 + MAR 包络，后期拿来和语音能量做音画同步。
 */
export const SPEECH_THRESHOLDS = {
    MAR_REST_MAX: 0.10,
    MAR_SPEAK_DELTA: 0.035,
    MAR_SPEAK_ABS: 0.11,
    JAW_SPEAK: 0.16,
    JAW_REST_MAX: 0.10,
    MAR_YAWN: 0.50,
    YAWN_SEC: 0.6,
    ONSET_SEC: 0.10,
    OFFSET_SEC: 0.40,
    MIN_UTTER_SEC: 0.20,
    VAR_WINDOW_SEC: 0.45,
    VAR_SPEAK: 1.2e-4,
    BASELINE_SAMPLES: 12,
    ENVELOPE_SEC: 8,
    TICK_MIN_SEC: 0.05,
};

type OpenRun = {
    start: number;
    lastActive: number;
    peakMar: number;
    hadMotion: boolean;
};

export const varianceOf = (values: number[]) => {
    if (values.length < 3) return 0;
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
};

const emptyLive = (): SpeechLive => ({
    speaking: false,
    onset: false,
    utterSec: 0,
    count: 0,
    totalSpeakSec: 0,
    lastUtterance: null,
    utterances: [],
    envelope: [],
    mar: null,
    marBaseline: null,
    marStd: null,
    yawnHold: false,
    label: '未说话',
});

export class SpeechSession {
    private restMar: number[] = [];
    private marWindow: Array<{ t: number; mar: number }> = [];
    private ticks: SpeechTick[] = [];
    private utterances: SpeechUtterance[] = [];
    private current: OpenRun | null = null;
    private openSince: number | null = null;
    private lastOpen: number | null = null;
    private yawnSince: number | null = null;
    private lastT = 0;
    private last: SpeechLive = emptyLive();

    reset() {
        this.restMar = [];
        this.marWindow = [];
        this.ticks = [];
        this.utterances = [];
        this.current = null;
        this.openSince = null;
        this.lastOpen = null;
        this.yawnSince = null;
        this.lastT = 0;
        this.last = emptyLive();
    }

    snapshot() {
        return this.last;
    }

    ingest(input: SpeechFrameInput): SpeechLive {
        if (this.lastT && input.tSec + 0.4 < this.lastT) this.reset();
        this.lastT = input.tSec;

        const mar = input.mar;
        const jawOpen = input.jawOpen;
        if (mar != null && mar < SPEECH_THRESHOLDS.MAR_REST_MAX && (jawOpen == null || jawOpen < SPEECH_THRESHOLDS.JAW_REST_MAX)) {
            if (this.restMar.length < 40) this.restMar.push(mar);
        }

        if (mar != null) {
            this.marWindow.push({ t: input.tSec, mar });
            const windowStart = input.tSec - SPEECH_THRESHOLDS.VAR_WINDOW_SEC;
            this.marWindow = this.marWindow.filter((tick) => tick.t >= windowStart - 1e-6);
        }
        const marStd = varianceOf(this.marWindow.map((tick) => tick.mar));
        const motion = marStd >= SPEECH_THRESHOLDS.VAR_SPEAK;

        const baseline = this.restMar.length >= SPEECH_THRESHOLDS.BASELINE_SAMPLES
            ? median(this.restMar)
            : null;
        const speakMar = baseline != null
            ? Math.max(SPEECH_THRESHOLDS.MAR_SPEAK_ABS, baseline + SPEECH_THRESHOLDS.MAR_SPEAK_DELTA)
            : SPEECH_THRESHOLDS.MAR_SPEAK_ABS;
        const openNow = (mar != null && mar >= speakMar) || (jawOpen != null && jawOpen >= SPEECH_THRESHOLDS.JAW_SPEAK);

        const yawningNow = mar != null && mar >= SPEECH_THRESHOLDS.MAR_YAWN;
        if (yawningNow) this.yawnSince ??= input.tSec;
        else this.yawnSince = null;
        const yawnHold = this.yawnSince != null && input.tSec - this.yawnSince >= SPEECH_THRESHOLDS.YAWN_SEC;

        let onset = false;
        if (yawnHold) {
            this.openSince = null;
            this.lastOpen = null;
            this.current = null;
        } else if (openNow) {
            this.openSince ??= input.tSec;
            this.lastOpen = input.tSec;
            if (this.current) {
                this.current.lastActive = input.tSec;
                this.current.peakMar = Math.max(this.current.peakMar, mar ?? this.current.peakMar);
                this.current.hadMotion = this.current.hadMotion || motion;
            } else if (input.tSec - this.openSince >= SPEECH_THRESHOLDS.ONSET_SEC && motion) {
                this.current = {
                    start: this.openSince,
                    lastActive: input.tSec,
                    peakMar: mar ?? speakMar,
                    hadMotion: true,
                };
                onset = true;
            }
        } else if (this.lastOpen != null && input.tSec - this.lastOpen <= SPEECH_THRESHOLDS.OFFSET_SEC) {
            if (this.current) this.current.hadMotion = this.current.hadMotion || motion;
        } else {
            this.openSince = null;
            this.lastOpen = null;
            if (this.current) this.closeUtterance(this.current.lastActive);
        }

        const speaking = this.current != null;
        const utterSec = this.current ? Math.max(0, input.tSec - this.current.start) : 0;
        const totalSpeakSec = this.utterances.reduce((sum, item) => sum + item.duration, 0) + utterSec;

        this.pushTick({
            t: input.tSec,
            mar,
            jawOpen,
            speaking,
        });

        const count = this.utterances.length;
        this.last = {
            speaking,
            onset,
            utterSec,
            count,
            totalSpeakSec,
            lastUtterance: this.utterances[count - 1] ?? null,
            utterances: this.utterances.slice(),
            envelope: this.ticks.filter((tick) => tick.t >= input.tSec - SPEECH_THRESHOLDS.ENVELOPE_SEC),
            mar,
            marBaseline: baseline,
            marStd,
            yawnHold,
            label: speaking
                ? `说话中 · 第${count + 1}次`
                : count
                    ? `未说话 · 已记录 ${count} 次`
                    : '未说话',
        };
        return this.last;
    }

    private closeUtterance(end: number) {
        const run = this.current;
        this.current = null;
        if (!run) return;
        const duration = end - run.start;
        if (duration < SPEECH_THRESHOLDS.MIN_UTTER_SEC || !run.hadMotion) return;
        this.utterances.push({
            index: this.utterances.length + 1,
            start: run.start,
            end,
            duration,
            peakMar: run.peakMar,
        });
    }

    private pushTick(tick: SpeechTick) {
        const prev = this.ticks[this.ticks.length - 1];
        if (prev && tick.t - prev.t < SPEECH_THRESHOLDS.TICK_MIN_SEC && tick.speaking === prev.speaking) {
            this.ticks[this.ticks.length - 1] = tick;
            return;
        }
        this.ticks.push(tick);
    }
}
