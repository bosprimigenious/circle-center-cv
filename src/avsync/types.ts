export type AvSyncKind = 'no_audio' | 'warmup' | 'sync' | 'lag' | 'visual_only' | 'audio_only';

export type AvSyncLevel = 'ok' | 'warn' | 'danger';

export type AvSyncLive = {
    rms: number | null;
    rmsBaseline: number | null;
    audioSpeaking: boolean;
    audioCount: number;
    visualSpeaking: boolean;
    lagSec: number | null;
    overlap: number | null;
    kind: AvSyncKind;
    level: AvSyncLevel;
    label: string;
    reasons: string[];
    audioError: string | null;
};

export type AvSyncFrameInput = {
    tSec: number;
    mar: number | null;
    visualSpeaking: boolean;
    rms: number | null;
    audioError?: string | null;
};
