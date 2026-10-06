# 핀·속성 패널 전환 계측 및 개선 결과

## 원인과 수정

두 가지 병목을 실제 전체 편집기에서 확인했다.

1. 핀 패널 width 전환 중 ResizeObserver가 상위 state를 갱신하고, 변경된 이벤트 함수/context가 memoized scene까지 전달되어 모든 카드 행·인라인 셀이 다시 실행됐다. NativeCanvasWorkspace 경계에서 이벤트 참조를 고정하되 마지막 commit된 함수를 호출하도록 수정했다. 넓은 구간의 inspector 제약이 같으면 관측 상태도 같게 유지한다.
2. 카드 렌더를 제거한 뒤에도 약 270ms가 남았다. 상세 Profiler에서 약 263ms가 접혀 있는 NativeAdvancedEditor의 설계/정책 검증 하위 트리였다. 초안을 계속 mount한 채 문서/table/userId/snapshot/busy가 같을 때 하위 트리를 memo로 유지했다. 최신 onSave는 committed event로 전달한다.

제품 커밋: `81491dd`(이벤트·폭 제약 분리), `82a9899`(고급 폼 memo). CSS 모션과 Native 저장·권한·복구 로직은 변경하지 않았다. 렌더 중 사용하는 renderExportActions는 이벤트처럼 고정하지 않는다.

## 최종 비교 방법

- Chrome 154 / Windows, viewport 1600×1000 / DPR 1, NativeProjectView 전체 및 테이블당 10컬럼.
- 전용 localhost:4180의 고정 예제, synthetic GET만 사용하고 모든 API 쓰기를 차단했다. 댓글 목록은 비어 있다.
- production React profiling 및 함수 계측. 각 조건 warmup 1회+본 측정 3회, 50/100개 테이블, 핀/속성 패널의 열림/닫힘 각각 비교.
- 최종 harness/build HEAD `fdeac96`, dirty=false. baseline 빌드는 git의 `1745501` 원본 NativeProjectView/NativeERDCanvas/NativeAdvancedEditor를 perf 전용 transform으로 정확히 재생한다. metadata implementation은 original-1745501 또는 current로 구분한다. 상세 subtree profiler는 최종 비교에서 껐다.
- 반대편 패널과 준비 모션을 완전히 정렬한다. 핀 측정 시 inspector는 320px 열린 상태, inspector 측정 시 핀은 0px 닫힌 상태다. 전환의 최소 240ms 및 종료 후 2 rAF를 포함해 구간 총 소요 시간을 기록한다. 이 값은 CSS duration이나 순수 paint 시간과 다르다.
- 초기 탐색 계측에서 준비 모션이 일부 겹치는 문제를 발견하여 React commit/CSS 등록 이후 대기하도록 수정했다. 최종 64개 표본(본 측정 48+warmup 16)만 정식 비교에 사용한다. 탐색/중간 단계/반응형 표본은 원시 폴더에 별도로 보존했다.

## 결과

아래 값은 본 측정 3회의 중앙값이다. 단위 ms. 긴 첫 프레임을 p95만으로 숨기지 않도록 최장 프레임과 누적 React 시간을 함께 기록했다.

| 테이블 | 패널·동작 | 구간 총 소요 전→후 | 누적 React 전→후 | 최장 프레임 전→후 |
|---|---|---:|---:|---:|
| 50 | 핀 열기 | 1557.8 → 268.7 | 1358.3 → 13.7 | 390.0 → 20.0 |
| 50 | 핀 닫기 | 1556.0 → 278.8 | 1349.3 → 14.2 | 379.9 → 20.0 |
| 50 | 속성 열기 | 629.4 → 278.9 | 335.3 → 14.3 | 369.9 → 20.1 |
| 50 | 속성 닫기 | 639.0 → 278.7 | 345.3 → 14.1 | 380.1 → 20.0 |
| 100 | 핀 열기 | 4686.2 → 287.2 | 4333.9 → 19.9 | 1180.0 → 30.0 |
| 100 | 핀 닫기 | 4694.8 → 277.8 | 4329.5 → 18.5 | 1150.0 → 30.0 |
| 100 | 속성 열기 | 1408.3 → 277.9 | 1085.8 → 22.6 | 1149.9 → 30.1 |
| 100 | 속성 닫기 | 1407.0 → 278.4 | 1081.9 → 18.3 | 1150.1 → 30.0 |

100개 조건에서 핀 전환 한 번의 행 실행 400회 / 인라인 셀 12,400회가 모두 0회로 줄었다. 속성 전환의 행 100회 / 인라인 셀 3,100회도 0회다. 50개 조건 역시 개선 후 0회였다.

모든 최종 표본에서 targetReached/documentUnchanged=true, 함수 sample dropped=0, 카메라 transform 불변과 비교용 반대편 패널의 동일한 최종 너비를 확인했다. transitionrun/end에서 width/grid-template-columns/opacity/visibility 전환이 유지됐다. 원본 220ms/180ms CSS를 제거하지 않았다.

## 회귀·안전성 검증

- committed event 테스트: 함수 참조 안정성, 미commit render 배제, 최신 권한/저장 구현과 원래 Promise 반환, optional callback 제거 확인.
- Inspector 폭 정규화 테스트: 700px stacking 경계와 좁은 폭/드래그·키보드 bounds 및 clamp 결과가 기존과 동일함을 확인.
- Advanced memo 테스트: panel-only 갱신에는 같은 context를 유지하면서 최신 save를 호출하고, actor/snapshot/busy/recovery 변화는 반영한다.
- 브라우저에서 고급 인덱스 이름에 panel-draft-retained를 입력하고 inspector를 완전히 닫은 뒤 다시 열어 원문 보존을 확인했다. 검증용 입력은 실제 입력 초기화 버튼으로 정리했다.
- 800px에서 핀의 아래쪽 height 전환, 640px에서 inspector-stacked/너비 640px/리사이저 숨김을 확인했다. 도메인 맵으로 전환한 뒤에도 속성 패널 열기·닫기와 최신 이벤트 연결을 확인했다.
- `pnpm check`: **222개 파일 / 2,758개 테스트 통과**, 27개 파일 / 500개 환경 조건부 skip. 포맷·전체 타입·제품 빌드 통과. 기존 큰 bundle 경고는 유지된다.

## 범위와 상태

이 결과는 고정 fixture와 profiling build의 패널 전환 비교다. 초기 문서 mount, 고급 식을 실제로 수정할 때의 정책 검증 비용, 실제 API/협업/대량 댓글, 다른 브라우저와 실제 IME는 별도다. React actualDuration과 함수 inclusive span을 합산하여 paint 시간으로 해석하지 않는다.

성능 lab에서 구현·검증·커밋했다. main checkout/원격 push/PR 생성은 수행하지 않았다. 제품 반영 시 두 제품 커밋과 관련 문서만 선별하고 계측 plugin·예제·원시는 제외한다.

원시/집계/manifest/입력 보존 screenshot: `artifacts/performance/2026-10-06-panel-transitions/` (Git 제외).
계획: [PanelTransitions](../planning/2026-10-06-Performance-PanelTransitions.md).
구현: [PanelRenderIsolation](2026-10-06-Performance-PanelRenderIsolation.md), [AdvancedPanelMemo](2026-10-06-Performance-AdvancedPanelMemo.md).
