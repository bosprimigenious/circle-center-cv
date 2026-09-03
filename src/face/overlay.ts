import { FaceLandmarker, HandLandmarker } from '@mediapipe/tasks-vision';
import type { GazeOverlay, GazeRay, NormalizedBox } from '../gaze/types';
import type { DetectedHands } from '../hand/types';
import { isVisible } from '../pose/shoulders';
import { UPPER_BODY_CONNECTIONS, type DetectedPose } from '../pose/types';
import { getObjectFitMapping, mapFramePointToOverlay, type OverlayFitMapping } from './overlayFit';
import type { FaceFrameResult, FaceLandmarkPoint } from './types';

type Connection = { start: number; end: number };

const MAX_OVERLAY_DPR = 1.25;
const MESH_DOT = 2;
const IRIS_DOT = 3;
const MESH_POINT_COUNT = 468;
const TOTAL_POINT_COUNT = 478;

const drawConnections = (
    ctx: CanvasRenderingContext2D,
    points: FaceLandmarkPoint[],
    connections: Connection[] | undefined,
    color: string,
    lineWidth: number,
) => {
    if (!connections?.length) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    for (let index = 0; index < connections.length; index += 1) {
        const from = points[connections[index].start];
        const to = points[connections[index].end];
        if (!from || !to) continue;
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
    }
    ctx.stroke();
};

const mapBox = (
    box: NormalizedBox,
    frameWidth: number,
    frameHeight: number,
    mapping: OverlayFitMapping,
) => {
    const topLeft = mapFramePointToOverlay(box.x * frameWidth, box.y * frameHeight, mapping);
    const bottomRight = mapFramePointToOverlay(
        (box.x + box.width) * frameWidth,
        (box.y + box.height) * frameHeight,
        mapping,
    );
    return {
        x: topLeft.x,
        y: topLeft.y,
        width: bottomRight.x - topLeft.x,
        height: bottomRight.y - topLeft.y,
    };
};

const drawOrbitBox = (ctx: CanvasRenderingContext2D, box: ReturnType<typeof mapBox>, color: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.3;
    ctx.strokeRect(box.x, box.y, box.width, box.height);
};

const drawIrisEllipse = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    color: string,
) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.ellipse(x, y, Math.max(2, radiusX), Math.max(2, radiusY), 0, 0, Math.PI * 2);
    ctx.stroke();
};

const drawArrow = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    dx: number,
    dy: number,
    color: string,
    lineWidth: number,
) => {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + dx, y + dy);
    ctx.stroke();
    const angle = Math.atan2(dy, dx);
    ctx.beginPath();
    ctx.moveTo(x + dx, y + dy);
    ctx.lineTo(x + dx - 8 * Math.cos(angle - 0.4), y + dy - 8 * Math.sin(angle - 0.4));
    ctx.lineTo(x + dx - 8 * Math.cos(angle + 0.4), y + dy - 8 * Math.sin(angle + 0.4));
    ctx.closePath();
    ctx.fill();
};

const drawMappedRay = (
    ctx: CanvasRenderingContext2D,
    ray: GazeRay,
    frameWidth: number,
    frameHeight: number,
    mapping: OverlayFitMapping,
    color: string,
    width: number,
) => {
    const from = mapFramePointToOverlay(ray.x * frameWidth, ray.y * frameHeight, mapping);
    const to = mapFramePointToOverlay((ray.x + ray.dx) * frameWidth, (ray.y + ray.dy) * frameHeight, mapping);
    drawArrow(ctx, from.x, from.y, to.x - from.x, to.y - from.y, color, width);
};

const drawPoseOverlay = (
    ctx: CanvasRenderingContext2D,
    pose: DetectedPose,
    frameWidth: number,
    frameHeight: number,
    mapping: OverlayFitMapping,
) => {
    const mapPt = (x: number, y: number) => mapFramePointToOverlay(x * frameWidth, y * frameHeight, mapping);
    const points = pose.landmarks;
    ctx.strokeStyle = 'rgba(250, 204, 21, 0.85)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (const [start, end] of UPPER_BODY_CONNECTIONS) {
        const from = points[start];
        const to = points[end];
        if (!isVisible(from) || !isVisible(to)) continue;
        const a = mapPt(from.x, from.y);
        const b = mapPt(to.x, to.y);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
    ctx.fillStyle = 'rgba(250, 204, 21, 0.9)';
    const drawn = new Set<number>();
    for (const [start, end] of UPPER_BODY_CONNECTIONS) {
        for (const index of [start, end]) {
            if (drawn.has(index)) continue;
            drawn.add(index);
            const point = points[index];
            if (!isVisible(point)) continue;
            const mapped = mapPt(point.x, point.y);
            ctx.fillRect(mapped.x - 2, mapped.y - 2, 4, 4);
        }
    }
    const shoulders = pose.shoulders;
    if (shoulders) {
        const left = mapPt(shoulders.left.x, shoulders.left.y);
        const right = mapPt(shoulders.right.x, shoulders.right.y);
        const mid = mapPt(shoulders.mid.x, shoulders.mid.y);
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(left.x, left.y);
        ctx.lineTo(right.x, right.y);
        ctx.stroke();
        ctx.fillStyle = '#facc15';
        ctx.fillRect(left.x - 3, left.y - 3, 6, 6);
        ctx.fillRect(right.x - 3, right.y - 3, 6, 6);
        ctx.fillStyle = '#fde68a';
        ctx.fillRect(mid.x - 2, mid.y - 2, 4, 4);
    }
};

const drawHandOverlay = (
    ctx: CanvasRenderingContext2D,
    hands: DetectedHands,
    frameWidth: number,
    frameHeight: number,
    mapping: OverlayFitMapping,
) => {
    const mapPt = (x: number, y: number) => mapFramePointToOverlay(x * frameWidth, y * frameHeight, mapping);
    const connections = HandLandmarker.HAND_CONNECTIONS ?? [];
    for (const hand of hands.hands) {
        const isLeft = hand.handedness.toLowerCase() === 'left';
        ctx.strokeStyle = isLeft ? 'rgba(251, 146, 60, 0.9)' : 'rgba(167, 139, 250, 0.9)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (const link of connections) {
            const from = hand.landmarks[link.start];
            const to = hand.landmarks[link.end];
            if (!from || !to) continue;
            const a = mapPt(from.x, from.y);
            const b = mapPt(to.x, to.y);
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
        }
        ctx.stroke();
        ctx.fillStyle = isLeft ? '#fb923c' : '#a78bfa';
        for (const point of hand.landmarks) {
            const mapped = mapPt(point.x, point.y);
            ctx.fillRect(mapped.x - 1.5, mapped.y - 1.5, 3, 3);
        }
        const palm = mapPt(hand.palm.x, hand.palm.y);
        ctx.fillStyle = '#fff7ed';
        ctx.fillRect(palm.x - 2.5, palm.y - 2.5, 5, 5);
    }
};

const drawGazeOverlay = (
    ctx: CanvasRenderingContext2D,
    gaze: GazeOverlay,
    frameWidth: number,
    frameHeight: number,
    mapping: OverlayFitMapping,
) => {
    const mapPt = (x: number, y: number) => mapFramePointToOverlay(x * frameWidth, y * frameHeight, mapping);
    const orbitColor = gaze.unreliable ? '#fb7185' : gaze.blurry ? '#fbbf24' : '#4ade80';
    const irisColor = gaze.unreliable ? '#fb7185' : gaze.blurry ? '#f59e0b' : '#38bdf8';
    if (gaze.leftOrbit) drawOrbitBox(ctx, mapBox(gaze.leftOrbit, frameWidth, frameHeight, mapping), orbitColor);
    if (gaze.rightOrbit) drawOrbitBox(ctx, mapBox(gaze.rightOrbit, frameWidth, frameHeight, mapping), orbitColor);
    const scaleX = mapping.scaleX * frameWidth;
    const scaleY = mapping.scaleY * frameHeight;
    if (gaze.leftIris) {
        const pt = mapPt(gaze.leftIris.x, gaze.leftIris.y);
        drawIrisEllipse(ctx, pt.x, pt.y, gaze.leftIris.radius * scaleX, gaze.leftIris.radius * scaleY, irisColor);
    }
    if (gaze.rightIris) {
        const pt = mapPt(gaze.rightIris.x, gaze.rightIris.y);
        drawIrisEllipse(ctx, pt.x, pt.y, gaze.rightIris.radius * scaleX, gaze.rightIris.radius * scaleY, irisColor);
    }
    if (!gaze.blurry) {
        if (gaze.leftRay) drawMappedRay(ctx, gaze.leftRay, frameWidth, frameHeight, mapping, '#7dd3fc', 2);
        if (gaze.rightRay) drawMappedRay(ctx, gaze.rightRay, frameWidth, frameHeight, mapping, '#7dd3fc', 2);
        if (gaze.irisRay) drawMappedRay(ctx, gaze.irisRay, frameWidth, frameHeight, mapping, '#38bdf8', 2.4);
    }
    if (gaze.geometricRay) drawMappedRay(ctx, gaze.geometricRay, frameWidth, frameHeight, mapping, '#86efac', 2);
    if (gaze.l2csRay) drawMappedRay(ctx, gaze.l2csRay, frameWidth, frameHeight, mapping, '#fb923c', 2.2);
    if (gaze.fusedRay) drawMappedRay(ctx, gaze.fusedRay, frameWidth, frameHeight, mapping, '#f8fafc', 3);
};

const drawPointLattice = (ctx: CanvasRenderingContext2D, points: FaceLandmarkPoint[]) => {
    ctx.fillStyle = 'rgba(226, 232, 240, 0.95)';
    const meshCount = Math.min(MESH_POINT_COUNT, points.length);
    for (let index = 0; index < meshCount; index += 1) {
        const point = points[index];
        ctx.fillRect(point.x - 1, point.y - 1, MESH_DOT, MESH_DOT);
    }
    ctx.fillStyle = '#38bdf8';
    const irisEnd = Math.min(TOTAL_POINT_COUNT, points.length);
    for (let index = MESH_POINT_COUNT; index < irisEnd; index += 1) {
        const point = points[index];
        ctx.fillRect(point.x - 1.5, point.y - 1.5, IRIS_DOT, IRIS_DOT);
    }
};

export const drawFaceOverlay = (
    canvas: HTMLCanvasElement,
    result: FaceFrameResult | null,
    objectFit = 'cover',
) => {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_OVERLAY_DPR);
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;

    // Plain 2d context only. Extra attrs on a later getContext() return null on some Chrome.
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (!result || (result.faces.length === 0 && !result.pose?.landmarks.length && !result.hands?.hands.length)) {
        if (result?.error) {
            ctx.fillStyle = 'rgba(254, 202, 202, 0.92)';
            ctx.font = '600 13px system-ui, sans-serif';
            ctx.fillText(result.error, 14, height - 18);
        }
        return;
    }

    const mapping = getObjectFitMapping(width, height, result.frameWidth, result.frameHeight, objectFit);
    if (result.faces.length === 0) {
        if (result.pose) drawPoseOverlay(ctx, result.pose, result.frameWidth, result.frameHeight, mapping);
        if (result.hands) drawHandOverlay(ctx, result.hands, result.frameWidth, result.frameHeight, mapping);
    }

    result.faces.forEach((face, faceIndex) => {
        const points = face.landmarks.map((point) => {
            const mapped = mapFramePointToOverlay(
                point.x * result.frameWidth,
                point.y * result.frameHeight,
                mapping,
            );
            return { x: mapped.x, y: mapped.y, z: point.z };
        });

        drawConnections(ctx, points, FaceLandmarker.FACE_LANDMARKS_FACE_OVAL, '#7dd3fc', 1.5);
        drawConnections(ctx, points, FaceLandmarker.FACE_LANDMARKS_LIPS, '#fda4af', 1.6);
        drawConnections(ctx, points, FaceLandmarker.FACE_LANDMARKS_LEFT_EYE, '#86efac', 1.4);
        drawConnections(ctx, points, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE, '#86efac', 1.4);
        drawConnections(ctx, points, FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW, '#fde68a', 1.4);
        drawConnections(ctx, points, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW, '#fde68a', 1.4);
        drawConnections(ctx, points, FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS, '#38bdf8', 1.8);
        drawConnections(ctx, points, FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS, '#38bdf8', 1.8);
        drawPointLattice(ctx, points);
        if (faceIndex === 0 && result.pose) {
            drawPoseOverlay(ctx, result.pose, result.frameWidth, result.frameHeight, mapping);
        }
        if (faceIndex === 0 && result.hands) {
            drawHandOverlay(ctx, result.hands, result.frameWidth, result.frameHeight, mapping);
        }
        if (result.gaze && faceIndex === 0) {
            drawGazeOverlay(ctx, result.gaze, result.frameWidth, result.frameHeight, mapping);
        }

        const box = face.box;
        const topLeft = mapFramePointToOverlay(box.x * result.frameWidth, box.y * result.frameHeight, mapping);
        const bottomRight = mapFramePointToOverlay(
            (box.x + box.width) * result.frameWidth,
            (box.y + box.height) * result.frameHeight,
            mapping,
        );
        const quality = faceIndex === 0 ? result.quality : null;
        const boxBad = !!quality && (quality.clipped || quality.handOverFace);
        ctx.strokeStyle = boxBad ? 'rgba(251, 113, 133, 0.95)' : 'rgba(186, 230, 253, 0.85)';
        ctx.lineWidth = boxBad ? 2 : 1.2;
        ctx.strokeRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
        const caption = quality && quality.label !== '完整'
            ? `脸 ${faceIndex + 1} · ${quality.label}`
            : `脸 ${faceIndex + 1} · ${face.landmarks.length} 点`;
        const captionWidth = Math.min(280, Math.max(128, caption.length * 9 + 16));
        ctx.fillStyle = boxBad ? 'rgba(127, 29, 29, 0.82)' : 'rgba(8, 47, 73, 0.78)';
        ctx.fillRect(topLeft.x, Math.max(8, topLeft.y - 20), captionWidth, 18);
        ctx.fillStyle = boxBad ? '#fecaca' : '#e0f2fe';
        ctx.font = '700 11px system-ui, sans-serif';
        ctx.fillText(caption, topLeft.x + 6, Math.max(20, topLeft.y - 7));
    });

    const look = result.look;
    if (look && look.level !== 'ok') {
        const banner = look.reasons.length
            ? `${look.label} · ${look.reasons.join(' / ')}`
            : look.label;
        ctx.fillStyle = look.level === 'danger' ? 'rgba(56, 189, 248, 0.92)' : 'rgba(125, 211, 252, 0.92)';
        const boxWidth = Math.min(420, width - 24);
        ctx.fillRect((width - boxWidth) / 2, 12, boxWidth, 28);
        ctx.fillStyle = '#0f172a';
        ctx.font = '700 13px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(banner, width / 2, 31);
        ctx.textAlign = 'start';
    }

    const speech = result.speech;
    if (speech?.speaking) {
        const speechY = look && look.level !== 'ok' ? 48 : 12;
        ctx.fillStyle = 'rgba(52, 211, 153, 0.92)';
        ctx.fillRect(12, speechY, 176, 28);
        ctx.fillStyle = '#064e3b';
        ctx.font = '700 13px system-ui, sans-serif';
        ctx.fillText(speech.label, 22, speechY + 19);
    }

    const avsync = result.avsync;
    if (avsync && (avsync.kind === 'lag' || avsync.kind === 'visual_only' || avsync.kind === 'audio_only')) {
        ctx.fillStyle = avsync.level === 'danger' ? 'rgba(251, 146, 60, 0.92)' : 'rgba(253, 224, 71, 0.92)';
        ctx.fillRect(12, height - 80, Math.min(260, width - 24), 28);
        ctx.fillStyle = '#1c1917';
        ctx.font = '700 13px system-ui, sans-serif';
        ctx.fillText(avsync.label, 22, height - 61);
    }

    const fatigue = result.fatigue;
    if (fatigue && fatigue.level !== 'ok') {
        const banner = fatigue.reasons.length
            ? `${fatigue.label} · ${fatigue.reasons.join(' / ')}`
            : fatigue.label;
        ctx.fillStyle = fatigue.level === 'danger' ? 'rgba(239, 68, 68, 0.9)' : 'rgba(245, 158, 11, 0.9)';
        const boxWidth = Math.min(420, width - 24);
        ctx.fillRect((width - boxWidth) / 2, height - 44, boxWidth, 28);
        ctx.fillStyle = '#fff';
        ctx.font = '700 13px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(banner, width / 2, height - 25);
        ctx.textAlign = 'start';
    }
};
