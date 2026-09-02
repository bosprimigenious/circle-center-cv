import type { GazeDirection } from '../cheat/types';

export type LookKind =
    | 'camera'
    | 'glance'
    | 'aside'
    | 'second_screen'
    | 'head_turn_camera'
    | 'notes';

export type LookLevel = 'ok' | 'warn' | 'danger';

export type LookLive = {
    kind: LookKind;
    label: string;
    direction: GazeDirection | null;
    asideSec: number;
    headTurnSec: number;
    secondScreen: boolean;
    headTurnButCamera: boolean;
    notes: boolean;
    level: LookLevel;
    reasons: string[];
};

export type LookFrameInput = {
    tSec: number;
    gazeAway: boolean;
    gazeDirection: GazeDirection | null;
    headTurn: boolean;
    headDown: boolean;
    fusedPitch: number | null;
    gazeBlurry: boolean;
};
