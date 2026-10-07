# 영역 선택 전후 production 계측 결과

## 조건

- Windows / Chrome 154 (Codex in-app browser), viewport 1280×720, DPR 1.
- 동일한 NativeProjectView 전체 편집기 fixture: 50/100개 테이블 × 10컬럼, 댓글 없음, API 쓰기 차단.
- React production profiling build. 개선 전은 a27b0de의 NativeERDCanvas 원본만 transform으로 대체하고, 개선 후는 9e942c4 구현을 사용한다. 공통 harness/build commit: 73594a7, 빌드 시 tracked tree clean.
- 각 조건 warmup 1회 + 본 측정 3회. stable은 선택 대상 t0/t1 유지, sweep은 동일 경로에서 t0와 t0/t1 사이를 오간다. 모든 노드를 한 번씩 선택하는 시나리오는 아니다.
- 프레임당 synthetic pointermove 4회 × 60프레임 및 release 후 3프레임. 실제 React 이벤트 경로를 실행하며 synthetic 포인터에만 capture 함수를 fixture에서 대체한다. 실제 OS 마우스 이벤트·입력 지연이나 고정 시간 드래그의 FPS 측정은 아니다.
- 각 프레임의 DOM 선택 결과도 읽어 시나리오가 수행됐는지 확인한다. 같은 작업을 두 빌드에 적용했다. 개선 전/후, 50/100 순서로 순차 실행했으며 동시 부하 측정은 하지 않았다.

## 결과

본 측정 3개의 지표별 중앙값, 시간 단위 ms. 구간 합계는 같은 63프레임이 끝나는 데 걸린 시간이다. 프레임 간격과 React actualDuration은 GPU paint 시간으로 해석하지 않는다.

| 테이블 | 선택 시나리오 | 프레임 p95 전→후 | 최장 프레임 전→후 | 누적 React 전→후 | React commit 전→후 | 구간 합계 전→후 |
|---|---|---:|---:|---:|---:|---:|
| 50 | 동일 선택 유지 | 140.0 → 10.1 | 209.9 → 10.1 | 3906.7 → 0.0 | 53 → 0 | 5959.7 → 629.9 |
| 50 | 선택 대상 변경 | 110.0 → 60.0 | 130.0 → 80.0 | 3201.2 → 217.5 | 60 → 4 | 5099.9 → 889.8 |
| 100 | 동일 선택 유지 | 230.0 → 10.1 | 239.9 → 10.1 | 5343.4 → 0.0 | 46 → 0 | 8319.6 → 630.0 |
| 100 | 선택 대상 변경 | 220.0 → 179.9 | 249.9 → 210.1 | 5074.1 → 520.2 | 45 → 4 | 8149.7 → 1440.0 |

동일 선택일 때 반복되는 React 작업은 제거됐다. 선택이 바뀌는 순간에는 전체 scene 재실행 등의 비용이 남아 100개 조건의 p95가 179.9ms다. 따라서 모든 드래그 지연이 해결됐다고 주장하지 않는다. 다음 후보는 선택이 바뀐 카드 외곽만 갱신하도록 scene/card 경계를 나누는 작업이며, 테이블 자체 이동의 durable draft 저장 최적화와도 구분한다.

## 유효성 및 검증

- 최종 32개 표본: 본 측정 24개 + warmup 8개. 모든 표본에서 documentUnchanged/cameraUnchanged/boxHidden=true, 최종 선택 t0/t1 일치.
- stable의 관측 선택 집합은 1개, sweep은 2개로 모두 기대와 일치했다. 각 표본 240개 이동 이벤트, 63개 frame interval을 확인했다.
- 최초 예비 측정은 최종 집계에서 제외했다. 브라우저 다운로드 대기 도구가 시간 초과했지만 실제 JSON 파일이 Downloads에 생성된 것을 확인해 원시를 보존했다.
- raw intervals/React commits, summary 및 SHA-256 manifest는 lab `artifacts/performance/2026-10-07-marquee-comparison/`에 보존한다(Git 제외). 4개 JSON 파일: before-50, before-100, after-50, after-100.
- 최신 원격 main 8c58988 기반 제품 전용 브랜치에서 선별 적용 후 `pnpm format`, `pnpm check` 통과: 220개 파일 / 2,758개 테스트, 27개 파일 / 500개 환경 조건부 skip. 타입·서버/웹 빌드 통과, 기존 bundle 경고 유지.
- 계측 lab 기준은 후속 로컬 main UI 변경을 포함하는 a27b0de다. 원격 main에는 그 UI 변경을 넣지 않았으므로 표의 절대 수치를 PR 배포 화면의 보장값으로 해석하지 않는다. 제품 변경의 독립 회귀 검사는 PR 기준으로 수행했다.

[계측 계획](../planning/2026-10-07-Performance-MarqueeComparison.md) · [구현 결과](2026-10-07-Performance-MarqueeIsolation.md)
