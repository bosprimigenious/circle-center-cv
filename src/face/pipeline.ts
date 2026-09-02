import { detectFaceLandmarks, warmupFaceLandmarker } from './landmarker';
import { estimateGazeFromBox, warmupGazeEstimator } from '../gaze/l2cs';
import type { L2csGaze } from '../gaze/types';
import { detectPoseLandmarks, warmupPoseLandmarker } from '../pose/landmarker';
import { shouldersFromPose } from '../pose/shoulders';
import type { DetectedPose } from '../pose/types';
import type { FaceFrameResult } from './types';

export type RunningMode = 'IMAGE' | 'VIDEO';

export type FrameDetect = {
    face: FaceFrameResult;
    pose: DetectedPose;
    l2cs: L2csGaze | null;
};

const L2CS_INTERVAL_MS = 180;

let lastL2cs: L2csGaze | null = null;
let lastL2csAt = -Infinity;
let l2csBusy = false;

export const resetPipelineCache = () => {
    lastL2cs = null;
    lastL2csAt = -Infinity;
    l2csBusy = false;
};

export const warmupVisionPipeline = async () => {
    await warmupFaceLandmarker();
    await Promise.all([warmupPoseLandmarker(), warmupGazeEstimator()]);
};

/**
 * 同一帧并行：Face 478 + Pose 33（肩）+ MobileGaze。
 * L2CS 依赖人脸框，图片模式等它结束；视频模式不挡下一帧，沿用最近一次。
 */
export const detectFrame = async (
    source: HTMLVideoElement | HTMLImageElement,
    mode: RunningMode,
    timestampMs = performance.now(),
): Promise<FrameDetect> => {
    const [face, poseRaw] = await Promise.all([
        detectFaceLandmarks(source, mode, timestampMs),
        detectPoseLandmarks(source, mode, timestampMs),
    ]);
    const nose = face.faces[0]?.landmarks[1];
    const pose: DetectedPose = {
        ...poseRaw,
        shoulders: shouldersFromPose(poseRaw.landmarks, nose) ?? poseRaw.shoulders,
    };

    const box = face.faces[0]?.box;
    const due = mode === 'IMAGE' || (!l2csBusy && timestampMs - lastL2csAt >= L2CS_INTERVAL_MS);
    if (box && due) {
        lastL2csAt = timestampMs;
        if (mode === 'IMAGE') {
            try {
                lastL2cs = await estimateGazeFromBox(source, box);
            } catch (error) {
                console.warn('MobileGaze infer failed', error);
            }
        } else {
            l2csBusy = true;
            void estimateGazeFromBox(source, box)
                .then((gaze) => {
                    if (gaze) lastL2cs = gaze;
                })
                .catch((error) => {
                    console.warn('MobileGaze infer failed', error);
                })
                .finally(() => {
                    l2csBusy = false;
                });
        }
    }

    return { face, pose, l2cs: lastL2cs };
};
