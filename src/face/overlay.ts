import { FaceLandmarker } from '@mediapipe/tasks-vision';
import { getObjectFitMapping, mapFramePointToOverlay } from '../components/CameraView/analysis/overlayFit';
import type { FaceFrameResult, FaceLandmarkPoint } from './types';

type Connection = { start: number; end: number };

const drawConnections = (
    ctx: CanvasRenderingContext2D,
    points: FaceLandmarkPoint[],
    connections: Connection[] | undefined,
    color: string,
    lineWidth: number,
) => {
    if (!connections) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    connections.forEach((item) => {
        const from = points[item.start];
        const to = points[item.end];
        if (!from || !to) return;
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
    });
    ctx.stroke();
};

export const drawFaceOverlay = (
    canvas: HTMLCanvasElement,
    result: FaceFrameResult | null,
    objectFit = 'cover',
) => {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
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

        drawConnections(ctx, points, FaceLandmarker.FACE_LANDMARKS_TESSELATION, 'rgba(125, 211, 252, 0.22)', 0.6);
        drawConnections(ctx, points, FaceLandmarker.FACE_LANDMARKS_FACE_OVAL, '#7dd3fc', 1.5);
        drawConnections(ctx, points, FaceLandmarker.FACE_LANDMARKS_LIPS, '#fda4af', 1.6);
        drawConnections(ctx, points, FaceLandmarker.FACE_LANDMARKS_LEFT_EYE, '#86efac', 1.4);
        drawConnections(ctx, points, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE, '#86efac', 1.4);
        drawConnections(ctx, points, FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW, '#fde68a', 1.4);
        drawConnections(ctx, points, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW, '#fde68a', 1.4);
        drawConnections(ctx, points, FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS, '#38bdf8', 1.8);
        drawConnections(ctx, points, FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS, '#38bdf8', 1.8);

        ctx.fillStyle = 'rgba(248, 250, 252, 0.82)';
        points.forEach((point) => {
            ctx.beginPath();
            ctx.arc(point.x, point.y, 0.9, 0, Math.PI * 2);
            ctx.fill();
        });

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
