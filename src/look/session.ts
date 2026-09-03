import type { GazeDirection } from '../cheat/types.ts';
import { CAMERA_TO_SCREEN_PITCH } from '../gaze/screen.ts';
import type { LookFrameInput, LookKind, LookLevel, LookLive } from './types.ts';

/**
 * 转头 / 第二屏：不加新模型。
 * 第二屏摄像头看不见，只能从「世界视线长时间停在同一侧」推断。
 * 转头但仍看屏 = 头转了、融合视线仍朝屏中（补偿性眼动 / VOR）。
 * 低头看稿不叫第二屏。扫视不够驻留也不叫。
 * 看屏 ≠ 看摄像头光轴：笔记本摄像头在屏幕上方。
 */
export const LOOK_THRESHOLDS = {
    DWELL_SEC: 2.0,
    GLANCE_SEC: 0.8,
    GAP_SEC: 0.5,
    PITCH_NOTES_RAD: 0.18,
};

type Run = {
    dir: GazeDirection;
    start: number;
    last: number;
};

type Hold = {
    start: number;
    last: number;
};

const emptyLive = (): LookLive => ({
    kind: 'camera',
    label: '看屏',
    direction: null,
    asideSec: 0,
    headTurnSec: 0,
    secondScreen: false,
    headTurnButCamera: false,
    notes: false,
    level: 'ok',
    reasons: [],
});

const sideLabel = (direction: GazeDirection | null) => (
    direction === 'left' ? '左' : direction === 'right' ? '右' : ''
);

export const lookingDownFrom = (input: Pick<LookFrameInput, 'headDown' | 'fusedPitch' | 'screenPitch'>) => {
    if (input.headDown) return true;
    if (input.fusedPitch == null) return false;
    const origin = input.screenPitch ?? CAMERA_TO_SCREEN_PITCH;
    return input.fusedPitch - origin < -LOOK_THRESHOLDS.PITCH_NOTES_RAD;
};

export class LookSession {
    private aside: Run | null = null;
    private head: Hold | null = null;
    private lastT = 0;
    private last: LookLive = emptyLive();

    reset() {
        this.aside = null;
        this.head = null;
        this.lastT = 0;
        this.last = emptyLive();
    }

    snapshot() {
        return this.last;
    }

    ingest(input: LookFrameInput): LookLive {
        if (this.lastT && input.tSec + 0.4 < this.lastT) this.reset();
        this.lastT = input.tSec;

        const notes = lookingDownFrom(input);
        this.trackAside(input, notes);
        this.trackHead(input, notes);

        const asideEnd = input.gazeUnreliable && this.aside ? this.aside.last : input.tSec;
        const asideSec = this.aside ? Math.max(0, asideEnd - this.aside.start) : 0;
        const headTurnSec = this.head ? Math.max(0, input.tSec - this.head.start) : 0;
        const direction = this.aside?.dir ?? (input.gazeAway ? input.gazeDirection : null);
        const secondScreen = !notes && this.aside != null && asideSec >= LOOK_THRESHOLDS.DWELL_SEC;
        const headTurnButCamera = input.headTurn && !input.gazeAway && !notes;

        let kind: LookKind = 'camera';
        if (notes) kind = 'notes';
        else if (secondScreen) kind = 'second_screen';
        else if (this.aside && asideSec >= LOOK_THRESHOLDS.GLANCE_SEC) kind = 'aside';
        else if (this.aside) kind = 'glance';
        else if (headTurnButCamera) kind = 'head_turn_camera';

        const reasons: string[] = [];
        const side = sideLabel(direction);
        if (notes) reasons.push('低头');
        if (secondScreen) reasons.push(side ? `侧向驻留${side} ${asideSec.toFixed(1)}s` : `侧向驻留 ${asideSec.toFixed(1)}s`);
        else if (kind === 'aside') reasons.push(side ? `侧视${side}` : '侧视');
        else if (kind === 'glance') reasons.push(side ? `扫视${side}` : '扫视');
        if (headTurnButCamera) reasons.push('转头但仍看屏');
        else if (input.headTurn && !notes) reasons.push('转头');

        let level: LookLevel = 'ok';
        if (secondScreen) level = 'danger';
        else if (kind === 'aside' || kind === 'notes' || (input.headTurn && input.gazeAway)) level = 'warn';

        const label = (
            kind === 'notes' ? '低头看稿/手机'
            : kind === 'second_screen' ? `疑似看第二屏${side ? `（${side}）` : ''}`
            : kind === 'aside' ? `侧视${side}`
            : kind === 'glance' ? `扫视${side}`
            : kind === 'head_turn_camera' ? '转头但仍看屏'
            : '看屏'
        );

        this.last = {
            kind,
            label,
            direction,
            asideSec,
            headTurnSec,
            secondScreen,
            headTurnButCamera,
            notes,
            level,
            reasons,
        };
        return this.last;
    }

    private trackAside(input: LookFrameInput, notes: boolean) {
        const t = input.tSec;
        if (input.gazeUnreliable) {
            if (this.aside && t - this.aside.last > LOOK_THRESHOLDS.GAP_SEC) this.aside = null;
            return;
        }
        const dir = input.gazeDirection;
        const active = !notes && input.gazeAway && (dir === 'left' || dir === 'right');
        if (active && dir) {
            if (this.aside && this.aside.dir === dir) {
                this.aside.last = t;
            } else {
                this.aside = { dir, start: t, last: t };
            }
            return;
        }
        if (notes) {
            this.aside = null;
            return;
        }
        if (this.aside && t - this.aside.last <= LOOK_THRESHOLDS.GAP_SEC && (input.gazeBlurry || !input.gazeAway)) {
            return;
        }
        this.aside = null;
    }

    private trackHead(input: LookFrameInput, notes: boolean) {
        const t = input.tSec;
        if (input.headTurn && !notes) {
            if (this.head) this.head.last = t;
            else this.head = { start: t, last: t };
            return;
        }
        if (this.head && t - this.head.last <= LOOK_THRESHOLDS.GAP_SEC) return;
        this.head = null;
    }
}
