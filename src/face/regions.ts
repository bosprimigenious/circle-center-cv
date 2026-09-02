import { FaceLandmarker } from '@mediapipe/tasks-vision';
import type { FaceLandmarkPoint, FaceRegionCounts, FaceRegionName } from './types';

export const FACE_LANDMARK_COUNT = 478;
export const FACE_MESH_COUNT = 468;
export const FACE_IRIS_COUNT = 10;
export const LEFT_IRIS_INDICES = [473, 474, 475, 476, 477] as const;
export const RIGHT_IRIS_INDICES = [468, 469, 470, 471, 472] as const;

type Connection = { start: number; end: number };

const uniqueIndices = (connections: Connection[] | undefined) => {
    const indices = new Set<number>();
    if (!connections) return indices;
    connections.forEach((item) => {
        indices.add(item.start);
        indices.add(item.end);
    });
    return indices;
};

const fromList = (indices: readonly number[]) => new Set(indices);

export const faceRegionIndexSets = (): Record<FaceRegionName, Set<number>> => ({
    oval: uniqueIndices(FaceLandmarker.FACE_LANDMARKS_FACE_OVAL),
    lips: uniqueIndices(FaceLandmarker.FACE_LANDMARKS_LIPS),
    leftEye: uniqueIndices(FaceLandmarker.FACE_LANDMARKS_LEFT_EYE),
    rightEye: uniqueIndices(FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE),
    leftBrow: uniqueIndices(FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW),
    rightBrow: uniqueIndices(FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW),
    leftIris: fromList(LEFT_IRIS_INDICES),
    rightIris: fromList(RIGHT_IRIS_INDICES),
    mesh: fromList(Array.from({ length: FACE_MESH_COUNT }, (_, index) => index)),
});

export const countFaceRegions = (landmarks: FaceLandmarkPoint[]): FaceRegionCounts => {
    const sets = faceRegionIndexSets();
    const visible = (indices: Set<number>) => (
        [...indices].filter((index) => landmarks[index] !== undefined).length
    );
    return {
        oval: visible(sets.oval),
        lips: visible(sets.lips),
        leftEye: visible(sets.leftEye),
        rightEye: visible(sets.rightEye),
        leftBrow: visible(sets.leftBrow),
        rightBrow: visible(sets.rightBrow),
        leftIris: visible(sets.leftIris),
        rightIris: visible(sets.rightIris),
        mesh: visible(sets.mesh),
    };
};

export const emptyRegionCounts = (): FaceRegionCounts => ({
    oval: 0,
    lips: 0,
    leftEye: 0,
    rightEye: 0,
    leftBrow: 0,
    rightBrow: 0,
    leftIris: 0,
    rightIris: 0,
    mesh: 0,
});

export const regionLabels: Record<FaceRegionName, string> = {
    oval: '脸轮廓',
    lips: '嘴唇',
    leftEye: '左眼',
    rightEye: '右眼',
    leftBrow: '左眉',
    rightBrow: '右眉',
    leftIris: '左虹膜',
    rightIris: '右虹膜',
    mesh: '全脸网格',
};
