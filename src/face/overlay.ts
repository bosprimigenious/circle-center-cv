import { FaceLandmarker } from '@mediapipe/tasks-vision';
import { getObjectFitMapping, mapFramePointToOverlay } from './overlayFit';
import type { FaceFrameResult, FaceLandmarkPoint } from './types';

type Connection = { start: number; end: number };

const IRIS_CENTERS = [468, 473] as const;
const MAX_OVERLAY_DPR = 1.25;

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

    const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (!result || result.faces.length === 0) {
        if (result?.error) {
            ctx.fillStyle = 'rgba(254, 202, 202, 0.92)';
            ctx.font = '600 13px system-ui, sans-serif';
            ctx.fillText(result.error, 14, height - 18);
        }
        return;
    }

    const mapping = getObjectFitMapping(width, height, result.frameWidth, result.frameHeight, objectFit);

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

        ctx.fillStyle = '#38bdf8';
        for (const index of IRIS_CENTERS) {
            const point = points[index];
            if (!point) continue;
            ctx.beginPath();
            ctx.arc(point.x, point.y, 2.2, 0, Math.PI * 2);
            ctx.fill();
        }

        const box = face.box;
        const topLeft = mapFramePointToOverlay(box.x * result.frameWidth, box.y * result.frameHeight, mapping);
        const bottomRight = mapFramePointToOverlay(
            (box.x + box.width) * result.frameWidth,
            (box.y + box.height) * result.frameHeight,
            mapping,
        );
        ctx.strokeStyle = 'rgba(186, 230, 253, 0.85)';
        ctx.lineWidth = 1.2;
        ctx.strokeRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
        ctx.fillStyle = 'rgba(8, 47, 73, 0.78)';
        ctx.fillRect(topLeft.x, Math.max(8, topLeft.y - 20), 128, 18);
        ctx.fillStyle = '#e0f2fe';
        ctx.font = '700 11px system-ui, sans-serif';
        ctx.fillText(`脸 ${faceIndex + 1} · ${face.landmarks.length} 点`, topLeft.x + 6, Math.max(20, topLeft.y - 7));
    });
};
