import type { FaceBox } from '../face/types.ts';
import { HAND_FACE_PROBE, HAND_PALM_INDICES, type DetectedHand, type HandPoint } from './types.ts';

const inBox = (x: number, y: number, box: FaceBox, pad: number) => {
    const dx = box.width * pad;
    const dy = box.height * pad;
    return x >= box.x - dx && x <= box.x + box.width + dx
        && y >= box.y - dy && y <= box.y + box.height + dy;
};

export const palmCenter = (landmarks: HandPoint[]) => {
    const pts = HAND_PALM_INDICES
        .map((index) => landmarks[index])
        .filter((point): point is HandPoint => !!point && Number.isFinite(point.x));
    if (!pts.length) return { x: landmarks[0]?.x ?? 0, y: landmarks[0]?.y ?? 0 };
    return {
        x: pts.reduce((sum, point) => sum + point.x, 0) / pts.length,
        y: pts.reduce((sum, point) => sum + point.y, 0) / pts.length,
    };
};

export const handOverFace = (
    box: FaceBox | null | undefined,
    hands: DetectedHand[] | null | undefined,
    pad = 0.14,
) => {
    if (!box || !hands?.length) return false;
    for (const hand of hands) {
        for (const index of HAND_FACE_PROBE) {
            const point = hand.landmarks[index];
            if (!point) continue;
            if (inBox(point.x, point.y, box, pad)) return true;
        }
    }
    return false;
};
