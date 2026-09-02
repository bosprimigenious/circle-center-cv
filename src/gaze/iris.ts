import type { FaceLandmarkPoint } from '../face/types';
import type { IrisEyeMeasure, IrisGaze, NormalizedBox } from './types';

/**
 * MediaPipe Face Landmarker naming: left/right = the person's own eyes.
 * Person-right orbit sits on image-left in an unmirrored frame (33 / 133).
 */
export const PERSON_RIGHT_ORBIT = [
    33, 7, 163, 144, 145, 153, 154, 155, 133, 246, 161, 160, 159, 158, 157, 173,
] as const;
export const PERSON_LEFT_ORBIT = [
    263, 249, 390, 373, 374, 380, 381, 382, 362, 466, 388, 387, 386, 385, 384, 398,
] as const;
export const PERSON_RIGHT_IRIS = [468, 469, 470, 471, 472] as const;
export const PERSON_LEFT_IRIS = [473, 474, 475, 476, 477] as const;
export const PERSON_RIGHT_IRIS_CENTER = 468;
export const PERSON_LEFT_IRIS_CENTER = 473;

const boxFromIndices = (lm: FaceLandmarkPoint[], indices: readonly number[]): NormalizedBox | null => {
    let minX = 1;
    let minY = 1;
    let maxX = 0;
    let maxY = 0;
    let count = 0;
    for (const index of indices) {
        const point = lm[index];
        if (!point) continue;
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
        count += 1;
    }
    if (count < 2) return null;
    const width = maxX - minX;
    const height = maxY - minY;
    if (width <= 1e-6) return null;
    return { x: minX, y: minY, width, height };
};

const irisMeasure = (
    lm: FaceLandmarkPoint[],
    orbitIdx: readonly number[],
    irisIdx: readonly number[],
    centerIdx: number,
): IrisEyeMeasure | null => {
    const orbit = boxFromIndices(lm, orbitIdx);
    if (!orbit) return null;
    const centerPoint = lm[centerIdx];
    let cx = 0;
    let cy = 0;
    let n = 0;
    for (const index of irisIdx) {
        const point = lm[index];
        if (!point) continue;
        cx += point.x;
        cy += point.y;
        n += 1;
    }
    if (!n) return null;
    cx /= n;
    cy /= n;
    if (centerPoint) {
        cx = (cx + centerPoint.x) / 2;
        cy = (cy + centerPoint.y) / 2;
    }
    let radiusSum = 0;
    let radiusN = 0;
    for (const index of irisIdx) {
        if (index === centerIdx) continue;
        const point = lm[index];
        if (!point) continue;
        radiusSum += Math.hypot(point.x - cx, point.y - cy);
        radiusN += 1;
    }
    const radius = radiusN ? radiusSum / radiusN : orbit.width * 0.18;
    const gazeX = (cx - (orbit.x + orbit.width / 2)) / orbit.width;
    const gazeY = orbit.height > 1e-4
        ? (cy - (orbit.y + orbit.height / 2)) / orbit.height
        : null;
    return {
        gazeX,
        gazeY,
        center: { x: cx, y: cy },
        radius,
        orbit,
    };
};

export const irisGazeFromLandmarks = (lm: FaceLandmarkPoint[] | null | undefined): IrisGaze => {
    if (!lm || lm.length <= 477) {
        return { left: null, right: null, gazeX: null, gazeY: null };
    }
    const right = irisMeasure(lm, PERSON_RIGHT_ORBIT, PERSON_RIGHT_IRIS, PERSON_RIGHT_IRIS_CENTER);
    const left = irisMeasure(lm, PERSON_LEFT_ORBIT, PERSON_LEFT_IRIS, PERSON_LEFT_IRIS_CENTER);
    const xs = [left?.gazeX, right?.gazeX].filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const ys = [left?.gazeY, right?.gazeY].filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    return {
        left,
        right,
        gazeX: xs.length ? xs.reduce((sum, value) => sum + value, 0) / xs.length : null,
        gazeY: ys.length ? ys.reduce((sum, value) => sum + value, 0) / ys.length : null,
    };
};
