import assert from 'node:assert/strict';
import { G1_JOINTS, SHARE_URL_LIMIT, buildShareUrl, decodeShare, readShareToken } from './share.js';

const WAVE = {
    left_hip_pitch_joint: -0.1,
    left_knee_joint: 0.3,
    left_ankle_pitch_joint: -0.2,
    right_hip_pitch_joint: -0.1,
    right_knee_joint: 0.3,
    right_ankle_pitch_joint: -0.2,
    right_shoulder_pitch_joint: 0.35,
    right_shoulder_roll_joint: -1.25,
    right_elbow_joint: 1.35,
    right_wrist_roll_joint: 0.5,
};

function sparseEqual(actual, expected) {
    const keys = new Set([...Object.keys(actual), ...Object.keys(expected)]);
    for (const key of keys) {
        const a = Object.prototype.hasOwnProperty.call(actual, key) ? actual[key] : 0;
        const b = Object.prototype.hasOwnProperty.call(expected, key) ? expected[key] : 0;
        assert.ok(Math.abs(a - b) < 1e-9, `${key}: ${a} vs ${b}`);
    }
}

const page = 'https://robotsimulator-1ce32.web.app/';
const built = buildShareUrl(page, { ...WAVE, left_hip_roll_joint: 0, not_a_joint: 9 }, []);
assert.equal(built.droppedActions, false);
assert.equal(built.frames, 0);
assert.ok(built.url.startsWith(page + '?pose='));
assert.ok(built.url.length < 400, built.url);
assert.equal(readShareToken(built.url), built.token);

const decoded = decodeShare(built.token);
assert.ok(decoded);
sparseEqual(decoded.pose, WAVE);
assert.deepEqual(decoded.frames, []);

const frames = [
    { raw: WAVE, duration: 1.5 },
    { raw: { left_shoulder_roll_joint: 1.5, right_shoulder_roll_joint: -1.5 }, duration: 0.4 },
];
const withFrames = buildShareUrl(page + '?other=1#ignored', WAVE, frames);
assert.equal(withFrames.droppedActions, false);
assert.equal(withFrames.frames, 2);
const round = decodeShare(readShareToken(withFrames.url));
sparseEqual(round.pose, WAVE);
assert.equal(round.frames.length, 2);
sparseEqual(round.frames[0].raw, WAVE);
assert.equal(round.frames[0].duration, 1.5);
sparseEqual(round.frames[1].raw, frames[1].raw);
assert.equal(round.frames[1].duration, 0.4);
assert.ok(withFrames.url.includes('other=1'));
assert.ok(!withFrames.url.includes('#'));

const hashToken = built.token;
assert.equal(readShareToken(page + '#p=' + hashToken), hashToken);
assert.equal(readShareToken(page + '#pose=' + hashToken), hashToken);
assert.equal(readShareToken(page + '?pose=' + hashToken + '#p=nope'), hashToken);

assert.equal(decodeShare(''), null);
assert.equal(decodeShare('!!!'), null);
assert.equal(decodeShare('YQ'), null);

const dense = {};
G1_JOINTS.forEach((name, i) => { dense[name] = (i + 1) / 100; });
const many = [];
for (let i = 0; i < 40; i++) many.push({ raw: dense, duration: 1.5 });
const dropped = buildShareUrl(page, dense, many);
assert.equal(dropped.droppedActions, true);
assert.equal(dropped.frames, 0);
assert.ok(dropped.url.length <= SHARE_URL_LIMIT, String(dropped.url.length));
const poseOnly = decodeShare(dropped.token);
sparseEqual(poseOnly.pose, dense);
assert.deepEqual(poseOnly.frames, []);

const short = buildShareUrl('http://localhost:8080/', { left_elbow_joint: -2.53 }, [
    { raw: { left_elbow_joint: -2.53 }, duration: 0.1 },
]);
assert.equal(short.droppedActions, false);
const shortDecoded = decodeShare(short.token);
assert.equal(shortDecoded.pose.left_elbow_joint, -2.53);
assert.equal(shortDecoded.frames[0].duration, 0.1);

console.log('share.test.mjs ok', {
    waveChars: built.url.length,
    framesChars: withFrames.url.length,
    droppedChars: dropped.url.length,
});
