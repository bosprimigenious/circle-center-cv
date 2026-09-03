import type { CheatSnapshot } from '../cheat/types';
import type { FatigueLive } from '../fatigue/types';
import type { HeadPose } from '../gaze/headPose';
import type { GazeOverlay } from '../gaze/types';
import type { DetectedHands } from '../hand/types';
import type { LookLive } from '../look/types';
import type { DetectedPose } from '../pose/types';
import type { AvSyncLive } from '../avsync/types';
import type { SpeechLive } from '../speech/types';

export type FaceLandmarkPoint = {
    x: number;
    y: number;
    z: number;
};

export type FaceBox = {
    x: number;
    y: number;
    width: number;
    height: number;
};

export type FaceBlendshape = {
    name: string;
    score: number;
};

export type FaceRegionName =
    | 'oval'
    | 'lips'
    | 'leftEye'
    | 'rightEye'
    | 'leftBrow'
    | 'rightBrow'
    | 'leftIris'
    | 'rightIris'
    | 'mesh';

export type FaceRegionCounts = Record<FaceRegionName, number>;

export type FaceQuality = {
    present: boolean;
    clipped: boolean;
    clipTop: boolean;
    clipBottom: boolean;
    clipLeft: boolean;
    clipRight: boolean;
    outFrac: number;
    profile: boolean;
    leftEyeOk: boolean;
    rightEyeOk: boolean;
    bothEyesOk: boolean;
    handOverFace: boolean;
    pitchTrusted: boolean;
    yawTrusted: boolean;
    irisTrusted: boolean;
    l2csTrusted: boolean;
    reasons: string[];
    label: string;
};

export type DetectedFace = {
    landmarks: FaceLandmarkPoint[];
    box: FaceBox;
    blendshapes: FaceBlendshape[];
    headPose: HeadPose | null;
};

export type FaceFrameResult = {
    timestamp: number;
    frameWidth: number;
    frameHeight: number;
    faceCount: number;
    landmarkCount: number;
    expectedLandmarkCount: number;
    regions: FaceRegionCounts;
    faces: DetectedFace[];
    engine: string;
    error?: string;
    cheat?: CheatSnapshot | null;
    gaze?: GazeOverlay | null;
    pose?: DetectedPose | null;
    hands?: DetectedHands | null;
    fatigue?: FatigueLive | null;
    look?: LookLive | null;
    speech?: SpeechLive | null;
    avsync?: AvSyncLive | null;
    quality?: FaceQuality | null;
};
