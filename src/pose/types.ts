export type PosePoint = {
    x: number;
    y: number;
    z: number;
    visibility: number;
};

export type ShoulderFrame = {
    left: PosePoint;
    right: PosePoint;
    mid: { x: number; y: number; z: number };
    width: number;
    drop: number;
    yaw: number;
    roll: number;
};

export type DetectedPose = {
    landmarks: PosePoint[];
    shoulders: ShoulderFrame | null;
    engine: string;
    error?: string;
};

export const POSE_NOSE = 0;
export const POSE_LEFT_EAR = 7;
export const POSE_RIGHT_EAR = 8;
export const POSE_LEFT_SHOULDER = 11;
export const POSE_RIGHT_SHOULDER = 12;
export const POSE_LEFT_ELBOW = 13;
export const POSE_RIGHT_ELBOW = 14;
export const POSE_LEFT_WRIST = 15;
export const POSE_RIGHT_WRIST = 16;
export const POSE_LEFT_HIP = 23;
export const POSE_RIGHT_HIP = 24;

/** 上半身连线：肩线 + 头肩 + 肘，不画腿。 */
export const UPPER_BODY_CONNECTIONS: Array<[number, number]> = [
    [POSE_NOSE, POSE_LEFT_SHOULDER],
    [POSE_NOSE, POSE_RIGHT_SHOULDER],
    [POSE_LEFT_SHOULDER, POSE_RIGHT_SHOULDER],
    [POSE_LEFT_SHOULDER, POSE_LEFT_ELBOW],
    [POSE_RIGHT_SHOULDER, POSE_RIGHT_ELBOW],
    [POSE_LEFT_ELBOW, POSE_LEFT_WRIST],
    [POSE_RIGHT_ELBOW, POSE_RIGHT_WRIST],
    [POSE_LEFT_SHOULDER, POSE_LEFT_HIP],
    [POSE_RIGHT_SHOULDER, POSE_RIGHT_HIP],
    [POSE_LEFT_HIP, POSE_RIGHT_HIP],
];
