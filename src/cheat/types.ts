import type { CheatScore } from './scoring';

export type GazeDirection = 'left' | 'right';

export type CheatLive = {
    pitch: number | null;
    yaw: number | null;
    gazeX: number | null;
    gazeY: number | null;
    l2csYaw: number | null;
    l2csPitch: number | null;
    fusedYaw: number | null;
    fusedPitch: number | null;
    screenYaw: number | null;
    screenPitch: number | null;
    screenOrigin: 'default' | 'baseline' | null;
    relFusedYaw: number | null;
    relFusedPitch: number | null;
    irisLeftR: number | null;
    irisRightR: number | null;
    mar: number | null;
    ear: number | null;
    jawOpen: number | null;
    headDown: boolean;
    headTurn: boolean;
    headSource: 'shoulder' | 'face' | null;
    pitchBase: number | null;
    yawBase: number | null;
    pitchDelta: number | null;
    yawDelta: number | null;
    shoulderDropBase: number | null;
    shoulderYawBase: number | null;
    shoulderDropDelta: number | null;
    shoulderYawDelta: number | null;
    gazeAway: boolean;
    gazeDirection: GazeDirection | null;
    gazeLook: string;
    mouthOpen: boolean;
    shoulderVisible: boolean;
    shoulderDrop: number | null;
    shoulderYaw: number | null;
    faceQualityLabel: string;
    pitchTrusted: boolean;
    yawTrusted: boolean;
    irisTrusted: boolean;
    handOverFace: boolean;
    faceClipped: boolean;
};

export type CheatSegment = {
    start: number;
    end: number;
    direction?: string;
};

export type CheatRisk = {
    text: string;
    level: 'danger' | 'warn' | 'ok';
};

export type CheatVideoRes = {
    covered_ratio: number | null;
    static_ratio: number | null;
    sample_count: number;
    total_frames: number;
    read_success_count: number;
    read_failed_count: number;
    duration: number | null;
    down_ratio: number | null;
    away_ratio: number | null;
    head_turn_ratio: number | null;
    gaze_engine: string;
    gaze: {
        status: string;
        error: string;
        down_count: number;
        away_count: number;
        head_turn_count: number;
        face_detected_count: number;
        no_face_count: number;
        face_detected_ratio: number | null;
        no_face_ratio: number | null;
    };
    evidence_segments: {
        head_down: CheatSegment[];
        gaze_away: CheatSegment[];
    };
    quality_flags: string[];
    risks: CheatRisk[];
    score: number;
};

export type CheatSnapshot = {
    live: CheatLive;
    video: CheatVideoRes;
    videoSignals: string[];
    scored: CheatScore;
};

export type CheatFrameInput = {
    tSec: number;
    landmarks: Array<{ x: number; y: number; z: number }> | null;
    faceCount: number;
    jawOpen?: number | null;
    imageData?: ImageData;
    forceSample?: boolean;
    l2cs?: { yaw: number; pitch: number } | null;
    fused?: { yaw: number; pitch: number } | null;
    gazeEngine?: string;
    shoulders?: { drop: number; yaw: number } | null;
    quality?: {
        pitchTrusted: boolean;
        yawTrusted: boolean;
        irisTrusted: boolean;
        l2csTrusted: boolean;
        handOverFace?: boolean;
        clipped?: boolean;
        label?: string;
    } | null;
};
