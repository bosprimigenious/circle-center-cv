export type FatigueLevel = 'ok' | 'warn' | 'danger';

export type FatigueLive = {
    ear: number | null;
    earThreshold: number;
    earOpen: number | null;
    eyesClosed: boolean;
    closedSec: number;
    perclos: number | null;
    gazeBlurry: boolean;
    yawn: boolean;
    yawnSec: number;
    headDown: boolean;
    blinkPerMin: number | null;
    blinkCount: number;
    orbitAspect: number | null;
    irisRadius: number | null;
    irisBaseline: number | null;
    eyeBlink: number | null;
    level: FatigueLevel;
    label: string;
    reasons: string[];
};

export type FatigueFrameInput = {
    tSec: number;
    ear: number | null;
    mar: number | null;
    jawOpen?: number | null;
    eyeBlink?: number | null;
    irisRadius?: number | null;
    orbitAspect?: number | null;
    headDown: boolean;
};
