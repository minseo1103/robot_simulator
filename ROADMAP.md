# Roadmap

Concise growth plan for the Unitree G1 web simulator. Each phase builds on the last. This repository is still the same static Three.js app.

## Phase 0 — Foundation

Make the project discoverable and measurable before UX work.

- README with a one-line description, live demo, local run steps, and feature list
- This roadmap
- Set the repository website to the hosted demo
- Privacy-friendly `analytics.js` hook for `page_view`, `load_g1`, `preset_click`, `export_pose`, and `webcam_start`

## Phase 1 — First 30 seconds — done

Onboarding so a first visit shows the robot and a single obvious next step (move a joint or try a pose) without reading the panels.

- [x] Auto-load the G1 model from the same URDF as Load G1. A second load is ignored while one is in flight. After a successful load the button becomes Reload. If auto-load fails, one Start demo button retries and plays Wave.
- [x] Dismissible 3-step tip: robot loaded, try a pose, copy Python. Dismissal is stored in `localStorage` (`rs_onboarding_dismissed`) so a return visit stays quiet.
- [x] The empty joint list is a loading state until the model is ready. After load, the pose library, joint controls, and Python export are shown.
- [x] Events on the Phase 0 hook: `onboarding_start`, `g1_autoload`, `onboarding_dismiss`, `demo_preset`.

## Phase 2 — Shareable pose and action URLs — done

A link reopens the same joint pose, and a short action sequence when it fits. No account and no shortener.

- [x] Copy share link writes an absolute `?pose=` URL. The payload is base64url of packed int16 centiradians (0.01 rad) for non-zero G1 joints. `#p=` and `#pose=` are accepted on load.
- [x] After G1 auto-load, a pose in the URL is applied and the joint sliders update. The tab title becomes “Shared pose · Robot Kinematics”.
- [x] Action Builder frames are included when the absolute URL stays under about 2,000 characters. Longer sequences share the pose only; the pose panel says so.
- [x] Events on the Phase 0 hook: `share_copy`, `share_load`.

## Phase 3 — Mobile UI — done

Phone and short landscape windows keep the robot on screen. The two floating columns become a bottom sheet with Controls and Code tabs.

- [x] At widths of 768px and below, and on short landscape screens (height ≤ 520px and width ≤ 1024px), controls and code sit in a bottom sheet. A tab bar switches between them. Minimize still collapses the open sheet. The code sheet starts collapsed.
- [x] Pose presets, Load/Reload, Copy Python, and Copy share link use at least a 44px tap target. Joint sliders have a larger thumb and track so a thumb can drag them without hover.
- [x] Webcam capture stays hidden on small screens, with a note that it is best on desktop. The desktop webcam block is unchanged.
- [x] The 3D view fills the space above the sheet in portrait and landscape, so an open sheet does not cover the robot.
- [x] Event on the Phase 0 hook: `mobile_layout` (once per page, when the narrow layout applies).

## Phase 4 — SEO, landing, and one official demo URL

A short landing page in front of the simulator, and a single canonical demo URL (the Firebase host already used in meta tags).

## Phase 5 — Later features

- Community poses
- IK polish
- Export formats beyond the current Python arrays

## Non-goals (for now)

- Rewriting the simulator
- Mandatory login
- A native app
