export type FatigueLevel = 'ok' | 'warn' | 'danger';

export type FatigueLive = {
    ear: number | null;
    earLeft: number | null;
    earRight: number | null;
    earAsym: number | null;
    earThreshold: number;
    earOpen: number | null;
    earDrop: number | null;
    eyesClosed: boolean;
    closedSec: number;
    perclos: number | null;
    gazeBlurry: boolean;
    headDown: boolean;
    lookingDown: boolean;
    blinkPerMin: number | null;
    blinkCount: number;
    ibiSec: number | null;
    stareSec: number;
    orbitAspect: number | null;
    irisRadius: number | null;
    irisBaseline: number | null;
    eyeBlink: number | null;
    squintNotes: boolean;
    squintSec: number;
    eyesOffCam: boolean;
    irisOccluded: boolean;
    blinkSparse: boolean;
    blinkBurst: boolean;
    earAsymFlag: boolean;
    stare: boolean;
    level: FatigueLevel;
    label: string;
    reasons: string[];
};

export type FatigueFrameInput = {
    tSec: number;
    ear: number | null;
    earLeft?: number | null;
    earRight?: number | null;
    eyeBlink?: number | null;
    irisRadius?: number | null;
    orbitAspect?: number | null;
    headDown: boolean;
    lookingDown?: boolean;
    gazeAway?: boolean;
};
