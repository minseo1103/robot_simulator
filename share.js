/**
 * Compact pose / action links for the static simulator.
 *
 * Written form: ?pose=<base64url>
 * Also accepted on load: #p=<base64url> or #pose=<base64url>
 *
 * Payload (little-endian), version 1:
 *   uint8  version = 1
 *   uint8  flags (bit 0 = action frames follow; other bits must be 0)
 *   uint8  poseCount
 *   poseCount × (uint8 jointIndex, int16 centiradians)
 *   if frames:
 *     uint8 frameCount
 *     frameCount × (
 *       uint16 duration in centiseconds,
 *       uint8  jointCount,
 *       jointCount × (uint8 jointIndex, int16 centiradians)
 *     )
 *
 * Joint indexes follow the G1 29-DOF order used by Python export.
 * Angles are quantized to 0.01 rad. Zeros are omitted and restored as 0.
 * Action frames are included only when the absolute URL stays within
 * SHARE_URL_LIMIT characters.
 */

export const SHARE_URL_LIMIT = 2000;

/** Same order as the Python pose arrays in app.js. */
export const G1_JOINTS = Object.freeze([
    'left_hip_pitch_joint',
    'left_hip_roll_joint',
    'left_hip_yaw_joint',
    'left_knee_joint',
    'left_ankle_pitch_joint',
    'left_ankle_roll_joint',
    'right_hip_pitch_joint',
    'right_hip_roll_joint',
    'right_hip_yaw_joint',
    'right_knee_joint',
    'right_ankle_pitch_joint',
    'right_ankle_roll_joint',
    'waist_yaw_joint',
    'waist_roll_joint',
    'waist_pitch_joint',
    'left_shoulder_pitch_joint',
    'left_shoulder_roll_joint',
    'left_shoulder_yaw_joint',
    'left_elbow_joint',
    'left_wrist_roll_joint',
    'left_wrist_pitch_joint',
    'left_wrist_yaw_joint',
    'right_shoulder_pitch_joint',
    'right_shoulder_roll_joint',
    'right_shoulder_yaw_joint',
    'right_elbow_joint',
    'right_wrist_roll_joint',
    'right_wrist_pitch_joint',
    'right_wrist_yaw_joint',
]);

const JOINT_INDEX = new Map(G1_JOINTS.map((name, index) => [name, index]));
const MAX_FRAMES = 255;

function toCenti(radians) {
    if (!Number.isFinite(radians)) return 0;
    let value = Math.round(radians * 100);
    if (value > 32767) value = 32767;
    if (value < -32768) value = -32768;
    return value;
}

function fromCenti(value) {
    return value / 100;
}

function toDurationCs(seconds) {
    if (!Number.isFinite(seconds)) return 150;
    let value = Math.round(seconds * 100);
    if (value < 1) value = 1;
    if (value > 65535) value = 65535;
    return value;
}

function entriesFromPose(poseMap) {
    const entries = [];
    if (!poseMap || typeof poseMap !== 'object') return entries;
    for (let index = 0; index < G1_JOINTS.length; index++) {
        const name = G1_JOINTS[index];
        if (!Object.prototype.hasOwnProperty.call(poseMap, name)) continue;
        const centi = toCenti(Number(poseMap[name]));
        if (centi === 0) continue;
        entries.push({ index, centi });
    }
    return entries;
}

function bytesToBase64Url(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(token) {
    if (typeof token !== 'string' || token.length === 0 || token.length > 20000) {
        throw new Error('bad token');
    }
    if (!/^[A-Za-z0-9\-_]+$/.test(token)) throw new Error('bad token');
    const b64 = token.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const binary = atob(b64 + pad);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
}

function normalizeFrames(frames) {
    if (!Array.isArray(frames)) return [];
    const out = [];
    for (let i = 0; i < frames.length && out.length < MAX_FRAMES; i++) {
        const frame = frames[i];
        const raw = frame && frame.raw && typeof frame.raw === 'object' ? frame.raw : {};
        const duration = frame && Number.isFinite(Number(frame.duration)) ? Number(frame.duration) : 1.5;
        out.push({ raw, duration });
    }
    return out;
}

function encodePayload(poseMap, frames) {
    const poseEntries = entriesFromPose(poseMap);
    const encodedFrames = frames.map(frame => ({
        durationCs: toDurationCs(frame.duration),
        joints: entriesFromPose(frame.raw),
    }));
    const includeFrames = encodedFrames.length > 0;

    let size = 3 + poseEntries.length * 3;
    if (includeFrames) {
        size += 1;
        for (const frame of encodedFrames) size += 3 + frame.joints.length * 3;
    }

    const bytes = new Uint8Array(size);
    const view = new DataView(bytes.buffer);
    let offset = 0;
    bytes[offset++] = 1;
    bytes[offset++] = includeFrames ? 1 : 0;
    bytes[offset++] = poseEntries.length;
    for (const entry of poseEntries) {
        bytes[offset++] = entry.index;
        view.setInt16(offset, entry.centi, true);
        offset += 2;
    }
    if (includeFrames) {
        bytes[offset++] = encodedFrames.length;
        for (const frame of encodedFrames) {
            view.setUint16(offset, frame.durationCs, true);
            offset += 2;
            bytes[offset++] = frame.joints.length;
            for (const entry of frame.joints) {
                bytes[offset++] = entry.index;
                view.setInt16(offset, entry.centi, true);
                offset += 2;
            }
        }
    }
    return bytesToBase64Url(bytes);
}

function readJointBlock(view, bytes, offset, count) {
    const pose = {};
    const seen = new Set();
    for (let i = 0; i < count; i++) {
        if (offset + 3 > bytes.length) return null;
        const index = bytes[offset];
        offset += 1;
        if (index >= G1_JOINTS.length || seen.has(index)) return null;
        seen.add(index);
        const centi = view.getInt16(offset, true);
        offset += 2;
        if (centi === 0) return null;
        pose[G1_JOINTS[index]] = fromCenti(centi);
    }
    return { pose, offset };
}

/**
 * @param {string} token
 * @returns {{ pose: Record<string, number>, frames: { raw: Record<string, number>, duration: number }[] } | null}
 */
export function decodeShare(token) {
    let bytes;
    try {
        bytes = base64UrlToBytes(token);
    } catch (_) {
        return null;
    }
    if (bytes.length < 3) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 0;
    const version = bytes[offset++];
    const flags = bytes[offset++];
    if (version !== 1 || (flags & ~1) !== 0) return null;
    const poseCount = bytes[offset++];
    if (poseCount > G1_JOINTS.length) return null;
    const poseBlock = readJointBlock(view, bytes, offset, poseCount);
    if (!poseBlock) return null;
    offset = poseBlock.offset;

    const frames = [];
    if (flags & 1) {
        if (offset + 1 > bytes.length) return null;
        const frameCount = bytes[offset++];
        for (let i = 0; i < frameCount; i++) {
            if (offset + 3 > bytes.length) return null;
            const durationCs = view.getUint16(offset, true);
            offset += 2;
            const jointCount = bytes[offset++];
            if (jointCount > G1_JOINTS.length) return null;
            const block = readJointBlock(view, bytes, offset, jointCount);
            if (!block) return null;
            offset = block.offset;
            frames.push({
                raw: block.pose,
                duration: Math.max(1, durationCs) / 100,
            });
        }
    }
    if (offset !== bytes.length) return null;
    return { pose: poseBlock.pose, frames };
}

/**
 * @param {string} href
 * @returns {string | null}
 */
export function readShareToken(href) {
    let url;
    try {
        url = new URL(href, 'http://localhost');
    } catch (_) {
        return null;
    }
    const fromQuery = url.searchParams.get('pose');
    if (fromQuery) return fromQuery;
    const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
    if (!hash) return null;
    const params = new URLSearchParams(hash);
    return params.get('pose') || params.get('p') || null;
}

function urlWithToken(pageHref, token) {
    const url = new URL(pageHref, 'http://localhost');
    url.searchParams.set('pose', token);
    url.hash = '';
    return url.toString();
}

/**
 * Absolute share URL for the current pose. Action frames are included when
 * they fit in SHARE_URL_LIMIT; otherwise the link is pose-only.
 *
 * @param {string} pageHref
 * @param {Record<string, number>} poseMap
 * @param {{ raw: Record<string, number>, duration: number }[]} [frames]
 */
export function buildShareUrl(pageHref, poseMap, frames) {
    const cleanFrames = normalizeFrames(frames);
    let token = encodePayload(poseMap, cleanFrames);
    let url = urlWithToken(pageHref, token);
    let droppedActions = false;
    let included = cleanFrames.length;
    if (cleanFrames.length > 0 && url.length > SHARE_URL_LIMIT) {
        token = encodePayload(poseMap, []);
        url = urlWithToken(pageHref, token);
        droppedActions = true;
        included = 0;
    }
    return {
        url,
        token,
        frames: included,
        droppedActions,
    };
}
