import { detectFaceLandmarks, warmupFaceLandmarker } from './landmarker';
import { resetGazeFuse } from '../gaze/fuse';
import { estimateGazeFromBox, warmupGazeEstimator } from '../gaze/l2cs';
import type { L2csGaze } from '../gaze/types';
import { detectHandLandmarks, warmupHandLandmarker } from '../hand/landmarker';
import type { DetectedHands } from '../hand/types';
import { detectPoseLandmarks, warmupPoseLandmarker } from '../pose/landmarker';
import { shouldersFromPose } from '../pose/shoulders';
import type { DetectedPose } from '../pose/types';
import { l2csBoxTrusted } from './completeness';
import type { FaceFrameResult } from './types';

export type RunningMode = 'IMAGE' | 'VIDEO';

export type FrameDetect = {
    face: FaceFrameResult;
    pose: DetectedPose;
    hands: DetectedHands;
    l2cs: L2csGaze | null;
    l2csAgeMs: number;
};

const L2CS_INTERVAL_MS = 180;

let lastL2cs: L2csGaze | null = null;
let lastL2csStartedAt = -Infinity;
let lastL2csResolvedAt = -Infinity;
let l2csBusy = false;

export const resetPipelineCache = () => {
    lastL2cs = null;
    lastL2csStartedAt = -Infinity;
    lastL2csResolvedAt = -Infinity;
    l2csBusy = false;
    resetGazeFuse();
};

export const warmupVisionPipeline = async () => {
    await warmupFaceLandmarker();
    await Promise.all([warmupPoseLandmarker(), warmupHandLandmarker(), warmupGazeEstimator()]);
};

/**
 * 同一帧并行：Face 478 + Pose 33（full 肩肘腕髋）+ Hand 21×2 + MobileGaze。
 * L2CS 依赖人脸框，图片模式等它结束；视频模式不挡下一帧，沿用最近一次。
 */
export const detectFrame = async (
    source: HTMLVideoElement | HTMLImageElement,
    mode: RunningMode,
    timestampMs = performance.now(),
): Promise<FrameDetect> => {
    const [face, poseRaw, hands] = await Promise.all([
        detectFaceLandmarks(source, mode, timestampMs),
        detectPoseLandmarks(source, mode, timestampMs),
        detectHandLandmarks(source, mode, timestampMs),
    ]);
    const nose = face.faces[0]?.landmarks[1];
    const pose: DetectedPose = {
        ...poseRaw,
        shoulders: shouldersFromPose(poseRaw.landmarks, nose) ?? poseRaw.shoulders,
    };

    const box = face.faces[0]?.box;
    const due = mode === 'IMAGE' || (!l2csBusy && timestampMs - lastL2csStartedAt >= L2CS_INTERVAL_MS);
    if (box && due && l2csBoxTrusted(box)) {
        lastL2csStartedAt = timestampMs;
        if (mode === 'IMAGE') {
            try {
                lastL2cs = await estimateGazeFromBox(source, box);
                if (lastL2cs) lastL2csResolvedAt = timestampMs;
            } catch (error) {
                console.warn('MobileGaze infer failed', error);
            }
        } else {
            l2csBusy = true;
            void estimateGazeFromBox(source, box)
                .then((gaze) => {
                    if (gaze) {
                        lastL2cs = gaze;
                        lastL2csResolvedAt = performance.now();
                    }
                })
                .catch((error) => {
                    console.warn('MobileGaze infer failed', error);
                })
                .finally(() => {
                    l2csBusy = false;
                });
        }
    }

    return {
        face,
        pose,
        hands,
        l2cs: lastL2cs,
        l2csAgeMs: lastL2cs ? timestampMs - lastL2csResolvedAt : Number.POSITIVE_INFINITY,
    };
};
