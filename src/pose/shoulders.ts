import type { FaceLandmarkPoint } from '../face/types.ts';
import {
    POSE_LEFT_SHOULDER,
    POSE_NOSE,
    POSE_RIGHT_SHOULDER,
    type DetectedPose,
    type PosePoint,
    type ShoulderFrame,
} from './types.ts';

const VISIBLE = 0.45;

export const isVisible = (point: PosePoint | undefined | null) => (
    !!point && Number.isFinite(point.x) && Number.isFinite(point.y) && (point.visibility ?? 1) >= VISIBLE
);

export const shouldersFromPose = (
    landmarks: PosePoint[] | null | undefined,
    faceNose?: FaceLandmarkPoint | null,
): ShoulderFrame | null => {
    if (!landmarks || landmarks.length < 13) return null;
    const left = landmarks[POSE_LEFT_SHOULDER];
    const right = landmarks[POSE_RIGHT_SHOULDER];
    if (!isVisible(left) || !isVisible(right)) return null;
    const width = Math.hypot(right.x - left.x, right.y - left.y);
    if (width < 1e-4) return null;
    const mid = {
        x: (left.x + right.x) / 2,
        y: (left.y + right.y) / 2,
        z: (left.z + right.z) / 2,
    };
    const poseNose = landmarks[POSE_NOSE];
    const nose = faceNose && Number.isFinite(faceNose.x)
        ? faceNose
        : (isVisible(poseNose) ? poseNose : null);
    if (!nose) return null;
    return {
        left,
        right,
        mid,
        width,
        drop: (nose.y - mid.y) / width,
        yaw: (nose.x - mid.x) / width,
        roll: (right.y - left.y) / width,
    };
};

export const emptyPose = (engine: string, error?: string): DetectedPose => ({
    landmarks: [],
    shoulders: null,
    engine,
    error,
});
