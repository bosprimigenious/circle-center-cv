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
    leftElbow: PosePoint | null;
    rightElbow: PosePoint | null;
    leftWrist: PosePoint | null;
    rightWrist: PosePoint | null;
    leftHip: PosePoint | null;
    rightHip: PosePoint | null;
    hipWidth: number | null;
    torsoDrop: number | null;
    torsoRoll: number | null;
    leftRaise: number | null;
    rightRaise: number | null;
    poseFingers: number;
};

export type DetectedPose = {
    landmarks: PosePoint[];
    worldLandmarks: PosePoint[];
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
export const POSE_LEFT_PINKY = 17;
export const POSE_LEFT_INDEX = 18;
export const POSE_LEFT_THUMB = 19;
export const POSE_RIGHT_PINKY = 20;
export const POSE_RIGHT_INDEX = 21;
export const POSE_RIGHT_THUMB = 22;
export const POSE_LEFT_HIP = 23;
export const POSE_RIGHT_HIP = 24;

export const POSE_FINGER_INDICES = [
    POSE_LEFT_PINKY, POSE_LEFT_INDEX, POSE_LEFT_THUMB,
    POSE_RIGHT_PINKY, POSE_RIGHT_INDEX, POSE_RIGHT_THUMB,
] as const;

/** 上半身连线：肩肘腕指 + 髋，不画腿。 */
export const UPPER_BODY_CONNECTIONS: Array<[number, number]> = [
    [POSE_NOSE, POSE_LEFT_SHOULDER],
    [POSE_NOSE, POSE_RIGHT_SHOULDER],
    [POSE_LEFT_SHOULDER, POSE_RIGHT_SHOULDER],
    [POSE_LEFT_SHOULDER, POSE_LEFT_ELBOW],
    [POSE_RIGHT_SHOULDER, POSE_RIGHT_ELBOW],
    [POSE_LEFT_ELBOW, POSE_LEFT_WRIST],
    [POSE_RIGHT_ELBOW, POSE_RIGHT_WRIST],
    [POSE_LEFT_WRIST, POSE_LEFT_PINKY],
    [POSE_LEFT_WRIST, POSE_LEFT_INDEX],
    [POSE_LEFT_WRIST, POSE_LEFT_THUMB],
    [POSE_RIGHT_WRIST, POSE_RIGHT_PINKY],
    [POSE_RIGHT_WRIST, POSE_RIGHT_INDEX],
    [POSE_RIGHT_WRIST, POSE_RIGHT_THUMB],
    [POSE_LEFT_SHOULDER, POSE_LEFT_HIP],
    [POSE_RIGHT_SHOULDER, POSE_RIGHT_HIP],
    [POSE_LEFT_HIP, POSE_RIGHT_HIP],
];
