import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extractVideoSignals } from '../src/cheat/scoring.ts';
import { SPEECH_THRESHOLDS, SpeechSession, varianceOf } from '../src/speech/session.ts';

assert.equal(varianceOf([1, 1, 1, 1]), 0);
assert.ok(varianceOf([0.08, 0.22, 0.08, 0.22]) > SPEECH_THRESHOLDS.VAR_SPEAK);

const rest = (session, from, to) => {
    let last = null;
    for (let t = from; t <= to + 1e-9; t += 0.05) {
        last = session.ingest({ tSec: t, mar: 0.07, jawOpen: 0.04 });
    }
    return last;
};

const talk = (session, from, to) => {
    let last = null;
    for (let t = from, i = 0; t <= to + 1e-9; t += 0.05, i += 1) {
        last = session.ingest({
            tSec: t,
            mar: i % 2 === 0 ? 0.14 : 0.26,
            jawOpen: i % 2 === 0 ? 0.18 : 0.32,
        });
    }
    return last;
};

const holdOpen = (session, from, to, mar) => {
    let last = null;
    for (let t = from; t <= to + 1e-9; t += 0.05) {
        last = session.ingest({ tSec: t, mar, jawOpen: 0.2 });
    }
    return last;
};

const quiet = new SpeechSession();
const quietLive = rest(quiet, 0, 1.0);
assert.equal(quietLive.speaking, false);
assert.equal(quietLive.count, 0);
assert.equal(quietLive.onset, false);
assert.equal(quietLive.label, '未说话');
assert.ok(quietLive.marBaseline != null, 'rest MAR should calibrate');

const one = new SpeechSession();
rest(one, 0, 0.8);
const during = talk(one, 0.85, 1.5);
assert.equal(during.speaking, true, 'oscillating MAR should start speaking');
assert.equal(during.onset || during.speaking, true);
assert.match(during.label, /说话中/);
const after = rest(one, 1.95, 2.6);
assert.equal(after.speaking, false);
assert.equal(after.count, 1, `one utterance, got ${after.count}`);
assert.ok(after.lastUtterance && after.lastUtterance.duration >= SPEECH_THRESHOLDS.MIN_UTTER_SEC);
assert.equal(after.utterances[0].index, 1);
assert.ok(after.envelope.some((tick) => tick.speaking), 'envelope keeps speaking ticks');

const two = new SpeechSession();
rest(two, 0, 0.8);
talk(two, 0.85, 1.4);
rest(two, 1.85, 2.4);
talk(two, 2.45, 3.1);
const twoLive = rest(two, 3.55, 4.1);
assert.equal(twoLive.count, 2, `two utterances, got ${twoLive.count}`);
assert.equal(twoLive.utterances[1].index, 2);

const yawn = new SpeechSession();
rest(yawn, 0, 0.8);
const yawnLive = holdOpen(yawn, 0.85, 2.0, 0.55);
assert.equal(yawnLive.yawnHold, true, 'held high MAR is yawn');
assert.equal(yawnLive.speaking, false);
const yawnAfter = rest(yawn, 2.5, 3.2);
assert.equal(yawnAfter.count, 0, 'yawn must not count as speech');

const twitch = new SpeechSession();
rest(twitch, 0, 0.8);
twitch.ingest({ tSec: 0.85, mar: 0.22, jawOpen: 0.3 });
const twitchLive = rest(twitch, 0.90, 1.5);
assert.equal(twitchLive.count, 0, 'single frame twitch is not an utterance');

assert.deepEqual(
    extractVideoSignals({ covered_ratio: 0, static_ratio: 0, down_ratio: 0, gaze: { no_face_ratio: 0 } }),
    [],
);

const faceView = await readFile(new URL('../src/components/FaceView/FaceView.tsx', import.meta.url), 'utf8');
if (!faceView.includes('SpeechSession')) throw new Error('FaceView missing SpeechSession');

const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
if (!app.includes('说话 / 口型')) throw new Error('App missing 说话 / 口型 panel');
if (!app.includes('说话次数')) throw new Error('App missing 说话次数');

const scoring = await readFile(new URL('../src/cheat/scoring.ts', import.meta.url), 'utf8');
if (scoring.includes('SpeechSession') || scoring.includes('B3-9')) {
    throw new Error('visual speech must not mint a new B3 signal');
}

console.log('verify-speech: pass');
