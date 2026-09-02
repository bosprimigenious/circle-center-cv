export type DetectionFailureReason =
    | 'noSignal'
    | 'lowContrast'
    | 'noRingPattern'
    | 'edgeClipping'
    | null;

export interface FrameAnalysis {
    timestamp: number;
    frameWidth: number;
    frameHeight: number;
    centerX: number;
    centerY: number;
    offsetXNorm: number;
    offsetYNorm: number;
    brightPixelRatio: number;
    firstBrightRingBrightness?: number | null;
    ringCount: number;
    ringRadiiPx: number[];
    brightRingRadiiPx?: number[];
    darkRingRadiiPx?: number[];
    circularity: number;
    confidence: number;
    estimatedTiltXDeg: number;
    estimatedTiltYDeg: number;
    estimatedMirrorDeltaMm: number;
    status: 'searching' | 'detected' | 'centered';
    fringePattern?: 'rings' | 'ellipse' | 'straight';
    orientationRad?: number;
    lineOrientationRad?: number;
    lineCurve?: number;
    lineOffsetsNorm?: number[];
    signalStrength?: number;
    failureReason?: DetectionFailureReason;
}
