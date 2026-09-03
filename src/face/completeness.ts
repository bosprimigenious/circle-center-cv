import { handOverFace as palmOverFace } from '../hand/geometry.ts';
import type { DetectedHand } from '../hand/types.ts';
import type { IrisGaze } from '../gaze/types.ts';
import { isVisible } from '../pose/shoulders.ts';
import { POSE_FINGER_INDICES, POSE_LEFT_WRIST, POSE_RIGHT_WRIST, type PosePoint } from '../pose/types.ts';
import type { FaceBox, FaceLandmarkPoint, FaceQuality } from './types.ts';

/** 框贴边或关键点出画，视为脸不全。不加新模型。 */
export const FACE_EDGE = 0.025;
const PROFILE_YAW = 0.60;
const TINY_AREA = 0.012;
const HAND_PAD = 0.14;
const EDGE_POINTS = [10, 152, 234, 454, 132, 361, 58, 288, 127, 356, 172, 397] as const;

export const emptyFaceQuality = (): FaceQuality => ({
    present: false,
    clipped: false,
    clipTop: false,
    clipBottom: false,
    clipLeft: false,
    clipRight: false,
    outFrac: 0,
    profile: false,
    leftEyeOk: false,
    rightEyeOk: false,
    bothEyesOk: false,
    handOverFace: false,
    pitchTrusted: false,
    yawTrusted: false,
    irisTrusted: false,
    l2csTrusted: false,
    reasons: ['无人脸'],
    label: '无人脸',
});

const inFrame = (x: number, y: number, edge = FACE_EDGE) => (
    x >= edge && x <= 1 - edge && y >= edge && y <= 1 - edge
);

const pointInBox = (x: number, y: number, box: FaceBox, pad: number) => {
    const dx = box.width * pad;
    const dy = box.height * pad;
    return x >= box.x - dx && x <= box.x + box.width + dx
        && y >= box.y - dy && y <= box.y + box.height + dy;
};

export const l2csBoxTrusted = (box: FaceBox | null | undefined) => {
    if (!box) return false;
    if (box.width < 0.08 || box.height < 0.10) return false;
    if (box.width * box.height < TINY_AREA) return false;
    return inFrame(box.x, box.y) && inFrame(box.x + box.width, box.y + box.height);
};

export const wristOverFace = (
    box: FaceBox | null | undefined,
    poseLandmarks: PosePoint[] | null | undefined,
) => {
    if (!box || !poseLandmarks || poseLandmarks.length < 17) return false;
    const indices = [POSE_LEFT_WRIST, POSE_RIGHT_WRIST, ...POSE_FINGER_INDICES];
    for (const index of indices) {
        const point = poseLandmarks[index];
        if (!isVisible(point)) continue;
        if (pointInBox(point.x, point.y, box, HAND_PAD)) return true;
    }
    return false;
};

export const faceQualityFrom = (input: {
    landmarks?: FaceLandmarkPoint[] | null;
    box?: FaceBox | null;
    headYaw?: number | null;
    iris?: Pick<IrisGaze, 'left' | 'right'> | null;
    poseLandmarks?: PosePoint[] | null;
    hands?: DetectedHand[] | null;
}): FaceQuality => {
    const lm = input.landmarks;
    const box = input.box;
    if (!lm?.length || !box) return emptyFaceQuality();

    const clipLeft = box.x < FACE_EDGE;
    const clipTop = box.y < FACE_EDGE;
    const clipRight = box.x + box.width > 1 - FACE_EDGE;
    const clipBottom = box.y + box.height > 1 - FACE_EDGE;
    let out = 0;
    let edgeN = 0;
    for (const index of EDGE_POINTS) {
        const point = lm[index];
        if (!point) continue;
        edgeN += 1;
        if (!inFrame(point.x, point.y)) out += 1;
    }
    const outFrac = edgeN ? out / edgeN : 0;
    const clipped = clipLeft || clipTop || clipRight || clipBottom || outFrac >= 0.25;

    const chin = lm[152];
    const forehead = lm[10];
    const chinIn = !!chin && inFrame(chin.x, chin.y, 0.01);
    const foreheadIn = !!forehead && inFrame(forehead.x, forehead.y, 0.01);

    const rightEyeOk = !!input.iris?.right;
    const leftEyeOk = !!input.iris?.left;
    const bothEyesOk = leftEyeOk && rightEyeOk;
    const profile = (input.headYaw != null && Math.abs(input.headYaw) > PROFILE_YAW)
        || (leftEyeOk !== rightEyeOk);
    const handOverFace = wristOverFace(box, input.poseLandmarks) || palmOverFace(box, input.hands);
    const tiny = box.width * box.height < TINY_AREA;
    const pitchTrusted = !clipped && !clipTop && !clipBottom && chinIn && foreheadIn && !handOverFace && !tiny;
    const yawTrusted = !clipLeft && !clipRight && !handOverFace && !tiny && outFrac < 0.35;
    const irisTrusted = (leftEyeOk || rightEyeOk) && !handOverFace && !clipTop && !tiny;
    const l2csTrusted = l2csBoxTrusted(box) && !handOverFace;

    const reasons: string[] = [];
    if (handOverFace) reasons.push('手挡脸');
    if (clipBottom) reasons.push('出框下');
    else if (clipTop) reasons.push('出框上');
    if (clipLeft) reasons.push('出框左');
    if (clipRight) reasons.push('出框右');
    if (clipped && !clipTop && !clipBottom && !clipLeft && !clipRight) reasons.push('边缘点出画');
    if (leftEyeOk !== rightEyeOk) reasons.push(leftEyeOk ? '右眼不可信' : '左眼不可信');
    else if (!leftEyeOk && !rightEyeOk) reasons.push('虹膜不可信');
    if (profile && bothEyesOk) reasons.push('侧脸');
    if (tiny) reasons.push('脸太小');
    if (!reasons.length) reasons.push('完整');

    const label = reasons[0] === '完整' ? '完整' : reasons.join(' · ');
    return {
        present: true,
        clipped,
        clipTop,
        clipBottom,
        clipLeft,
        clipRight,
        outFrac,
        profile,
        leftEyeOk,
        rightEyeOk,
        bothEyesOk,
        handOverFace,
        pitchTrusted,
        yawTrusted,
        irisTrusted,
        l2csTrusted,
        reasons,
        label,
    };
};
