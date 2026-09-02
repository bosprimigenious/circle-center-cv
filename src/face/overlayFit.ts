export type OverlayFitMapping = {
    scaleX: number;
    scaleY: number;
    offsetX: number;
    offsetY: number;
};

export const getObjectFitMapping = (
    containerWidth: number,
    containerHeight: number,
    contentWidth: number,
    contentHeight: number,
    objectFit = 'cover',
): OverlayFitMapping => {
    const boxW = Math.max(1, containerWidth);
    const boxH = Math.max(1, containerHeight);
    const contentW = Math.max(1, contentWidth);
    const contentH = Math.max(1, contentHeight);
    const fit = (objectFit || 'cover').trim().toLowerCase();

    if (fit === 'fill') {
        return {
            scaleX: boxW / contentW,
            scaleY: boxH / contentH,
            offsetX: 0,
            offsetY: 0,
        };
    }

    let scale: number;
    if (fit === 'none') {
        scale = 1;
    } else if (fit === 'contain') {
        scale = Math.min(boxW / contentW, boxH / contentH);
    } else if (fit === 'scale-down') {
        scale = Math.min(1, boxW / contentW, boxH / contentH);
    } else {
        scale = Math.max(boxW / contentW, boxH / contentH);
    }

    return {
        scaleX: scale,
        scaleY: scale,
        offsetX: (boxW - contentW * scale) / 2,
        offsetY: (boxH - contentH * scale) / 2,
    };
};

export const mapFramePointToOverlay = (
    x: number,
    y: number,
    mapping: OverlayFitMapping,
) => ({
    x: mapping.offsetX + x * mapping.scaleX,
    y: mapping.offsetY + y * mapping.scaleY,
});
