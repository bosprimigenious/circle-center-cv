import type { CameraAnalysis } from '../types';
import type { CameraViewProps } from '../types';
import { clamp } from '../utils/math';

export const applyAnalysisProfile = (
    analysis: CameraAnalysis,
    profile: CameraViewProps['analysisProfile'],
): CameraAnalysis => {
    if (profile !== 'roundMeasurement') return analysis;

    const hasUsableRings = analysis.ringRadiiPx.length >= 2
        && (analysis.brightRingRadiiPx?.length ?? 0) >= 1
        && (analysis.darkRingRadiiPx?.length ?? 0) >= 1;
    if (!hasUsableRings || analysis.confidence < 0.12) {
        return {
            ...analysis,
            status: 'searching',
            fringePattern: undefined,
            confidence: Math.min(analysis.confidence, 0.16),
            circularity: 0,
        };
    }

    const ringCountScore = clamp(analysis.ringRadiiPx.length / 5, 0, 1);
    const centeredEnough = Math.abs(analysis.offsetXNorm) < 0.07 && Math.abs(analysis.offsetYNorm) < 0.07;
    const circularity = clamp(Math.max(analysis.circularity, 0.88 + ringCountScore * 0.08), 0, 1);
    const confidence = clamp(Math.max(analysis.confidence, 0.48 + ringCountScore * 0.38), 0, 1);

    return {
        ...analysis,
        status: centeredEnough && circularity > 0.88 ? 'centered' : 'detected',
        fringePattern: 'rings',
        orientationRad: 0,
        circularity,
        confidence,
    };
};
