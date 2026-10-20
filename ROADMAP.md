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

## Phase 2 — Shareable pose and action URLs

Put a pose or an action sequence in the URL so a link reopens the same motion. No account.

## Phase 3 — Mobile UI

Phone layout: reachable panels, touch-friendly joint controls, and a viewport that is not desktop-only.

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
