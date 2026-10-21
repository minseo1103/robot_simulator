# Unitree G1 Robot Simulator

A browser-based 3D kinematics simulator for the Unitree G1 29-DOF humanoid.

**Live demo:** https://robotsimulator-1ce32.web.app/

## Run locally

This is a static site. `index.html` loads the app as an ES module and pulls Three.js and `urdf-loader` through an import map, so open it from a local HTTP server rather than `file://`.

```bash
python3 -m http.server 8080
```

Then visit http://localhost:8080/. No install or build step is required. The page also loads MediaPipe from a CDN for webcam pose detection.

## Features

- The G1 model loads on its own, with a Start demo fallback if that load fails
- First-visit tips (robot loaded, try a pose, copy Python), remembered in this browser after dismissal
- Joint controls for the loaded robot
- Pose library (T-pose, wave, walk-ready, sit, handshake, squat)
- Webcam pose
- Inverse kinematics target
- Python pose export (copy to clipboard)
- Share link for the current pose (`?pose=`). Action Builder frames are included when the link stays under about 2,000 characters
- Action builder (keyframes, playback, and Python export)
- Narrow and phone layout: controls and code stack in a bottom sheet so the robot stays on screen

## Screenshot

![Unitree G1 simulator UI](docs/screenshot.png)

Replace `docs/screenshot.png` by serving the site, loading the G1 model, and saving a capture of the full window to that path. A short GIF can live at `docs/demo.gif` and be linked the same way.

## Analytics

`analytics.js` records named events without a third-party account or API key. On localhost it prints them to the console as `[rs-analytics]`. On the hosted site those console logs stay off unless you set `localStorage.rs_analytics` to `1`.

To attach a backend later, set a hook before the app module runs:

```html
<script>
  window.__RS_ANALYTICS__ = (name, detail) => {
    // name: page_view | load_g1 | g1_autoload | preset_click | demo_preset | export_pose | webcam_start | onboarding_start | onboarding_dismiss | share_copy | share_load | mobile_layout
  };
</script>
```

Events currently emitted: `page_view`, `load_g1`, `g1_autoload`, `preset_click`, `demo_preset`, `export_pose`, `webcam_start`, `onboarding_start`, `onboarding_dismiss`, `share_copy`, `share_load`, `mobile_layout`.

## 배포 (Firebase Hosting)

`main`에 push하면 GitHub Actions가 이 정적 사이트를 Firebase Hosting 프로젝트 `robotsimulator-1ce32`의 live 채널에 배포합니다. 주소는 https://robotsimulator-1ce32.web.app/ 입니다. 빌드 단계는 없고, 사이트 파일은 저장소 루트에서 그대로 올라갑니다.

서비스 계정 키는 저장소 secret `FIREBASE_SERVICE_ACCOUNT_ROBOTSIMULATOR_1CE32`에 넣습니다.

1. [Firebase 콘솔](https://console.firebase.google.com/)에서 프로젝트 **robotsimulator-1ce32**를 엽니다.
2. **Project settings** > **Service accounts**로 이동합니다.
3. **Generate new private key**를 눌러 JSON 키를 다운로드합니다.
4. GitHub 저장소의 **Settings > Secrets and variables > Actions > New repository secret**에서 secret을 추가합니다.
5. 이름은 `FIREBASE_SERVICE_ACCOUNT_ROBOTSIMULATOR_1CE32`, 값은 다운로드한 JSON 전체를 붙여 넣습니다.

이 secret이 없으면 `main` 배포는 실패합니다. Pull request 미리보기 배포는 secret이 없으면 채널 배포를 건너뛰고 워크플로는 성공으로 끝납니다.
