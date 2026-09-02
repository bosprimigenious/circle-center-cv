export type HeadPose = {
    yaw: number;
    pitch: number;
    roll: number;
};

type MatrixLike = {
    rows?: number;
    columns?: number;
    data: number[] | Float32Array;
};

/**
 * MediaPipe facialTransformationMatrixes：canonical face → 相机。
 * JS Matrix.data 按列主序 4×4（与 native Face Geometry 一致）。
 * yaw / pitch / roll 与 L2CS 同号：yaw>0 射线朝图像左。
 */
export const eulerFromMatrix = (matrix: MatrixLike | null | undefined): HeadPose | null => {
    const data = matrix?.data;
    if (!data || data.length < 16) return null;
    const r00 = data[0];
    const r10 = data[1];
    const r11 = data[5];
    const r20 = data[2];
    const r21 = data[6];
    const r22 = data[10];
    if (![r00, r10, r11, r20, r21, r22].every((value) => Number.isFinite(value))) return null;
    const yaw = Math.atan2(-r20, r00);
    const pitch = Math.atan2(r21, r22);
    const roll = Math.atan2(r10, r11);
    if (![yaw, pitch, roll].every(Number.isFinite)) return null;
    return { yaw, pitch, roll };
};

export const yawRotationMatrix = (yaw: number): number[] => {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    return [
        c, 0, -s, 0,
        0, 1, 0, 0,
        s, 0, c, 0,
        0, 0, 0, 1,
    ];
};
