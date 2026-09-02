import { getExposureFilter } from './exposure';

export const getSourceSize = (source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement) => {
    if (source instanceof HTMLVideoElement) {
        return { width: source.videoWidth, height: source.videoHeight };
    }
    if (source instanceof HTMLImageElement) {
        return { width: source.naturalWidth, height: source.naturalHeight };
    }
    return { width: source.width, height: source.height };
};

export const drawSourceFrameToCanvas = (
    source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
    canvas: HTMLCanvasElement,
    ev = 0,
) => {
    const { width, height } = getSourceSize(source);
    if (!width || !height) return null;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.filter = getExposureFilter(ev);
    ctx.drawImage(source, 0, 0, width, height);
    ctx.filter = 'none';
    return canvas;
};

export const drawSourceToCanvas = (
    source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
    canvas: HTMLCanvasElement,
    quality = 0.86,
    ev = 0,
) => {
    if (!drawSourceFrameToCanvas(source, canvas, ev)) return null;
    return canvas.toDataURL('image/jpeg', quality);
};
