import { irisGazeFromLandmarks } from '../gaze/iris.ts';
import {
    brightnessAndGray,
    eyeAspectRatio,
    meanAbsDiff,
    median,
    mouthAspectRatio,
    poseFromLandmarks,
} from './geometry';
import { computeScore, extractVideoSignals, THRESHOLDS } from './scoring';
import type { CheatFrameInput, CheatLive, CheatSegment, CheatSnapshot, CheatVideoRes, GazeDirection } from './types';

type Sample = {
    time: number;
    pose: { pitch: number; yaw: number } | null;
    gaze_x: number | null;
    gaze_y: number | null;
    l2cs_yaw: number | null;
    l2cs_pitch: number | null;
    head_down: boolean;
    head_turn: boolean;
    gaze_away: boolean;
    gaze_direction: GazeDirection | null;
};

const mergeSegments = (samples: Sample[], key: 'head_down' | 'gaze_away', intervalSec: number, withDirection = false): CheatSegment[] => {
    const segs: CheatSegment[] = [];
    let current: CheatSegment | null = null;
    for (const sample of samples) {
        if (!sample[key]) {
            current = null;
            continue;
        }
        if (current && sample.time - current.end <= intervalSec * 1.5) {
            current.end = sample.time + intervalSec;
            if (withDirection && sample.gaze_direction) current.direction = sample.gaze_direction;
        } else {
            current = {
                start: sample.time,
                end: sample.time + intervalSec,
                direction: withDirection ? sample.gaze_direction ?? undefined : undefined,
            };
            segs.push(current);
        }
    }
    return segs;
};

export class CheatSession {
    private samples: Sample[] = [];
    private lastTSec = 0;
    private lastSampleAt = -Infinity;
    private darkCount = 0;
    private staticCount = 0;
    private readSuccess = 0;
    private prevGray: Float32Array | null = null;
    private lastSnapshot: CheatSnapshot | null = null;
    private gazeEngine = 'mediapipe-iris-orbit';

    reset() {
        this.samples = [];
        this.lastTSec = 0;
        this.lastSampleAt = -Infinity;
        this.darkCount = 0;
        this.staticCount = 0;
        this.readSuccess = 0;
        this.prevGray = null;
        this.lastSnapshot = null;
        this.gazeEngine = 'mediapipe-iris-orbit';
    }

    ingest(input: CheatFrameInput): CheatSnapshot {
        if (input.tSec + 0.4 < this.lastTSec) this.reset();
        this.lastTSec = input.tSec;

        const lm = input.landmarks;
        const pose = lm ? poseFromLandmarks(lm) : null;
        const iris = lm ? irisGazeFromLandmarks(lm) : { left: null, right: null, gazeX: null, gazeY: null };
        const gazeX = iris.gazeX;
        const gazeY = iris.gazeY;
        const l2cs = input.l2cs ?? null;
        const mar = lm ? mouthAspectRatio(lm) : null;
        const ear = lm ? eyeAspectRatio(lm) : null;
        const jawOpen = input.jawOpen ?? null;
        if (input.gazeEngine) this.gazeEngine = input.gazeEngine;

        const due = input.forceSample || input.tSec - this.lastSampleAt >= THRESHOLDS.VIDEO_INTERVAL_SEC;
        if (due) {
            this.lastSampleAt = input.tSec;
            if (input.imageData) {
                const { brightness, gray } = brightnessAndGray(input.imageData);
                this.readSuccess += 1;
                if (brightness < THRESHOLDS.DARK) this.darkCount += 1;
                if (this.prevGray && meanAbsDiff(gray, this.prevGray) < THRESHOLDS.STATIC_DIFF) {
                    this.staticCount += 1;
                }
                this.prevGray = gray;
            }
            this.samples.push({
                time: input.tSec,
                pose,
                gaze_x: gazeX,
                gaze_y: gazeY,
                l2cs_yaw: l2cs?.yaw ?? null,
                l2cs_pitch: l2cs?.pitch ?? null,
                head_down: false,
                head_turn: false,
                gaze_away: false,
                gaze_direction: null,
            });
            this.relabelSamples();
        }

        const video = this.buildVideoRes();
        const baseline = this.baseline();
        const live = this.liveFrom(pose, gazeX, gazeY, l2cs, iris, mar, ear, jawOpen, baseline);
        const videoSignals = extractVideoSignals(video);
        const scored = computeScore(videoSignals);
        const snapshot: CheatSnapshot = { live, video, videoSignals, scored };
        this.lastSnapshot = snapshot;
        return snapshot;
    }

    snapshot() {
        return this.lastSnapshot;
    }

    private baseline() {
        const withPose = this.samples.filter((sample) => sample.pose);
        let pool = withPose.filter(
            (sample) => sample.time <= THRESHOLDS.BASELINE_DURATION_SEC && Math.abs(sample.pose!.yaw) <= THRESHOLDS.YAW_TURN_DELTA,
        );
        if (pool.length < THRESHOLDS.BASELINE_MIN_SAMPLES) pool = withPose;
        return {
            pitch: median(pool.map((sample) => sample.pose?.pitch)),
            yaw: median(pool.map((sample) => sample.pose?.yaw)),
            gaze: median(pool.map((sample) => sample.gaze_x)),
            l2csYaw: median(pool.map((sample) => sample.l2cs_yaw)),
            poseOk: pool.length >= THRESHOLDS.BASELINE_MIN_SAMPLES && median(pool.map((sample) => sample.pose?.pitch)) != null,
        };
    }

    private gazeDecision(
        gazeX: number | null,
        l2csYaw: number | null,
        baseline: ReturnType<CheatSession['baseline']>,
    ): { away: boolean; direction: GazeDirection | null } {
        let away = false;
        let direction: GazeDirection | null = null;
        if (baseline.gaze != null && gazeX != null) {
            const delta = gazeX - baseline.gaze;
            if (delta < -THRESHOLDS.GAZE_AWAY_DELTA) {
                away = true;
                direction = 'left';
            } else if (delta > THRESHOLDS.GAZE_AWAY_DELTA) {
                away = true;
                direction = 'right';
            }
        }
        if (baseline.l2csYaw != null && l2csYaw != null) {
            const delta = l2csYaw - baseline.l2csYaw;
            if (Math.abs(delta) > THRESHOLDS.L2CS_YAW_AWAY_RAD) {
                away = true;
                direction = delta < 0 ? 'left' : 'right';
            }
        }
        return { away, direction };
    }

    private relabelSamples() {
        const baseline = this.baseline();
        let down = 0;
        let turn = 0;
        let away = 0;
        for (const sample of this.samples) {
            sample.head_down = false;
            sample.head_turn = false;
            sample.gaze_away = false;
            sample.gaze_direction = null;
            if (baseline.poseOk && sample.pose) {
                if (sample.pose.pitch - baseline.pitch! > THRESHOLDS.PITCH_DOWN_DELTA) {
                    sample.head_down = true;
                    down += 1;
                }
                if (Math.abs(sample.pose.yaw - baseline.yaw!) > THRESHOLDS.YAW_TURN_DELTA) {
                    sample.head_turn = true;
                    turn += 1;
                }
            }
            const gaze = this.gazeDecision(sample.gaze_x, sample.l2cs_yaw, baseline);
            if (gaze.away) {
                sample.gaze_away = true;
                sample.gaze_direction = gaze.direction;
                away += 1;
            }
        }
        return { down, turn, away };
    }

    private liveFrom(
        pose: { pitch: number; yaw: number } | null,
        gazeX: number | null,
        gazeY: number | null,
        l2cs: { yaw: number; pitch: number } | null,
        iris: ReturnType<typeof irisGazeFromLandmarks>,
        mar: number | null,
        ear: number | null,
        jawOpen: number | null,
        baseline: ReturnType<CheatSession['baseline']>,
    ): CheatLive {
        let headDown = false;
        let headTurn = false;
        if (baseline.poseOk && pose && baseline.pitch != null && baseline.yaw != null) {
            headDown = pose.pitch - baseline.pitch > THRESHOLDS.PITCH_DOWN_DELTA;
            headTurn = Math.abs(pose.yaw - baseline.yaw) > THRESHOLDS.YAW_TURN_DELTA;
        }
        const gaze = this.gazeDecision(gazeX, l2cs?.yaw ?? null, baseline);
        return {
            pitch: pose?.pitch ?? null,
            yaw: pose?.yaw ?? null,
            gazeX,
            gazeY,
            l2csYaw: l2cs?.yaw ?? null,
            l2csPitch: l2cs?.pitch ?? null,
            irisLeftR: iris.left?.radius ?? null,
            irisRightR: iris.right?.radius ?? null,
            mar,
            ear,
            jawOpen,
            headDown,
            headTurn,
            gazeAway: gaze.away,
            gazeDirection: gaze.direction,
            mouthOpen: (mar != null && mar > 0.45) || (jawOpen != null && jawOpen > 0.35),
        };
    }

    private buildVideoRes(): CheatVideoRes {
        const counts = this.relabelSamples();
        const poseAvailable = this.samples.filter((sample) => sample.pose).length;
        const gazeAvailable = this.samples.filter((sample) => sample.gaze_x != null || sample.l2cs_yaw != null).length;
        const faceN = this.samples.filter((sample) => sample.pose || sample.gaze_x != null || sample.l2cs_yaw != null).length;
        const noFace = this.samples.length - faceN;
        const readN = this.readSuccess;
        const baseline = this.baseline();
        const covered = readN > 0 ? this.darkCount / readN : null;
        const staticRatio = readN > 1 ? this.staticCount / (readN - 1) : null;
        const downRatio = baseline.poseOk && poseAvailable > 0 ? counts.down / poseAvailable : null;
        const turnRatio = baseline.poseOk && poseAvailable > 0 ? counts.turn / poseAvailable : null;
        const gazeBaselineOk = baseline.gaze != null || baseline.l2csYaw != null;
        const awayRatio = gazeBaselineOk && gazeAvailable > 0 ? counts.away / gazeAvailable : null;
        const qualityFlags: string[] = [];
        if (this.samples.length && !baseline.poseOk) qualityFlags.push('baseline_failed');
        if (this.samples.length && !gazeBaselineOk) qualityFlags.push('gaze_baseline_unavailable');

        let status = 'not_started';
        let error = '';
        if (this.samples.length === 0) status = 'not_started';
        else if (faceN <= 0) {
            status = 'no_valid_face';
            error = '采样帧中未检测到有效人脸';
        } else status = 'ok';

        const risks: CheatVideoRes['risks'] = [];
        let score = 0;
        if (covered != null && covered > THRESHOLDS.COVERED_WARN) {
            risks.push({ text: `摄像头遮挡率 ${(covered * 100).toFixed(0)}%`, level: 'danger' });
            score += 40;
        }
        if (staticRatio != null && staticRatio > THRESHOLDS.STATIC_WARN) {
            risks.push({ text: `画面静止率 ${(staticRatio * 100).toFixed(0)}%`, level: 'danger' });
            score += 30;
        }
        if (downRatio != null && downRatio > THRESHOLDS.DOWN_DANGER) {
            risks.push({ text: `低头率 ${(downRatio * 100).toFixed(0)}%（可能在看手机）`, level: 'danger' });
            score += 30;
        } else if (downRatio != null && downRatio > THRESHOLDS.DOWN_WARN) {
            risks.push({ text: `低头率 ${(downRatio * 100).toFixed(0)}%，建议人工复核`, level: 'warn' });
            score += 15;
        }
        if (awayRatio != null && awayRatio > THRESHOLDS.AWAY) {
            risks.push({ text: `视线偏离率 ${(awayRatio * 100).toFixed(0)}%`, level: 'warn' });
        }
        if (!risks.length) risks.push({ text: '画面正常，未检测到遮挡或静止异常', level: 'ok' });

        return {
            covered_ratio: covered,
            static_ratio: staticRatio,
            sample_count: this.samples.length,
            total_frames: this.samples.length,
            read_success_count: readN,
            read_failed_count: 0,
            duration: this.lastTSec,
            down_ratio: downRatio,
            away_ratio: awayRatio,
            head_turn_ratio: turnRatio,
            gaze_engine: this.gazeEngine,
            gaze: {
                status,
                error,
                down_count: counts.down,
                away_count: counts.away,
                head_turn_count: counts.turn,
                face_detected_count: faceN,
                no_face_count: noFace,
                face_detected_ratio: this.samples.length > 0 ? faceN / this.samples.length : null,
                no_face_ratio: this.samples.length > 0 ? noFace / this.samples.length : null,
            },
            evidence_segments: {
                head_down: mergeSegments(this.samples, 'head_down', THRESHOLDS.VIDEO_INTERVAL_SEC),
                gaze_away: mergeSegments(this.samples, 'gaze_away', THRESHOLDS.VIDEO_INTERVAL_SEC, true),
            },
            quality_flags: qualityFlags,
            risks,
            score: Math.min(score, 100),
        };
    }
}
