# 최신 main 성능 검증 결과

## 결론

최신 main의 Native 편집 UI는 기존 simple-cards 수준의 화면 이동 성능을 유지하지 못했다. 특히 새 인라인 편집 컴포넌트를 실제로 렌더링하는 경로에서 프레임 간격이 증가했다. 이번 작업은 검증이며 제품 최적화 코드는 변경하지 않았다.

## 기준과 방법

- 제품 기준: origin/main `1ac4d6d`; lab 측정 커밋 `fdd477c8687d58d734b6ea2436a383ecb2a26413`, dirty=false.
- Lab merge 충돌은 최신 원격 제품 코드로 해결했다. features/components/app/server/packages의 원격 대비 차이가 없음을 확인했다. main checkout은 변경하지 않았다.
- Chrome 154, DPR 1, viewport 1280×720, surface 1280×520. 50/100 테이블, 각각 10컬럼.
- production React profiling 빌드, 한 rAF당 synthetic wheel 1회, 표본당 120프레임 왕복 이동.
- Native editable-presentation / 기존 v1 simple-cards: 조건별 warmup 1회 + 본 측정 3회. 두 번째 본 측정은 순서를 반대로 실행했다.
- 진단 대조군 Native baseline은 동일 카드·관계 UI에서 editorContext/onEdit가 없는 조회 경로다. 조건별 warmup 1회+본 측정 3회. baseline을 제품 해결책으로 간주하지 않는다.
- 새 NativeCanvasInlineCell에 editorContext를 전달하도록 lab 전용 어댑터를 갱신했다. memoized context와 noSave를 유지하며 실제 계정/API/서버 저장을 사용하지 않는다. 모션을 제거하지 않으며 유한 진입 모션이 끝난 후 이동을 측정한다.

## 본 측정 결과

p95와 React 값은 본 측정 3회의 지표 중앙값이다. 초과 프레임은 3회 합계(360프레임).

| 테이블 | 렌더 경로 | frame p95 중앙값 (범위) | React actualDuration 중앙값 | >25ms | >50ms |
|---|---|---:|---:|---:|---:|
| 50 | Native 편집 UI | 39.9ms (30.0–40.2) | 1.7ms | 200/360 | 2/360 |
| 50 | Native 조회 대조군 | 10.1ms | 1.0ms | 0/360 | 0/360 |
| 50 | v1 simple-cards | 10.1ms | 2.2ms | 0/360 | 0/360 |
| 100 | Native 편집 UI | 49.9ms (40.1–60.0) | 1.7ms | 287/360 | 20/360 |
| 100 | Native 조회 대조군 | 20.1ms (20.0–29.9) | 1.3ms | 14/360 | 0/360 |
| 100 | v1 simple-cards | 10.1ms | 2.6ms | 0/360 | 0/360 |

- idle rAF 중앙값은 약 10ms였다. 이전 실행의 11.1ms와는 환경 차이가 있으므로 이번 동시 대조군을 기준으로 판단한다.
- 새 탭에서도 100개 Native 편집 경로를 추가 3회 측정했다. p95 30.1/40.0/40.0ms, >25ms 60/47/41개로 저하가 재현됐다. 기존 반복 표본과 분리해서 기록한다.
- 총 27개 원시 표본 모두 dirty=false, 문서 fingerprint 불변, 120프레임, 동일 surface, 카메라 중간 이동 및 시작 위치 복귀를 검증했다.
- 측정된 nativeCanvasScene / relationGeometry / nativeColumnTypeDisplay 호출은 이동 중 0회다. 최신 root는 NativeCanvasWorkspace로 분리되어 있어 NativeERDCanvas wrapper 카운터를 root 실행 횟수로 해석하지 않는다. 전체 React 비용은 Profiler 값으로 보고한다.
- 100개 편집 UI의 world DOM은 18,219개, 조회 대조군 16,219개, simple-cards 1,802개였다. DOM 개수만으로 원인을 확정할 수 없다.

## 해석과 다음 검증

인라인 편집 경로를 포함하면 지연이 크게 늘지만 React actualDuration은 1~2ms 수준이다. 따라서 React 재렌더가 유일하거나 가장 큰 원인이라는 결론은 이번 결과로 지지되지 않는다. 인라인 셀/Tooltip/주변 DOM 및 브라우저 렌더링 경로가 우선 조사 후보이며, frame 시간에서 React 시간을 뺀 값을 paint 비용으로 단정하지 않는다.

1. 인라인 셀의 비편집 상태, Tooltip wrapper/위치 관찰, 스타일 효과를 각각 독립적으로 대조해 비용이 발생하는 경로를 좁힌다.
2. 실제 pointer/trackpad 입력과 전체 workspace(속성/댓글 패널 포함)의 브라우저 trace에서 style/layout/paint/composite 및 이벤트 처리를 분리한다.
3. 원본 UI·애니메이션을 보존하면서 편집 상태 진입 시에만 비용이 필요한 컴포넌트를 활성화하는 방안을 검증한다. 조사 결과 없이 셀 또는 모션을 제거하는 변경은 하지 않는다.
4. 동일 조건 재측정에서 simple-cards와의 차이와 >25ms 프레임 감소를 확인한 후 개선 완료를 판단한다.

## 범위와 산출물

- 이번 검증은 테이블 뷰의 정상 상태 synthetic pan이다. 실제 협업/API 지연, 마운트 속도, 줌/도메인 맵, 전체 workspace 전환 성능은 별도다.
- `pnpm format` 및 production profiling build(공유 빌드/web typecheck 포함) 통과. 제품 코드를 변경하지 않았으므로 전체 제품 테스트를 재실행했다고 보고하지 않는다.
- 원시 파일 및 검증 요약: `artifacts/performance/2026-10-06-main-parity/raw/`, `validated-summary.json` (Git 제외).
- 계획: [MainParityValidation](../planning/2026-10-06-Performance-MainParityValidation.md). 어댑터: [MainMeasurementAdapter](2026-10-06-Performance-MainMeasurementAdapter.md).
