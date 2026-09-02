import { median } from '../cheat/geometry.ts';
import { bestLagSec, resampleSeries } from './energy.ts';
import type { AvSyncFrameInput, AvSyncKind, AvSyncLevel, AvSyncLive } from './types.ts';

export const AVSYNC_THRESHOLDS = {
    RMS_REST_MAX: 0.012,
    RMS_SPEAK_ABS: 0.018,
    RMS_SPEAK_RATIO: 3.2,
    RMS_SPEAK_PAD: 0.006,
    BASELINE_SAMPLES: 16,
    ONSET_SEC: 0.08,
    OFFSET_SEC: 0.28,
    MIN_UTTER_SEC: 0.15,
    WINDOW_SEC: 6,
    DT: 0.05,
    MAX_LAG_SEC: 0.45,
    SYNC_LAG_SEC: 0.18,
    MIN_CORR_SAMPLES: 36,
    VISUAL_ONLY: 0.55,
    AUDIO_ONLY: 0.55,
    EITHER_MIN: 0.12,
};

type Tick = {
    t: number;
    mar: number;
    rms: number;
    visual: boolean;
    audio: boolean;
};

type Run = { start: number; last: number };

const emptyLive = (): AvSyncLive => ({
    rms: null,
    rmsBaseline: null,
    audioSpeaking: false,
    audioCount: 0,
    visualSpeaking: false,
    lagSec: null,
    overlap: null,
    kind: 'no_audio',
    level: 'ok',
    label: '无音频',
    reasons: [],
    audioError: null,
});

export class AvSyncSession {
    private restRms: number[] = [];
    private ticks: Tick[] = [];
    private audioRun: Run | null = null;
    private audioOpenSince: number | null = null;
    private lastAudioOpen: number | null = null;
    private audioCount = 0;
    private lastT = 0;
    private lastError: string | null = null;
    private last: AvSyncLive = emptyLive();

    reset() {
        this.restRms = [];
        this.ticks = [];
        this.audioRun = null;
        this.audioOpenSince = null;
        this.lastAudioOpen = null;
        this.audioCount = 0;
        this.lastT = 0;
        this.lastError = null;
        this.last = emptyLive();
    }

    snapshot() {
        return this.last;
    }

    ingest(input: AvSyncFrameInput): AvSyncLive {
        if (this.lastT && input.tSec + 0.4 < this.lastT) this.reset();
        this.lastT = input.tSec;
        if (input.audioError) this.lastError = input.audioError;

        const rms = input.rms;
        if (rms != null && rms < AVSYNC_THRESHOLDS.RMS_REST_MAX) {
            if (this.restRms.length < 48) this.restRms.push(rms);
        }
        const baseline = this.restRms.length >= AVSYNC_THRESHOLDS.BASELINE_SAMPLES
            ? median(this.restRms)
            : null;
        const speakRms = baseline != null
            ? Math.max(
                AVSYNC_THRESHOLDS.RMS_SPEAK_ABS,
                baseline * AVSYNC_THRESHOLDS.RMS_SPEAK_RATIO + AVSYNC_THRESHOLDS.RMS_SPEAK_PAD,
            )
            : AVSYNC_THRESHOLDS.RMS_SPEAK_ABS;
        const loud = rms != null && rms >= speakRms;
        const audioSpeaking = this.trackAudio(input.tSec, loud);

        if (rms != null && input.mar != null) {
            this.ticks.push({
                t: input.tSec,
                mar: input.mar,
                rms,
                visual: input.visualSpeaking,
                audio: audioSpeaking,
            });
            const keep = input.tSec - AVSYNC_THRESHOLDS.WINDOW_SEC;
            this.ticks = this.ticks.filter((tick) => tick.t >= keep - 1e-6);
        }

        const { lagSec, overlap, kind } = this.classify(rms != null);
        const reasons: string[] = [];
        if (this.lastError) reasons.push(this.lastError);
        if (kind === 'lag' && lagSec != null) {
            reasons.push(lagSec > 0 ? `声音晚 ${Math.round(lagSec * 1000)}ms` : `声音早 ${Math.round(-lagSec * 1000)}ms`);
        }
        if (kind === 'visual_only') reasons.push('嘴在动但几乎没声音');
        if (kind === 'audio_only') reasons.push('有声音但口型几乎不动');
        if (kind === 'sync' && lagSec != null) reasons.push(`偏移 ${Math.round(lagSec * 1000)}ms`);

        let level: AvSyncLevel = 'ok';
        if (kind === 'visual_only' || kind === 'audio_only') level = 'danger';
        else if (kind === 'lag' || kind === 'no_audio') level = kind === 'no_audio' ? 'ok' : 'warn';

        const label = (
            kind === 'no_audio' ? '无音频'
            : kind === 'warmup' ? '音画校准中'
            : kind === 'sync' ? '音画同步'
            : kind === 'lag' ? '音画偏移'
            : kind === 'visual_only' ? '对口型无声'
            : '有声無口型'
        );

        this.last = {
            rms,
            rmsBaseline: baseline,
            audioSpeaking,
            audioCount: this.audioCount + (this.audioRun ? 1 : 0),
            visualSpeaking: input.visualSpeaking,
            lagSec,
            overlap,
            kind,
            level,
            label,
            reasons,
            audioError: this.lastError,
        };
        return this.last;
    }

    private trackAudio(t: number, loud: boolean) {
        if (loud) {
            this.audioOpenSince ??= t;
            this.lastAudioOpen = t;
            if (this.audioRun) this.audioRun.last = t;
            else if (t - this.audioOpenSince >= AVSYNC_THRESHOLDS.ONSET_SEC) {
                this.audioRun = { start: this.audioOpenSince, last: t };
            }
        } else if (this.lastAudioOpen != null && t - this.lastAudioOpen <= AVSYNC_THRESHOLDS.OFFSET_SEC) {
            // syllable gap
        } else {
            if (this.audioRun && this.audioRun.last - this.audioRun.start >= AVSYNC_THRESHOLDS.MIN_UTTER_SEC) {
                this.audioCount += 1;
            }
            this.audioRun = null;
            this.audioOpenSince = null;
            this.lastAudioOpen = null;
        }
        return this.audioRun != null;
    }

    private classify(hasRms: boolean) {
        if (!hasRms && this.ticks.length === 0) {
            return { lagSec: null as number | null, overlap: null as number | null, kind: 'no_audio' as AvSyncKind };
        }
        const span = this.ticks.length >= 2
            ? this.ticks[this.ticks.length - 1].t - this.ticks[0].t
            : 0;
        if (this.ticks.length < AVSYNC_THRESHOLDS.MIN_CORR_SAMPLES || span < 2) {
            return { lagSec: null, overlap: null, kind: 'warmup' as AvSyncKind };
        }
        const start = this.ticks[0].t;
        const end = this.ticks[this.ticks.length - 1].t;
        const mar = resampleSeries(this.ticks.map((tick) => ({ t: tick.t, value: tick.mar })), start, end, AVSYNC_THRESHOLDS.DT);
        const rms = resampleSeries(this.ticks.map((tick) => ({ t: tick.t, value: tick.rms })), start, end, AVSYNC_THRESHOLDS.DT);
        const { lagSec, score } = bestLagSec(mar, rms, AVSYNC_THRESHOLDS.DT, AVSYNC_THRESHOLDS.MAX_LAG_SEC);

        let both = 0;
        let either = 0;
        let visual = 0;
        let audio = 0;
        for (const tick of this.ticks) {
            if (tick.visual) visual += 1;
            if (tick.audio) audio += 1;
            if (tick.visual || tick.audio) {
                either += 1;
                if (tick.visual && tick.audio) both += 1;
            }
        }
        const n = this.ticks.length;
        const overlap = either > 0 ? both / either : 1;
        const visualShare = n ? visual / n : 0;
        const audioShare = n ? audio / n : 0;
        const eitherShare = n ? either / n : 0;

        let kind: AvSyncKind = 'sync';
        if (eitherShare >= AVSYNC_THRESHOLDS.EITHER_MIN && visualShare >= AVSYNC_THRESHOLDS.VISUAL_ONLY && audioShare < 0.12) {
            kind = 'visual_only';
        } else if (eitherShare >= AVSYNC_THRESHOLDS.EITHER_MIN && audioShare >= AVSYNC_THRESHOLDS.AUDIO_ONLY && visualShare < 0.12) {
            kind = 'audio_only';
        } else if (lagSec != null && Math.abs(lagSec) > AVSYNC_THRESHOLDS.SYNC_LAG_SEC && score > 0.08) {
            kind = 'lag';
        } else {
            kind = 'sync';
        }
        return { lagSec, overlap, kind };
    }
}
