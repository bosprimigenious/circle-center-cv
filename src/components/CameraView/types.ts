import type { FrameAnalysis } from '../../types';
import type { CenterKalmanFilter } from './analysis/kalmanFilter';

type NumericCapability = {
    min: number;
    max: number;
    step?: number;
};

export type ExposureProperty = 'exposureTime' | 'exposureCompensation';

export type ExtendedCapabilities = MediaTrackCapabilities & {
    exposureMode?: string[];
    exposureTime?: NumericCapability;
    exposureCompensation?: NumericCapability;
};

export type ExtendedSettings = MediaTrackSettings & {
    exposureMode?: string;
    exposureTime?: number;
    exposureCompensation?: number;
};

export type ExposureControl = {
    property: ExposureProperty;
    min: number;
    max: number;
    step: number;
};

export type InputSourceMode = 'camera' | 'demo';

export type DemoPreset = {
    id: 'centered' | 'offset' | 'ellipse' | 'straight';
    label: string;
    description: string;
};

export type DemoCenterOffset = {
    x: number;
    y: number;
};

export type CameraAnalysis = FrameAnalysis & {
    peakBrightness: number;
    firstBrightRingBrightness: number | null;
};

export type AnalysisStabilizerState = {
    analysis: CameraAnalysis | null;
    candidatePattern: FrameAnalysis['fringePattern'] | null;
    candidatePatternCount: number;
    detectedCount: number;
    missingCount: number;
    kalman: CenterKalmanFilter | null;
};

export type RingCandidate = {
    radius: number;
    type: 'bright' | 'dark';
    strength: number;
};

export type RedSample = {
    x: number;
    y: number;
    weight: number;
};

export type LineModel = {
    angle: number;
    curve: number;
    offsetsNorm: number[];
};

export interface CameraViewProps {
    mode?: 'calibration' | 'collection' | 'analysis';
    onFrameAnalysis?: (analysis: CameraAnalysis) => void;
    onStreamReady?: (stream: MediaStream | null) => void;
    centerConfirmed?: boolean;
    autoAnalyze?: boolean;
    analysisProfile?: 'general' | 'roundMeasurement';
    onManualAnalyze?: () => void;
    manualAnalyzeLabel?: string;
    manualAnalyzeStatus?: string;
    className?: string;
}

export interface CameraViewHandle {
    captureFrame: () => string | null;
    analyzeCurrentFrame: () => FrameAnalysis | null;
}

export type { NumericCapability };
