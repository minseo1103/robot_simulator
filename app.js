import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import URDFLoader from 'urdf-loader'; // provided via import map
import { track } from './analytics.js';
import { buildShareUrl, decodeShare, readShareToken } from './share.js';

track('page_view');

// --- 1. SETUP SCENE ---
const container = document.getElementById('3d-canvas-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color('#0f111a'); 

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(3, 2, 3);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0.5, 0);

// --- IK SETUP ---
const transformControl = new TransformControls(camera, renderer.domElement);
transformControl.addEventListener('dragging-changed', function (event) {
    controls.enabled = !event.value;
});
scene.add(transformControl);

const ikTargetMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.04, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xff0000, wireframe: true })
);
ikTargetMesh.visible = false;
scene.add(ikTargetMesh);

let ikEnabled = false;
let currentEndEffector = null;

function solveCCD(endEffector, targetPosition, iterations = 3) {
    if (!endEffector || !currentRobot) return;
    
    const chain = [];
    let curr = endEffector;
    while (curr && curr.isURDFRobot !== true) {
        if (curr.isURDFJoint && curr.jointType !== 'fixed') {
            chain.push(curr);
        }
        curr = curr.parent;
    }
    
    const eePos = new THREE.Vector3();
    const jointPos = new THREE.Vector3();
    const vecToEnd = new THREE.Vector3();
    const vecToTarget = new THREE.Vector3();
    const axisWorld = new THREE.Vector3();
    const q = new THREE.Quaternion();

    for (let iter = 0; iter < iterations; iter++) {
        for (let i = 0; i < chain.length; i++) {
            const joint = chain[i];
            
            endEffector.getWorldPosition(eePos);
            joint.getWorldPosition(jointPos);
            
            vecToEnd.subVectors(eePos, jointPos).normalize();
            vecToTarget.subVectors(targetPosition, jointPos).normalize();
            
            joint.getWorldQuaternion(q);
            axisWorld.copy(joint.axis).applyQuaternion(q).normalize();
            
            const projEnd = vecToEnd.projectOnPlane(axisWorld).normalize();
            const projTarget = vecToTarget.projectOnPlane(axisWorld).normalize();
            
            let angle = projEnd.angleTo(projTarget);
            
            const cross = new THREE.Vector3().crossVectors(projEnd, projTarget);
            if (cross.dot(axisWorld) < 0) angle = -angle;

            angle *= 0.5; // dampening
            
            let newAngle = joint.angle + angle;
            
            let min = joint.limit && joint.limit.lower !== undefined ? parseFloat(joint.limit.lower) : -Math.PI;
            let max = joint.limit && joint.limit.upper !== undefined ? parseFloat(joint.limit.upper) : Math.PI;
            
            if (newAngle < min) newAngle = min;
            if (newAngle > max) newAngle = max;
            
            currentRobot.setJointValue(joint.name, newAngle);
            
            const input = document.getElementById(`val-${joint.name}`);
            const slider = document.getElementById(`slide-${joint.name}`);
            if (input && slider) {
                input.value = newAngle.toFixed(2);
                slider.value = newAngle;
            }
            
            joint.updateMatrixWorld(true);
        }
    }
}

transformControl.addEventListener('change', () => {
    if (ikEnabled && currentEndEffector) {
        solveCCD(currentEndEffector, ikTargetMesh.position, 2);
    }
});

// --- LIGHTING ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
dirLight.position.set(5, 10, 5);
dirLight.castShadow = true;
dirLight.shadow.bias = -0.001;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
scene.add(dirLight);

const grid = new THREE.GridHelper(10, 20, 0x444455, 0x1f2130);
scene.add(grid);

const axesHelper = new THREE.AxesHelper(1);
scene.add(axesHelper);

// --- RESIZE HANDLER ---
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- ANIMATION LOOP ---
let isPlaying = false;
let playbackStartTime = 0;
let playbackFrames = [];
let poseTween = null;

function animate(time) {
    if (time === undefined) time = performance.now();
    requestAnimationFrame(animate);
    controls.update();

    if (!isPlaying && poseTween && currentRobot) {
        const elapsed = time - poseTween.start;
        const t = poseTween.duration <= 0 ? 1 : Math.min(1, elapsed / poseTween.duration);
        const eased = t * t * (3 - 2 * t);
        const names = Object.keys(poseTween.to);
        for (let i = 0; i < names.length; i++) {
            const name = names[i];
            writeJoint(name, poseTween.from[name] + (poseTween.to[name] - poseTween.from[name]) * eased);
        }
        if (t >= 1) poseTween = null;
    }

    if (isPlaying && currentRobot && playbackFrames.length > 0) {
        const elapsed = (time - playbackStartTime) / 1000.0;
        
        let totalTime = 0;
        let segmentIndex = -1;
        
        for (let i = 0; i < playbackFrames.length - 1; i++) {
            const nextTime = totalTime + (playbackFrames[i+1].duration || 1.5);
            if (elapsed >= totalTime && elapsed < nextTime) {
                segmentIndex = i;
                break;
            }
            totalTime = nextTime;
        }
        
        if (segmentIndex !== -1) {
            const frameA = playbackFrames[segmentIndex];
            const frameB = playbackFrames[segmentIndex + 1];
            const segmentDuration = frameB.duration || 1.5;
            const alpha = (elapsed - totalTime) / segmentDuration;
            
            const names = Object.keys(frameA.raw);
            names.forEach(name => {
                const valA = frameA.raw[name];
                const valB = frameB.raw[name];
                if (valA !== undefined && valB !== undefined) {
                    const interpVal = THREE.MathUtils.lerp(valA, valB, alpha);
                    currentRobot.setJointValue(name, interpVal);
                    
                    const input = document.getElementById(`val-${name}`);
                    const slider = document.getElementById(`slide-${name}`);
                    if (input && slider) {
                        input.value = interpVal.toFixed(2);
                        slider.value = interpVal;
                    }
                }
            });
        } else if (elapsed >= totalTime && playbackFrames.length > 1) {
            isPlaying = false;
            const btn = document.getElementById('play-action-btn');
            if(btn) {
                btn.innerText = "▶ Play";
                btn.disabled = false;
            }
        }
    }

    renderer.render(scene, camera);
}
requestAnimationFrame(animate);

// --- 2. ROBOT LOADING LOGIC ---
let currentRobot = null;
const jointsContainer = document.getElementById('joints-container');
const robotStatusEl = document.getElementById('robot-status');
const robotStatusTitleEl = document.getElementById('robot-status-title');
const robotStatusDetailEl = document.getElementById('robot-status-detail');
const startDemoBtn = document.getElementById('start-demo-btn');
const loadG1Btn = document.getElementById('load-g1-btn');
const jointsBlock = document.getElementById('joints-block');
const G1_URDF_URL = './g1_model/g1_29dof.urdf';
let g1Loading = false;
let g1LoadToken = 0;
let shareApplied = false;

function jointLimits(joint) {
    const min = joint.limit && joint.limit.lower !== undefined ? parseFloat(joint.limit.lower) : -Math.PI;
    const max = joint.limit && joint.limit.upper !== undefined ? parseFloat(joint.limit.upper) : Math.PI;
    return { min, max };
}

function clampJoint(joint, value) {
    const { min, max } = jointLimits(joint);
    if (Number.isNaN(value)) return 0;
    if (value < min) return min;
    if (value > max) return max;
    return value;
}

function isMovableJoint(joint) {
    return joint && joint.jointType !== 'fixed' && joint.jointType !== 'floating' && joint.name !== 'floating_base_joint';
}

function writeJoint(name, value) {
    if (!currentRobot) return;
    const joint = currentRobot.joints[name];
    if (!isMovableJoint(joint)) return;
    const next = clampJoint(joint, value);
    currentRobot.setJointValue(name, next);
    const input = document.getElementById(`val-${name}`);
    const slider = document.getElementById(`slide-${name}`);
    if (input) input.value = next.toFixed(2);
    if (slider) slider.value = String(next);
}

function readJoint(name) {
    const slider = document.getElementById(`slide-${name}`);
    if (slider && slider.value !== '') {
        const parsed = parseFloat(slider.value);
        if (!Number.isNaN(parsed)) return parsed;
    }
    const joint = currentRobot && currentRobot.joints[name];
    return joint && typeof joint.angle === 'number' ? joint.angle : 0;
}

function finishPoseTween() {
    if (!poseTween) return;
    const to = poseTween.to;
    poseTween = null;
    Object.keys(to).forEach(name => writeJoint(name, to[name]));
}

function setRobotStatus(state, title, detail) {
    if (!robotStatusEl) return;
    robotStatusEl.hidden = false;
    robotStatusEl.dataset.state = state;
    if (robotStatusTitleEl) robotStatusTitleEl.textContent = title;
    if (robotStatusDetailEl) robotStatusDetailEl.textContent = detail;
    if (startDemoBtn) startDemoBtn.hidden = state !== 'error';
    if (loadG1Btn) {
        loadG1Btn.disabled = state === 'loading';
        if (state === 'loading') loadG1Btn.textContent = currentRobot ? 'Reloading…' : 'Loading G1…';
        else if (state === 'ready' || currentRobot) loadG1Btn.textContent = '↻ Reload G1';
        else loadG1Btn.textContent = '🤖 Load G1';
    }
    if (state === 'loading' && !currentRobot) {
        if (jointsBlock) jointsBlock.hidden = true;
        const preset = document.getElementById('preset-section');
        if (preset) preset.style.display = 'none';
        const pose = document.getElementById('pose-manager');
        if (pose) pose.style.display = 'none';
        const action = document.getElementById('action-builder');
        if (action) action.style.display = 'none';
        const ik = document.getElementById('ik-container');
        if (ik) ik.style.display = 'none';
    }
    if (state === 'ready' && jointsBlock) jointsBlock.hidden = false;
}

const manager = new THREE.LoadingManager();
const loader = new URDFLoader(manager);

// Configure mapping for internal ROS 'package://' URL schemas
loader.packages = {
    'g1_description': './g1_model'
};

function loadG1(source) {
    if (g1Loading) return Promise.resolve(false);
    g1Loading = true;
    const token = ++g1LoadToken;
    const reloading = !!currentRobot;
    setRobotStatus(
        'loading',
        reloading ? 'Reloading Unitree G1' : 'Loading Unitree G1',
        'The 29-DOF model opens on its own.'
    );

    return new Promise((resolve) => {
        loader.load(G1_URDF_URL,
            robot => {
                if (token !== g1LoadToken) return;
                g1Loading = false;
                try {
                    setupRobotInScene(robot, 'Unitree G1 (29-DOF)');
                    setRobotStatus('ready', 'Unitree G1', 'Loaded. Try a pose, then copy Python.');
                    track('load_g1');
                    if (source === 'autoload') track('g1_autoload', { result: 'success' });
                    try {
                        applyPendingShareOnce();
                    } catch (shareErr) {
                        console.error(shareErr);
                    }
                    startOnboarding();
                    resolve(true);
                } catch (err) {
                    console.error(err);
                    setRobotStatus('error', 'Could not show the G1', 'Start the demo to try loading again.');
                    if (source === 'autoload') track('g1_autoload', { result: 'error' });
                    resolve(false);
                }
            },
            undefined,
            err => {
                if (token !== g1LoadToken) return;
                g1Loading = false;
                console.error(err);
                setRobotStatus('error', 'G1 did not load', 'Start the demo to try again. It loads the same model and plays Wave.');
                if (source === 'autoload') track('g1_autoload', { result: 'error' });
                resolve(false);
            }
        );
    });
}

loadG1Btn?.addEventListener('click', () => {
    loadG1(currentRobot ? 'reload' : 'manual');
});

startDemoBtn?.addEventListener('click', () => {
    loadG1('start_demo').then(ok => {
        if (ok && !shareApplied) applyPreset('wave', 'start_demo');
    });
});

// --- MINIMIZE LOGIC ---
document.getElementById('minimize-ui-btn')?.addEventListener('click', (e) => {
    const content = document.getElementById('ui-panel-content');
    const panel = document.getElementById('ui-panel');
    const isMinimized = content.style.display === 'none';
    content.style.display = isMinimized ? 'block' : 'none';
    panel.style.width = isMinimized ? '360px' : 'fit-content';
    e.target.innerText = isMinimized ? '−' : '+';
});

document.getElementById('minimize-code-btn')?.addEventListener('click', (e) => {
    const content = document.getElementById('code-panel-content');
    const panel = document.getElementById('code-panel');
    const isMinimized = content.style.display === 'none';
    content.style.display = isMinimized ? 'flex' : 'none';
    panel.style.width = isMinimized ? '340px' : 'fit-content';
    e.target.innerText = isMinimized ? '−' : '+';
});

function loadRobotContent(urdfContent, filename) {
    try {
        const robot = loader.parse(urdfContent);
        setupRobotInScene(robot, filename);
        setRobotStatus('ready', filename, 'Loaded. Try a pose, then copy Python.');
        startOnboarding();
    } catch (e) {
        setRobotStatus('error', 'Could not read that URDF', 'Start the demo to load the Unitree G1.');
        console.error(e);
    }
}

function setupRobotInScene(robot, filename) {
    if (currentRobot) {
        scene.remove(currentRobot);
        currentRobot.traverse(child => {
            if (child.isMesh) {
                child.geometry.dispose();
                if (child.material.dispose) child.material.dispose();
            }
        });
    }
    jointsContainer.innerHTML = '';

    // Ensure default upright orientation if needed
    robot.rotation.x = -Math.PI / 2;
    robot.traverse(c => {
        c.castShadow = true;
        c.receiveShadow = true;
    });

    scene.add(robot);
    currentRobot = robot;

    const box = new THREE.Box3().setFromObject(robot);
    const center = box.getCenter(new THREE.Vector3());
    controls.target.copy(center);

    createJointSliders(robot);
}

function createJointSliders(robot) {
    const joints = Object.values(robot.joints).filter(j => j.jointType !== 'fixed');
    
    // Group joints logically
    const categories = {
        'Left Arm': [],
        'Right Arm': [],
        'Arms': [],
        'Left Leg': [],
        'Right Leg': [],
        'Legs': [],
        'Torso & Head': [],
        'Other': []
    };

    joints.forEach(joint => {
        const name = joint.name.toLowerCase();
        const isLeft = name.includes('left');
        const isRight = name.includes('right');

        if (name.includes('shoulder') || name.includes('elbow') || name.includes('wrist') || name.includes('arm')) {
            if (isLeft) categories['Left Arm'].push(joint);
            else if (isRight) categories['Right Arm'].push(joint);
            else categories['Arms'].push(joint);
        } else if (name.includes('hip') || name.includes('knee') || name.includes('ankle') || name.includes('leg')) {
            if (isLeft) categories['Left Leg'].push(joint);
            else if (isRight) categories['Right Leg'].push(joint);
            else categories['Legs'].push(joint);
        } else if (name.includes('waist') || name.includes('torso') || name.includes('spine') || name.includes('head') || name.includes('neck')) {
            categories['Torso & Head'].push(joint);
        } else {
            categories['Other'].push(joint);
        }
    });

    Object.keys(categories).forEach(cat => {
        if (categories[cat].length === 0) return;

        const details = document.createElement('details');
        details.className = 'category-details';

        const summary = document.createElement('summary');
        summary.className = 'joint-category-header';
        summary.innerText = cat;
        details.appendChild(summary);

        const content = document.createElement('div');
        content.className = 'category-content';

        categories[cat].forEach(joint => {
            const wrapper = document.createElement('div');
            wrapper.className = 'slider-wrapper';

            const labelContainer = document.createElement('div');
            labelContainer.className = 'slider-labels';

            const label = document.createElement('span');
            label.innerText = joint.name;

            const valInput = document.createElement('input');
            valInput.type = 'number';
            valInput.className = 'val-input';
            valInput.id = 'val-' + joint.name;
            let initialVal = joint.angle || 0;
            valInput.value = initialVal.toFixed(2);

            labelContainer.appendChild(label);
            labelContainer.appendChild(valInput);

            const slider = document.createElement('input');
            slider.type = 'range';
            slider.id = 'slide-' + joint.name;
            
            // Retrieve limits
            let min = joint.limit && joint.limit.lower !== undefined ? parseFloat(joint.limit.lower) : -Math.PI;
            let max = joint.limit && joint.limit.upper !== undefined ? parseFloat(joint.limit.upper) : Math.PI;
            
            valInput.min = min.toFixed(2);
            valInput.max = max.toFixed(2);
            valInput.step = 0.01;

            slider.min = min;
            slider.max = max;
            slider.step = 0.01;
            slider.value = initialVal;

            slider.addEventListener('input', (e) => {
                poseTween = null;
                clearPresetSelection();
                const val = parseFloat(e.target.value);
                robot.setJointValue(joint.name, val);
                valInput.value = val.toFixed(2);
            });

            valInput.addEventListener('change', (e) => {
                poseTween = null;
                clearPresetSelection();
                let val = parseFloat(e.target.value);
                if (isNaN(val)) val = 0;
                if (val < min) val = min;
                if (val > max) val = max;
                e.target.value = val.toFixed(2);
                
                robot.setJointValue(joint.name, val);
                slider.value = val;
            });

            wrapper.appendChild(labelContainer);
            wrapper.appendChild(slider);
            content.appendChild(wrapper);
        });

        details.appendChild(content);
        jointsContainer.appendChild(details);
    });
    
    if (jointsContainer.children.length === 0) {
        jointsContainer.innerHTML = "<p style='color:#fff; font-size:12px;'>No movable joints found.</p>";
    } else {
        document.getElementById('pose-manager').style.display = 'block';
        document.getElementById('action-builder').style.display = 'block';
        document.getElementById('ik-container').style.display = 'block';
        const presetSection = document.getElementById('preset-section');
        if (presetSection) presetSection.style.display = 'block';

        const ikSelect = document.getElementById('ik-end-effector');
        ikSelect.innerHTML = '<option value="">Select End Effector...</option>';
        joints.forEach(j => {
            const opt = document.createElement('option');
            opt.value = j.name;
            opt.innerText = j.name;
            ikSelect.appendChild(opt);
        });

        const possibleEndEffectors = joints.filter(j => j.name.includes('wrist') || j.name.includes('hand') || j.name.includes('tool') || j.name.includes('link7'));
        if (possibleEndEffectors.length > 0) {
            ikSelect.value = possibleEndEffectors[possibleEndEffectors.length - 1].name;
            currentEndEffector = possibleEndEffectors[possibleEndEffectors.length - 1];
        } else {
            ikSelect.value = joints[joints.length - 1].name;
            currentEndEffector = joints[joints.length - 1];
        }
    }
}

document.getElementById('ik-end-effector').addEventListener('change', (e) => {
    if (!currentRobot) return;
    if (e.target.value) {
        currentEndEffector = currentRobot.joints[e.target.value] || null;
        if (ikEnabled && currentEndEffector) {
            currentEndEffector.getWorldPosition(ikTargetMesh.position);
            transformControl.attach(ikTargetMesh);
        }
    } else {
        currentEndEffector = null;
        transformControl.detach();
    }
});

document.getElementById('ik-toggle-btn').addEventListener('click', (e) => {
    ikEnabled = !ikEnabled;
    const btn = e.target;
    if (ikEnabled) {
        btn.innerText = "Disable IK Target";
        btn.style.background = "rgba(239, 68, 68, 0.15)";
        btn.style.borderColor = "rgba(239, 68, 68, 0.4)";
        btn.style.color = "#fca5a5";
        ikTargetMesh.visible = true;
        
        if (currentEndEffector) {
            currentEndEffector.getWorldPosition(ikTargetMesh.position);
            transformControl.attach(ikTargetMesh);
        } else {
            alert("Please select an end effector first.");
        }
    } else {
        btn.innerText = "Enable IK Target";
        btn.style.background = "rgba(99, 102, 241, 0.15)";
        btn.style.borderColor = "rgba(99, 102, 241, 0.4)";
        btn.style.color = "#818cf8";
        ikTargetMesh.visible = false;
        transformControl.detach();
    }
});

// --- 3. POSE LIBRARY ---
// Radians, clamped to URDF limits when applied. Unlisted joints return to 0.
// Leg signs follow the Unitree walk-ready stance (slight negative hip pitch, positive knee).
const STAND = {
    left_hip_pitch_joint: -0.1,
    left_knee_joint: 0.3,
    left_ankle_pitch_joint: -0.2,
    right_hip_pitch_joint: -0.1,
    right_knee_joint: 0.3,
    right_ankle_pitch_joint: -0.2,
};

const PRESETS = {
    tpose: {
        left_shoulder_roll_joint: 1.5,
        right_shoulder_roll_joint: -1.5,
    },
    wave: {
        ...STAND,
        right_shoulder_pitch_joint: 0.35,
        right_shoulder_roll_joint: -1.25,
        right_elbow_joint: 1.35,
        right_wrist_roll_joint: 0.5,
    },
    walkready: {
        ...STAND,
        left_shoulder_pitch_joint: 0.25,
        left_shoulder_roll_joint: 0.2,
        left_elbow_joint: 0.85,
        right_shoulder_pitch_joint: 0.25,
        right_shoulder_roll_joint: -0.2,
        right_elbow_joint: 0.85,
    },
    sit: {
        left_hip_pitch_joint: -1.05,
        left_knee_joint: 2.05,
        left_ankle_pitch_joint: -0.55,
        right_hip_pitch_joint: -1.05,
        right_knee_joint: 2.05,
        right_ankle_pitch_joint: -0.55,
        left_shoulder_pitch_joint: 0.35,
        left_elbow_joint: 0.7,
        right_shoulder_pitch_joint: 0.35,
        right_elbow_joint: 0.7,
    },
    handshake: {
        ...STAND,
        waist_yaw_joint: -0.25,
        right_shoulder_pitch_joint: 0.85,
        right_shoulder_roll_joint: -0.15,
        right_elbow_joint: 0.95,
    },
    squat: {
        left_hip_pitch_joint: -0.75,
        left_knee_joint: 1.55,
        left_ankle_pitch_joint: -0.7,
        right_hip_pitch_joint: -0.75,
        right_knee_joint: 1.55,
        right_ankle_pitch_joint: -0.7,
        left_shoulder_pitch_joint: 0.45,
        left_elbow_joint: 0.55,
        right_shoulder_pitch_joint: 0.45,
        right_elbow_joint: 0.55,
    },
};

function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function clearPresetSelection() {
    document.querySelectorAll('.preset-btn.active').forEach(btn => btn.classList.remove('active'));
}

function applyJointMap(map, animate) {
    if (!currentRobot) return;
    finishPoseTween();
    const from = {};
    const to = {};
    Object.values(currentRobot.joints).forEach(joint => {
        if (!isMovableJoint(joint)) return;
        const raw = Object.prototype.hasOwnProperty.call(map, joint.name) ? map[joint.name] : 0;
        from[joint.name] = readJoint(joint.name);
        to[joint.name] = clampJoint(joint, raw);
    });
    const duration = animate && !prefersReducedMotion() ? 700 : 0;
    if (duration === 0) {
        Object.keys(to).forEach(name => writeJoint(name, to[name]));
        return;
    }
    poseTween = { from, to, start: performance.now(), duration };
}

function applyPreset(name, source) {
    const pose = PRESETS[name];
    if (!pose || !currentRobot) return false;
    applyJointMap(pose, true);
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.preset === name);
    });
    track('demo_preset', { preset: name, source: source || 'library' });
    onboardingNotePreset();
    return true;
}

document.getElementById('preset-grid')?.addEventListener('click', (event) => {
    const button = event.target.closest('.preset-btn');
    if (!button) return;
    const preset = button.dataset.preset || 'unknown';
    track('preset_click', { preset });
    applyPreset(preset, 'library');
});

document.getElementById('webcam-toggle-btn')?.addEventListener('click', () => {
    const label = (document.getElementById('webcam-toggle-btn')?.textContent || '').toLowerCase();
    if (label.includes('start')) track('webcam_start');
});

// --- 3b. FIRST-RUN TIPS ---
const ONBOARDING_KEY = 'rs_onboarding_dismissed';
const ONBOARDING_STEPS = [
    {
        key: 'loaded',
        title: 'Robot loaded',
        body: 'The Unitree G1 is on the stage. Drag to look around, then try a pose.',
        primary: 'Next',
    },
    {
        key: 'pose',
        title: 'Try a pose',
        body: 'Wave is a one-tap demo. Any button in the pose library works the same way.',
        primary: 'Try Wave',
        highlight: '#preset-section',
    },
    {
        key: 'export',
        title: 'Copy Python',
        body: 'Copy Python puts the current joint angles on your clipboard.',
        primary: 'Copy Python',
        highlight: '#export-pose-btn',
    },
];
let onboardingActive = false;
let onboardingStep = 0;
let onboardingStarted = false;

function onboardingDismissed() {
    try {
        return localStorage.getItem(ONBOARDING_KEY) === '1';
    } catch (_) {
        return false;
    }
}

function rememberOnboardingDismissed() {
    try {
        localStorage.setItem(ONBOARDING_KEY, '1');
    } catch (_) { /* private mode */ }
}

function clearOnboardingHighlight() {
    document.querySelectorAll('.onboarding-highlight').forEach(el => el.classList.remove('onboarding-highlight'));
}

function renderOnboarding() {
    const root = document.getElementById('onboarding');
    const step = ONBOARDING_STEPS[onboardingStep];
    if (!root || !step) return;
    const kicker = document.getElementById('onboarding-kicker');
    const title = document.getElementById('onboarding-title');
    const body = document.getElementById('onboarding-body');
    const next = document.getElementById('onboarding-next');
    if (kicker) kicker.textContent = `Step ${onboardingStep + 1} of ${ONBOARDING_STEPS.length}`;
    if (title) title.textContent = step.title;
    if (body) body.textContent = step.body;
    if (next) next.textContent = step.primary;
    clearOnboardingHighlight();
    if (step.highlight) {
        const target = document.querySelector(step.highlight);
        if (target) {
            target.classList.add('onboarding-highlight');
            target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
    }
    root.hidden = false;
}

function startOnboarding() {
    if (onboardingStarted || onboardingDismissed()) return;
    onboardingStarted = true;
    onboardingActive = true;
    onboardingStep = 0;
    track('onboarding_start');
    renderOnboarding();
}

function dismissOnboarding(via) {
    if (!onboardingActive) return;
    const step = ONBOARDING_STEPS[onboardingStep];
    track('onboarding_dismiss', { step: step ? step.key : 'unknown', via });
    rememberOnboardingDismissed();
    onboardingActive = false;
    const root = document.getElementById('onboarding');
    if (root) root.hidden = true;
    clearOnboardingHighlight();
}

function onboardingNotePreset() {
    if (!onboardingActive) return;
    if (onboardingStep < ONBOARDING_STEPS.length - 1) {
        onboardingStep = ONBOARDING_STEPS.length - 1;
        renderOnboarding();
    }
}

function onboardingPrimary() {
    if (!onboardingActive) return;
    const step = ONBOARDING_STEPS[onboardingStep];
    if (!step) return;
    if (step.key === 'pose') {
        applyPreset('wave', 'onboarding');
        return;
    }
    if (step.key === 'export') {
        exportCurrentPose();
        return;
    }
    if (onboardingStep >= ONBOARDING_STEPS.length - 1) {
        dismissOnboarding('done');
        return;
    }
    onboardingStep += 1;
    renderOnboarding();
}

document.getElementById('onboarding-next')?.addEventListener('click', onboardingPrimary);
document.getElementById('onboarding-skip')?.addEventListener('click', () => dismissOnboarding('skip'));
document.getElementById('onboarding-close')?.addEventListener('click', () => dismissOnboarding('close'));
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && onboardingActive) dismissOnboarding('close');
});

// --- 4. POSE MANAGER ---
document.getElementById('reset-pose-btn').addEventListener('click', () => {
    if (!currentRobot) return;
    poseTween = null;
    clearPresetSelection();
    const joints = Object.values(currentRobot.joints).filter(j => j.jointType !== 'fixed');
    
    joints.forEach((joint) => {
        let val = 0;
        let min = joint.limit && joint.limit.lower !== undefined ? parseFloat(joint.limit.lower) : -Math.PI;
        let max = joint.limit && joint.limit.upper !== undefined ? parseFloat(joint.limit.upper) : Math.PI;
        
        if (val < min) val = min;
        if (val > max) val = max;

        currentRobot.setJointValue(joint.name, val);
        
        const input = document.getElementById(`val-${joint.name}`);
        const slider = document.getElementById(`slide-${joint.name}`);
        if (input && slider) {
            input.value = val.toFixed(2);
            slider.value = val;
        }
    });
});

const getCurrentPoseData = () => {
    const poseData = {};
    document.querySelectorAll('.val-input').forEach((input) => {
        if (!input.id.startsWith('val-')) return;
        const jointName = input.id.slice(4);
        const value = parseFloat(input.value);
        poseData[jointName] = Number.isNaN(value) ? 0 : value;
    });
    return poseData;
};

const getCurrentPoseArrayString = (poseData) => {
    if (!poseData) poseData = getCurrentPoseData();
    const getVals = (names) => {
        return names.map(n => {
            let v = poseData[n];
            if (v === undefined || Number.isNaN(v)) v = 0.0;
            let str = v.toString();
            if (!str.includes('.')) str += ".0";
            return str;
        }).join(', ');
    };

    const left_leg_joints = ['left_hip_pitch_joint', 'left_hip_roll_joint', 'left_hip_yaw_joint', 'left_knee_joint', 'left_ankle_pitch_joint', 'left_ankle_roll_joint'];
    const right_leg_joints = ['right_hip_pitch_joint', 'right_hip_roll_joint', 'right_hip_yaw_joint', 'right_knee_joint', 'right_ankle_pitch_joint', 'right_ankle_roll_joint'];
    const waist_joints = ['waist_yaw_joint', 'waist_roll_joint', 'waist_pitch_joint'];
    const left_arm_joints = ['left_shoulder_pitch_joint', 'left_shoulder_roll_joint', 'left_shoulder_yaw_joint', 'left_elbow_joint', 'left_wrist_roll_joint', 'left_wrist_pitch_joint', 'left_wrist_yaw_joint'];
    const right_arm_joints = ['right_shoulder_pitch_joint', 'right_shoulder_roll_joint', 'right_shoulder_yaw_joint', 'right_elbow_joint', 'right_wrist_roll_joint', 'right_wrist_pitch_joint', 'right_wrist_yaw_joint'];

    return `[
        # Legs (12 DOF)
        ${getVals(left_leg_joints)},
        ${getVals(right_leg_joints)},
        # Waist (3 DOF)
        ${getVals(waist_joints)},
        # Left arm
        ${getVals(left_arm_joints)},
        # Right arm
        ${getVals(right_arm_joints)},
    ]`;
};

function copyText(text) {
    const fallback = () => {
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.top = '0';
        area.style.left = '0';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.focus();
        area.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
        area.remove();
        return ok ? Promise.resolve() : Promise.reject(new Error('copy failed'));
    };
    if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
        return navigator.clipboard.writeText(text).catch(fallback);
    }
    return fallback();
}

function exportCurrentPose() {
    if (!currentRobot) return;
    finishPoseTween();
    track('export_pose');
    const pyCode = `pose = ${getCurrentPoseArrayString()}`;
    const status = document.getElementById('export-status');
    const flash = (message) => {
        if (!status) return;
        status.textContent = message;
        status.style.opacity = '1';
        setTimeout(() => { status.style.opacity = '0'; }, 2000);
    };
    copyText(pyCode).then(() => {
        flash('Copied to clipboard!');
        if (onboardingActive) dismissOnboarding('export');
    }).catch(() => {
        flash('Could not copy. Allow clipboard access and try again.');
    });
}

document.getElementById('export-pose-btn').addEventListener('click', exportCurrentPose);

// --- 4. ACTION BUILDER ---
let actionFrames = [];

const updateActionUI = () => {
    document.getElementById('action-frame-count').innerText = `${actionFrames.length} Frames`;
    const disabled = actionFrames.length === 0;
    document.getElementById('play-action-btn').disabled = disabled;
    document.getElementById('export-action-btn').disabled = disabled;
    document.getElementById('clear-action-btn').disabled = disabled;
    
    const listEl = document.getElementById('action-frames-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    
    actionFrames.forEach((frame, idx) => {
        const item = document.createElement('div');
        item.style.display = 'flex';
        item.style.justifyContent = 'space-between';
        item.style.alignItems = 'center';
        item.style.padding = '0.4rem 0.5rem';
        item.style.background = 'rgba(255,255,255,0.05)';
        item.style.borderRadius = '4px';
        item.style.fontSize = '0.75rem';
        
        const label = document.createElement('span');
        label.innerText = `Frame ${idx + 1} (${frame.duration}s)`;
        
        const previewBtn = document.createElement('button');
        previewBtn.innerText = '👀 View';
        previewBtn.className = 'secondary-btn';
        previewBtn.style.padding = '0.2rem 0.4rem';
        previewBtn.style.fontSize = '0.7rem';
        previewBtn.style.flex = '0 0 auto';
        
        previewBtn.onclick = () => {
            if (!currentRobot) return;
            const names = Object.keys(frame.raw);
            names.forEach(name => {
                currentRobot.setJointValue(name, frame.raw[name]);
                const input = document.getElementById(`val-${name}`);
                const slider = document.getElementById(`slide-${name}`);
                if (input && slider) {
                    input.value = frame.raw[name].toFixed(2);
                    slider.value = frame.raw[name];
                }
            });
        };
        
        item.appendChild(label);
        item.appendChild(previewBtn);
        listEl.appendChild(item);
    });
};

document.getElementById('add-frame-btn').addEventListener('click', () => {
    if (!currentRobot) return;
    const rawData = getCurrentPoseData();
    const pyString = getCurrentPoseArrayString();
    let duration = parseFloat(document.getElementById('frame-duration')?.value);
    if (isNaN(duration)) duration = 1.5;
    actionFrames.push({ raw: rawData, py: pyString, duration: duration });
    updateActionUI();
});

document.getElementById('clear-action-btn').addEventListener('click', () => {
    actionFrames = [];
    updateActionUI();
});

document.getElementById('export-action-btn').addEventListener('click', () => {
    if (actionFrames.length === 0) return;
    
    let pyCode = "action = [\n";
    actionFrames.forEach(frame => {
        let formattedFrame = frame.py.split('\n').map(line => "    " + line).join('\n');
        pyCode += `    # duration: ${frame.duration}s\n` + formattedFrame + ",\n";
    });
    pyCode += "]";

    navigator.clipboard.writeText(pyCode).then(() => {
        const status = document.getElementById('action-status');
        status.style.opacity = '1';
        setTimeout(() => status.style.opacity = '0', 2000);
    });
});

document.getElementById('play-action-btn').addEventListener('click', () => {
    if (actionFrames.length === 0 || isPlaying || !currentRobot) return;
    poseTween = null;
    
    if (actionFrames.length === 1) {
        const frame = actionFrames[0];
        const names = Object.keys(frame.raw);
        names.forEach(name => {
            currentRobot.setJointValue(name, frame.raw[name]);
            const input = document.getElementById(`val-${name}`);
            const slider = document.getElementById(`slide-${name}`);
            if (input && slider) {
                input.value = frame.raw[name].toFixed(2);
                slider.value = frame.raw[name];
            }
        });
        return;
    }

    isPlaying = true;
    document.getElementById('play-action-btn').innerText = "Playing...";
    document.getElementById('play-action-btn').disabled = true;
    playbackFrames = actionFrames;
    playbackStartTime = performance.now();
});
// --- 5. CODE EXECUTION ---
document.getElementById('run-code-btn')?.addEventListener('click', () => {
    if (!currentRobot) return;
    
    const code = document.getElementById('code-input').value;
    const statusEl = document.getElementById('code-status');
    statusEl.style.display = 'block';
    
    try {
        const parsedFrames = parsePythonAction(code);
        if (parsedFrames.length === 0) {
            throw new Error("No valid waypoints found in code.");
        }
        
        statusEl.style.color = '#10b981';
        statusEl.innerText = `Successfully parsed ${parsedFrames.length} frames. Playing...`;
        
        // Load into action builder
        actionFrames = parsedFrames;
        updateActionUI();
        
        // Play it
        document.getElementById('play-action-btn').click();
        
        setTimeout(() => { statusEl.style.display = 'none'; }, 3000);
        
    } catch (err) {
        statusEl.style.color = '#ef4444';
        statusEl.innerText = "Error parsing code: " + err.message;
        console.error(err);
    }
});

function parsePythonAction(code) {
    // Basic regex parser for the specific user format provided.
    const frames = [];
    
    // 1. Extract waypoint arrays
    // Looks for wpX = [ ... ]
    const wpRegex = /wp\d+\s*=\s*\[([\s\S]*?)\]/g;
    const waypoints = [];
    let match;
    while ((match = wpRegex.exec(code)) !== null) {
        // clean up comments and whitespace, match numbers
        const dataStr = match[1].replace(/#.*/g, '');
        const nums = dataStr.match(/-?\d+(\.\d+)?/g);
        if (nums) {
            waypoints.push(nums.map(n => parseFloat(n)));
        }
    }
    
    if (waypoints.length === 0) return frames;
    
    // 2. Extract durations
    // Looks for durations = (0.55, 0.70, 1.5)
    let durations = [];
    const durRegex = /durations\s*=\s*\((.*?)\)/;
    const durMatch = durRegex.exec(code);
    if (durMatch) {
         durations = durMatch[1].match(/\d+(\.\d+)?/g).map(d => parseFloat(d));
    }
    
    // If we have waypoints but no explicit durations list, just make them exactly 1.5s
    while (durations.length < waypoints.length) {
        durations.push(1.5);
    }
    
    // 3. Map to joint names based on the order defined in getCurrentPoseArrayString!
    const left_leg_joints = ['left_hip_pitch_joint', 'left_hip_roll_joint', 'left_hip_yaw_joint', 'left_knee_joint', 'left_ankle_pitch_joint', 'left_ankle_roll_joint'];
    const right_leg_joints = ['right_hip_pitch_joint', 'right_hip_roll_joint', 'right_hip_yaw_joint', 'right_knee_joint', 'right_ankle_pitch_joint', 'right_ankle_roll_joint'];
    const waist_joints = ['waist_yaw_joint', 'waist_roll_joint', 'waist_pitch_joint'];
    const left_arm_joints = ['left_shoulder_pitch_joint', 'left_shoulder_roll_joint', 'left_shoulder_yaw_joint', 'left_elbow_joint', 'left_wrist_roll_joint', 'left_wrist_pitch_joint', 'left_wrist_yaw_joint'];
    const right_arm_joints = ['right_shoulder_pitch_joint', 'right_shoulder_roll_joint', 'right_shoulder_yaw_joint', 'right_elbow_joint', 'right_wrist_roll_joint', 'right_wrist_pitch_joint', 'right_wrist_yaw_joint'];
    
    const jointOrder = [
        ...left_leg_joints,
        ...right_leg_joints,
        ...waist_joints,
        ...left_arm_joints,
        ...right_arm_joints
    ];
    
    waypoints.forEach((wp, idx) => {
        const raw = {};
        for(let i=0; i<jointOrder.length; i++) {
            if (i < wp.length) {
                raw[jointOrder[i]] = wp[i];
            }
        }
        
        let pyStr = ""; // We can reconstruct or leave empty for generated frames
        frames.push({
            raw: raw,
            py: pyStr,
            duration: durations[idx] || 1.5
        });
    });
    
    return frames;
}

// --- 6. SHAREABLE POSE URLS ---
const pendingShareToken = readShareToken(window.location.href);
const pendingShare = pendingShareToken ? decodeShare(pendingShareToken) : null;
let shareConsumed = false;
let shareStatusTimer = 0;

function flashShareStatus(message, tone) {
    const status = document.getElementById('share-status');
    if (!status) return;
    status.textContent = message;
    status.style.color = tone === 'error' ? '#fca5a5' : tone === 'warn' ? '#fbbf24' : '#10b981';
    status.style.opacity = '1';
    clearTimeout(shareStatusTimer);
    shareStatusTimer = setTimeout(() => { status.style.opacity = '0'; }, 3200);
}

function expandPoseMap(sparse) {
    const full = {};
    if (!currentRobot) return full;
    Object.values(currentRobot.joints).forEach(joint => {
        if (!isMovableJoint(joint)) return;
        const has = sparse && Object.prototype.hasOwnProperty.call(sparse, joint.name);
        const raw = has ? Number(sparse[joint.name]) : 0;
        full[joint.name] = clampJoint(joint, raw);
    });
    return full;
}

function applyPendingShareOnce() {
    if (shareConsumed) return;
    shareConsumed = true;
    if (!pendingShareToken) return;
    if (!pendingShare) {
        flashShareStatus('Could not read this share link.', 'error');
        track('share_load', { result: 'invalid' });
        return;
    }
    const pose = expandPoseMap(pendingShare.pose);
    applyJointMap(pose, false);
    clearPresetSelection();
    const frames = Array.isArray(pendingShare.frames) ? pendingShare.frames : [];
    if (frames.length) {
        actionFrames = frames.map(frame => {
            const raw = expandPoseMap(frame.raw);
            return {
                raw,
                duration: frame.duration,
                py: getCurrentPoseArrayString(raw),
            };
        });
        updateActionUI();
    }
    document.title = 'Shared pose · Robot Kinematics';
    shareApplied = true;
    const count = frames.length;
    flashShareStatus(
        count ? `Shared pose restored (${count} frame${count === 1 ? '' : 's'}).` : 'Shared pose restored.',
        'ok'
    );
    track('share_load', {
        result: 'success',
        frames: count,
        included: count ? 'pose+action' : 'pose',
    });
}

document.getElementById('share-pose-btn')?.addEventListener('click', () => {
    if (!currentRobot) return;
    finishPoseTween();
    const built = buildShareUrl(
        window.location.href,
        getCurrentPoseData(),
        actionFrames.map(frame => ({ raw: frame.raw, duration: frame.duration }))
    );
    copyText(built.url).then(() => {
        try { history.replaceState(null, '', built.url); } catch (_) { /* keep the copied URL anyway */ }
        if (built.droppedActions) {
            flashShareStatus('Copied pose link. Action left out (over ~2,000 characters).', 'warn');
        } else if (built.frames > 0) {
            flashShareStatus(`Copied share link (pose + ${built.frames} frame${built.frames === 1 ? '' : 's'}).`, 'ok');
        } else {
            flashShareStatus('Copied share link.', 'ok');
        }
        track('share_copy', {
            frames: built.frames,
            included: built.frames ? 'pose+action' : 'pose',
            dropped_actions: built.droppedActions,
            length: built.url.length,
        });
    }).catch(() => {
        flashShareStatus('Could not copy. Allow clipboard access and try again.', 'error');
    });
});

// Same URDF as the Load G1 button. Runs once the module is evaluated (script is deferred).
loadG1('autoload');
