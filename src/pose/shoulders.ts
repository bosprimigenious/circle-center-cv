import type { FaceLandmarkPoint } from '../face/types.ts';
import {
    POSE_FINGER_INDICES,
    POSE_LEFT_ELBOW,
    POSE_LEFT_HIP,
    POSE_LEFT_SHOULDER,
    POSE_LEFT_WRIST,
    POSE_NOSE,
    POSE_RIGHT_ELBOW,
    POSE_RIGHT_HIP,
    POSE_RIGHT_SHOULDER,
    POSE_RIGHT_WRIST,
    type DetectedPose,
    type PosePoint,
    type ShoulderFrame,
} from './types.ts';

const VISIBLE = 0.45;

export const isVisible = (point: PosePoint | undefined | null) => (
    !!point && Number.isFinite(point.x) && Number.isFinite(point.y) && (point.visibility ?? 1) >= VISIBLE
);

const visibleOrNull = (point: PosePoint | undefined): PosePoint | null => (
    isVisible(point) ? point as PosePoint : null
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

    const leftElbow = visibleOrNull(landmarks[POSE_LEFT_ELBOW]);
    const rightElbow = visibleOrNull(landmarks[POSE_RIGHT_ELBOW]);
    const leftWrist = visibleOrNull(landmarks[POSE_LEFT_WRIST]);
    const rightWrist = visibleOrNull(landmarks[POSE_RIGHT_WRIST]);
    const leftHip = visibleOrNull(landmarks[POSE_LEFT_HIP]);
    const rightHip = visibleOrNull(landmarks[POSE_RIGHT_HIP]);
    const hipWidth = leftHip && rightHip
        ? Math.hypot(rightHip.x - leftHip.x, rightHip.y - leftHip.y)
        : null;
    const midHip = leftHip && rightHip
        ? { x: (leftHip.x + rightHip.x) / 2, y: (leftHip.y + rightHip.y) / 2 }
        : null;
    const torsoDrop = midHip ? (nose.y - midHip.y) / width : null;
    const torsoRoll = leftHip && rightHip && hipWidth && hipWidth > 1e-4
        ? (rightHip.y - leftHip.y) / hipWidth
        : null;
    const poseFingers = POSE_FINGER_INDICES.reduce(
        (count, index) => count + (isVisible(landmarks[index]) ? 1 : 0),
        0,
    );

    return {
        left,
        right,
        mid,
        width,
        drop: (nose.y - mid.y) / width,
        yaw: (nose.x - mid.x) / width,
        roll: (right.y - left.y) / width,
        leftElbow,
        rightElbow,
        leftWrist,
        rightWrist,
        leftHip,
        rightHip,
        hipWidth,
        torsoDrop,
        torsoRoll,
        leftRaise: leftWrist ? left.y - leftWrist.y : null,
        rightRaise: rightWrist ? right.y - rightWrist.y : null,
        poseFingers,
    };
};

export const emptyPose = (engine: string, error?: string): DetectedPose => ({
    landmarks: [],
    worldLandmarks: [],
    shoulders: null,
    engine,
    error,
});
