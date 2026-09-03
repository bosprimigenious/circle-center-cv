/**
 * 笔记本摄像头在屏幕上沿。面试时人看的是屏中的画面，不是镜头光轴。
 * atan(10cm / 62cm) ≈ 9.2°。符号与融合一致：负 pitch = 低头。
 */
export const CAMERA_TO_SCREEN_PITCH = -0.16;

export type ScreenOrigin = {
    yaw: number;
    pitch: number;
    source: 'default' | 'baseline';
};

export const screenOriginFrom = (baseline?: {
    fusedYaw?: number | null;
    fusedPitch?: number | null;
} | null): ScreenOrigin => {
    const pitchOk = baseline?.fusedPitch != null && Number.isFinite(baseline.fusedPitch);
    const yawOk = baseline?.fusedYaw != null && Number.isFinite(baseline.fusedYaw);
    return {
        yaw: yawOk ? baseline.fusedYaw as number : 0,
        pitch: pitchOk ? baseline.fusedPitch as number : CAMERA_TO_SCREEN_PITCH,
        source: pitchOk ? 'baseline' : 'default',
    };
};

export const relativeGaze = (
    gaze: { yaw: number; pitch: number } | null | undefined,
    origin: ScreenOrigin,
) => {
    if (!gaze) return null;
    return {
        yaw: gaze.yaw - origin.yaw,
        pitch: gaze.pitch - origin.pitch,
    };
};
