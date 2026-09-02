import type { HeadPose } from './headPose.ts';
import type { IrisGaze, L2csGaze } from './types.ts';

/** 虹膜归一化偏移 → 弧度。gazeX≈0.25 约 16° 眼内转。 */
export const IRIS_YAW_GAIN = 1.15;
export const IRIS_PITCH_GAIN = 1.0;
export const APPEARANCE_WEIGHT = 0.55;
export const L2CS_FRESH_MS = 400;
export const EMA_ALPHA = 0.38;

export type FuseInput = {
    head: HeadPose | null;
    iris: Pick<IrisGaze, 'gazeX' | 'gazeY'>;
    l2cs: L2csGaze | null;
    l2csAgeMs: number;
    blurry: boolean;
};

export type FuseResult = {
    geometric: L2csGaze | null;
    fused: L2csGaze | null;
    appearanceWeight: number;
};

let ema: L2csGaze | null = null;

export const resetGazeFuse = () => {
    ema = null;
};

/**
 * 混合视线：头部位姿 × 虹膜眼内转角（每帧几何）+ MobileGaze L2CS（外观）。
 * 闭眼/视线模糊时丢掉虹膜项，只留头 + L2CS。视频里 L2CS 节流，几何补帧间。
 */
export const geometricGazeFrom = (
    head: HeadPose | null,
    iris: Pick<IrisGaze, 'gazeX' | 'gazeY'>,
    blurry: boolean,
): L2csGaze | null => {
    const irisYaw = !blurry && iris.gazeX != null ? -iris.gazeX * IRIS_YAW_GAIN : 0;
    const irisPitch = !blurry && iris.gazeY != null ? -iris.gazeY * IRIS_PITCH_GAIN : 0;
    if (!head && (blurry || (iris.gazeX == null && iris.gazeY == null))) return null;
    return {
        yaw: (head?.yaw ?? 0) + irisYaw,
        pitch: (head?.pitch ?? 0) + irisPitch,
    };
};

export const fuseGazeInstant = (input: FuseInput): FuseResult => {
    const geometric = geometricGazeFrom(input.head, input.iris, input.blurry);
    const fresh = input.l2cs != null && input.l2csAgeMs <= L2CS_FRESH_MS;
    let appearanceWeight = 0;
    if (input.l2cs) {
        appearanceWeight = fresh ? APPEARANCE_WEIGHT : APPEARANCE_WEIGHT * 0.35;
        if (!geometric) appearanceWeight = 1;
    }
    if (!input.l2cs && !geometric) return { geometric, fused: null, appearanceWeight: 0 };
    if (!input.l2cs) return { geometric, fused: geometric, appearanceWeight: 0 };
    if (!geometric) return { geometric, fused: input.l2cs, appearanceWeight: 1 };
    const g = 1 - appearanceWeight;
    return {
        geometric,
        fused: {
            yaw: appearanceWeight * input.l2cs.yaw + g * geometric.yaw,
            pitch: appearanceWeight * input.l2cs.pitch + g * geometric.pitch,
        },
        appearanceWeight,
    };
};

export const fuseGaze = (input: FuseInput): FuseResult => {
    const instant = fuseGazeInstant(input);
    if (!instant.fused) {
        ema = null;
        return instant;
    }
    if (!ema) {
        ema = instant.fused;
        return { ...instant, fused: ema };
    }
    ema = {
        yaw: EMA_ALPHA * instant.fused.yaw + (1 - EMA_ALPHA) * ema.yaw,
        pitch: EMA_ALPHA * instant.fused.pitch + (1 - EMA_ALPHA) * ema.pitch,
    };
    return { ...instant, fused: ema };
};
