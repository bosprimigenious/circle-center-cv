import type { CheatSnapshot } from '../cheat/types';
import type { GazeOverlay } from '../gaze/types';

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

export type DetectedFace = {
    landmarks: FaceLandmarkPoint[];
    box: FaceBox;
    blendshapes: FaceBlendshape[];
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
};
