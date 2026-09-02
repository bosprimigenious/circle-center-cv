import type { DemoPreset, DemoCenterOffset } from '../types';

export const buildSyntheticInterferogram = (preset: DemoPreset['id']) => {
    const canvas = document.createElement('canvas');
    const width = 1280;
    const height = 960;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    ctx.fillStyle = '#02050a';
    ctx.fillRect(0, 0, width, height);

    const background = ctx.createRadialGradient(width * 0.5, height * 0.48, 80, width * 0.5, height * 0.48, 650);
    background.addColorStop(0, 'rgba(18, 24, 38, 0.82)');
    background.addColorStop(1, 'rgba(0, 0, 0, 0.96)');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    const centerX = width * 0.5;
    const centerY = height * 0.5;
    if (preset === 'straight') {
        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.rotate(-Math.PI / 20);
        for (let index = -7; index <= 7; index += 1) {
            const x = index * 78;
            const distance = Math.abs(index);
            const alpha = 0.26 + (1 - Math.min(1, distance / 8)) * 0.6;
            const curve = Math.sign(index || 1) * Math.max(0, distance - 1) * Math.max(0, distance - 1) * 13;
            ctx.lineWidth = distance <= 1 ? 8 : index % 2 === 0 ? 7 : 5.5;
            ctx.strokeStyle = `rgba(255, 46, 34, ${alpha})`;
            ctx.shadowColor = 'rgba(255, 42, 32, 0.38)';
            ctx.shadowBlur = 11;
            ctx.beginPath();
            if (distance <= 1) {
                ctx.moveTo(x, -height * 0.72);
                ctx.lineTo(x, height * 0.72);
            } else {
                ctx.moveTo(x - curve * 0.52, -height * 0.72);
                ctx.bezierCurveTo(
                    x + curve * 0.9,
                    -height * 0.2,
                    x + curve * 0.9,
                    height * 0.2,
                    x - curve * 0.52,
                    height * 0.72,
                );
            }
            ctx.stroke();
        }
        ctx.restore();

        return canvas.toDataURL('image/png');
    }

    const scaleX = preset === 'ellipse' ? 1.38 : 1;
    const scaleY = preset === 'ellipse' ? 0.58 : 1;
    const ringCount = preset === 'ellipse' ? 8 : 10;

    ctx.save();
    ctx.translate(centerX, centerY);
    if (preset === 'ellipse') ctx.rotate(-Math.PI / 9);
    ctx.scale(scaleX, scaleY);
    for (let index = 0; index < ringCount; index += 1) {
        const radius = 48 + index * 42;
        const alpha = Math.max(0.22, 0.92 - index * 0.06);
        ctx.lineWidth = index % 2 === 0 ? 5 : 4;
        ctx.strokeStyle = `rgba(255, ${preset === 'ellipse' ? 58 : 38}, ${preset === 'ellipse' ? 34 : 28}, ${alpha})`;
        ctx.shadowColor = 'rgba(255, 42, 32, 0.45)';
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.stroke();
    }
    ctx.restore();

    ctx.globalAlpha = 0.2;
    for (let index = 0; index < 180; index += 1) {
        const x = Math.random() * width;
        const y = Math.random() * height;
        const value = 24 + Math.random() * 35;
        ctx.fillStyle = `rgb(${value}, ${value * 0.5}, ${value * 0.45})`;
        ctx.fillRect(x, y, 1.2, 1.2);
    }
    ctx.globalAlpha = 1;

    return canvas.toDataURL('image/png');
};

export const createShiftedDemoImage = (sourceUrl: string, centerOffset: DemoCenterOffset) => new Promise<string>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
        const width = image.naturalWidth || image.width;
        const height = image.naturalHeight || image.height;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            reject(new Error('Canvas context is unavailable'));
            return;
        }

        ctx.fillStyle = '#02050a';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(
            image,
            width * centerOffset.x / 100,
            height * centerOffset.y / 100,
            width,
            height,
        );
        resolve(canvas.toDataURL('image/png'));
    };
    image.onerror = () => reject(new Error('Demo image failed to load'));
    image.src = sourceUrl;
});
