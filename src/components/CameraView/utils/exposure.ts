import type { ExposureControl, ExtendedSettings, ExposureProperty } from '../types';
import { EV_MIN, EV_MAX } from '../constants';
import { clamp } from './math';

export const getExposureBrightness = (ev: number) => clamp(Math.pow(2, clamp(ev, EV_MIN, EV_MAX)), 0.35, 2.6);

export const getExposureFilter = (ev: number) => {
    const boundedEv = clamp(ev, EV_MIN, EV_MAX);
    const brightness = getExposureBrightness(boundedEv);
    const contrast = clamp(1 + Math.abs(boundedEv) * 0.045, 1, 1.12);
    const saturation = clamp(1 + boundedEv * 0.035, 0.92, 1.1);
    return `brightness(${brightness}) contrast(${contrast}) saturate(${saturation})`;
};

export const evToValue = (ev: number, control: ExposureControl | null) => {
    if (!control) return 0;
    const boundedEv = clamp(ev, EV_MIN, EV_MAX);
    if (control.property === 'exposureCompensation') {
        const raw = clamp(boundedEv, control.min, control.max);
        return Math.round(raw / control.step) * control.step;
    }
    const ratio = (boundedEv - EV_MIN) / (EV_MAX - EV_MIN);
    const raw = control.min + ratio * (control.max - control.min);
    return Math.round(raw / control.step) * control.step;
};

export const formatEv = (ev: number) => `${ev >= 0 ? '+' : ''}${ev.toFixed(1)} EV`;

export const getInitialExposure = (control: ExposureControl, settings: ExtendedSettings) => {
    const currentValue = settings[control.property as ExposureProperty];
    if (typeof currentValue === 'number') {
        return clamp(currentValue, control.min, control.max);
    }
    return evToValue(0, control);
};
