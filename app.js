import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import URDFLoader from 'urdf-loader'; // provided via import map

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

function animate(time) {
    if (time === undefined) time = performance.now();
    requestAnimationFrame(animate);
    controls.update();

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
const statusEl = document.getElementById('upload-status');
const jointsContainer = document.getElementById('joints-container');

const manager = new THREE.LoadingManager();
const loader = new URDFLoader(manager);

// Configure mapping for internal ROS 'package://' URL schemas
loader.packages = {
    'g1_description': './unitree_ros_repo/robots/g1_description'
};

// Handle Built-in Unitree G1 Model
document.getElementById('load-g1-btn').addEventListener('click', () => {
    statusEl.innerText = "Loading Unitree G1...";
    loader.load('./unitree_ros_repo/robots/g1_description/g1_29dof.urdf',
        robot => {
            setupRobotInScene(robot, "Unitree G1 (29-DOF)");
        },
        undefined,
        err => {
            statusEl.innerText = "Error loading G1 Model.";
            console.error(err);
        }
    );
});

function loadRobotContent(urdfContent, filename) {
    try {
        const robot = loader.parse(urdfContent);
        setupRobotInScene(robot, filename);
    } catch (e) {
        statusEl.innerText = "Failed to parse URDF.";
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

    statusEl.innerText = filename + " loaded successfully";
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
                const val = parseFloat(e.target.value);
                robot.setJointValue(joint.name, val);
                valInput.value = val.toFixed(2);
            });

            valInput.addEventListener('change', (e) => {
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

// Auto-load Unitree G1
window.addEventListener('DOMContentLoaded', () => {
    document.getElementById('load-g1-btn').click();
});

// --- 3. POSE MANAGER ---
document.getElementById('reset-pose-btn').addEventListener('click', () => {
    if (!currentRobot) return;
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
    const inputs = document.querySelectorAll('.val-input');
    inputs.forEach((input, index) => {
        const jointName = document.querySelectorAll('.slider-labels span:first-child')[index].innerText;
        poseData[jointName] = parseFloat(input.value);
    });
    return poseData;
};

const getCurrentPoseArrayString = () => {
    const poseData = getCurrentPoseData();
    const getVals = (names) => {
        return names.map(n => {
            let v = poseData[n] || 0.0;
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

document.getElementById('export-pose-btn').addEventListener('click', () => {
    if (!currentRobot) return;
    const arrayStr = getCurrentPoseArrayString();
    const pyCode = `pose = ${arrayStr}`;

    navigator.clipboard.writeText(pyCode).then(() => {
        const status = document.getElementById('export-status');
        status.style.opacity = '1';
        setTimeout(() => status.style.opacity = '0', 2000);
    });
});

// --- 4. ACTION BUILDER ---
let actionFrames = [];

const updateActionUI = () => {
    document.getElementById('action-frame-count').innerText = `${actionFrames.length} Frames`;
    const disabled = actionFrames.length === 0;
    document.getElementById('play-action-btn').disabled = disabled;
    document.getElementById('export-action-btn').disabled = disabled;
    document.getElementById('clear-action-btn').disabled = disabled;
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
