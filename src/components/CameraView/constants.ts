import type { DemoPreset, DemoCenterOffset } from './types';

export const EV_MIN = -2;
export const EV_MAX = 2;
export const EV_STEP = 0.1;
export const FIRST_BRIGHT_RING_TARGET_BRIGHTNESS = 0.64;
export const FIRST_BRIGHT_RING_TARGET_DEADBAND = 0.055;
export const PEAK_BRIGHTNESS_FALLBACK_TARGET = 0.78;
export const PEAK_BRIGHTNESS_FALLBACK_DEADBAND = 0.08;
export const AUTO_ANALYZE_INTERVAL_MS = 2000;

export const demoPresets: DemoPreset[] = [
    { id: 'centered', label: '居中圆环', description: '圆心接近画面中心，适合演示确认圆心' },
    { id: 'offset', label: '偏心圆环', description: '圆心偏右下，适合演示调节建议' },
    { id: 'ellipse', label: '椭圆环纹', description: '环纹圆度较低，适合演示异常状态' },
    { id: 'straight', label: '直线条纹', description: '近似等倾角或大倾角状态，适合演示直线干涉条纹' },
];

export const demoPresetCenters: Record<DemoPreset['id'], DemoCenterOffset> = {
    centered: { x: 0, y: 0 },
    offset: { x: 22, y: 16 },
    ellipse: { x: 0, y: 0 },
    straight: { x: 0, y: 0 },
};
