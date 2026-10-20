# Roadmap

Concise growth plan for the Unitree G1 web simulator. Each phase builds on the last. This repository is still the same static Three.js app.

## Phase 0 — Foundation

Make the project discoverable and measurable before UX work.

- README with a one-line description, live demo, local run steps, and feature list
- This roadmap
- Set the repository website to the hosted demo
- Privacy-friendly `analytics.js` hook for `page_view`, `load_g1`, `preset_click`, `export_pose`, and `webcam_start`

## Phase 1 — First 30 seconds

Onboarding so a first visit shows the robot and a single obvious next step (move a joint or try a pose) without reading the panels.

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
