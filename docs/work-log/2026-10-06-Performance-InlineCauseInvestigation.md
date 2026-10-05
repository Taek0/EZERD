# Native 인라인 이동 지연 원인 조사 결과

## 결론

이동 중 React 셀 재렌더와 Tooltip/편집 hook 자체는 이번 지연의 주된 원인으로 지지되지 않았다. 동일 편집 UI에서 카드별 containment는 부분 개선, content-visibility:auto는 큰 개선을 보였다. 따라서 **화면 밖 카드를 포함한 브라우저의 표시 작업과 clipping/containment 경계**가 우선 개선 대상이다. 구체적인 GPU/paint 단계별 시간은 trace를 확보하지 않아 확정하지 않는다.

제품 파일은 최신 main 1ac4d6d와 동일하게 유지했다. 이번 변경은 성능 lab의 계측 어댑터·대조 조건·기록뿐이며 원격 push/제품 배포는 하지 않았다.

## 실험 조건

- Chrome 154, viewport 1280×720, canvas 1280×520, 100테이블×10컬럼.
- production React profiling build, 조건별 warmup 1회+본 측정 3회, 120 rAF-paced wheel 왕복. 2회차 조건 순서를 뒤집고 3회차도 교차했다.
- 정상 편집 UI는 원본 NativeCanvasInlineCell, tooltip, 모델 및 memoized context를 포함한다. 저장 callback은 false이며 실제 API/계정은 사용하지 않는다.
- 각 단계의 정상 편집 UI를 같은 빌드에서 다시 측정했다. 모션 duration을 0으로 바꾸지 않았다.
- 측정 빌드: 532cccf(hook/Tooltip/효과), bfdc8ed(합성/clipping/visibility), 9611cae(containment 분리).

## 결과

수치는 본 측정 3회의 p95 중앙값이다. 단계별 제어군을 기준으로 비교한다.

| 단계 | 조건 | frame p95 | >25ms / 360프레임 |
|---|---|---:|---:|
| 1 | 정상 편집 UI | 40.0ms | 140 |
| 1 | 셀 Tooltip만 제거 | 40.0ms | 146 |
| 1 | 편집 hook을 정적 동일 class span으로 대체 | 40.0ms | 168 |
| 1 | 그림자/text-shadow/filter/backdrop-filter 제거 | 40.0ms | 138 |
| 2 | 정상 편집 UI | 40.0ms | 161 |
| 2 | world will-change:transform | 40.0ms | 157 |
| 2 | 인라인 셀 overflow:visible + border-radius:0 | 29.9ms | 30 |
| 2 | 카드 content-visibility:auto | 10.1ms | 0 |
| 3 | 정상 편집 UI | 39.9ms | 106 |
| 3 | 카드 contain:layout style paint | 30.0ms | 28 |
| 3 | 카드 contain:paint | 30.0ms | 35 |
| 3 | 카드 content-visibility:auto | 10.1ms | 3 |

- 3단계 visibility 조건의 >25ms 비율은 0.83%, 정상 조건은 29.44%였다. p95는 약 75% 감소했다. 이를 전체 앱 속도 4배 또는 일정 FPS 보장으로 해석하지 않는다.
- React actualDuration 중앙값은 약 1.0–1.5ms. NativeCanvasWorkspace는 표본당 120회 실행되었으나 NativeCanvasTableRows/EditableNativeCanvasInlineCell/nativeCanvasScene/타입/관계 계산은 이동 중 0회였다.
- 100개 편집 UI world DOM 18,219개를 유지한 채 visibility 조건이 개선됐다. DOM 삭제·셀 단순화로 얻은 결과가 아니다.
- LoAF/longtask 관측은 모든 본 측정에서 0개였다. 관측이 0이라는 이유로 layout/paint/composite 비용도 0이라고 판단하지 않는다.

## 해석

Tooltip과 편집 상태 hook을 제거한 대조군도 느렸으므로 이들을 먼저 제거하거나 크게 다시 작성할 근거는 없다. world 합성 힌트만으로도 해결되지 않았다. 셀 clipping 제거와 카드 containment가 부분 개선되고, offscreen skip까지 포함한 auto에서 추가 개선됐다. 화면 밖 상세 DOM의 표시 작업을 줄이는 가설이 가장 강한 실험 근거를 갖는다.

[MDN content-visibility 설명](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/content-visibility)에 따르면 auto는 layout/style/paint containment를 켜고 사용자에게 관련 없는 요소의 내부 표시를 생략한다. 이 결합 효과를 구분하기 위해 contain-only/paint-only 대조군을 추가했다. auto의 포커스·검색 접근성과 실제 앱의 동작 적합성은 별도 검증해야 한다.

## 검증 범위와 한계

- 유효 원시 표본 52개(본 측정 36 + 워밍업 12 + 추가 화면 확인 4)에서 dirty=false, 120프레임, 동일 surface, 문서 fingerprint 불변, 중간 카메라 이동 및 시작 위치 복귀를 확인했다.
- 초기 후속 단계에서 결과 스크롤바 때문에 surface가 1265px인 1회는 표본에서 제외했다. lab HTML scrollbar-width:none을 적용해 결과 표시 여부에 따른 너비 변화를 제거하고 대조군부터 다시 측정했다.
- 워밍업 이후 카메라 시작 X가 24 또는 28px인 표본이 있었다. 각 표본의 시작/종료 위치는 동일하지만 추가 스크린샷은 같은 절대 위치가 아니다. 좌표를 맞춘 카드 영역에서도 픽셀 차이가 있어 완전한 시각 동등성을 주장하지 않는다. 카드/컬럼/관계선 등 주요 요소는 유지되어 보였으나 최종 픽셀·편집 QA가 필요하다.
- synthetic pan과 정상 상태만 측정했다. 실제 입력, 줌, 화면 재진입, 활성 입력 중 드래그/포커스/팝오버, 도메인/메모/전체 workspace는 완료 판정 범위가 아니다.
- 제품 source 디렉터리(features/components/app/server/packages)는 origin/main과 차이가 없다. 모든 대조군은 perf 전용 빌드에서만 동작한다. pnpm format 및 production profiling build(typecheck 포함) 통과.

## 권장 다음 작업

1. 카드 content-visibility:auto를 제품 적용 후보로 삼아 테이블 카드부터 한정 검증한다. 고정된 NodeLayout 너비/높이와 모델 좌표/관계 계산은 유지한다.
2. 편집·드래그·resize·포커스·오버레이가 활성화된 카드의 표시 안정성을 확인하고 필요하면 해당 카드에 visible 예외를 둔다.
3. 멀리 이동했다 돌아오기, 줌 변경, 키보드 Tab/검색/인라인 입력·IME·실패 복구, Tooltip/Select/context menu, 핀·관계선, PNG, 원본 모션과 reduced-motion을 검증한다.
4. 동일 카메라 위치의 전후 스크린샷과 실사용 pointer/trackpad 측정을 확보한다. 원본 UI의 표현 차이를 해결한 뒤 제품 반영한다.

원시 JSON/스크린샷/집계: `artifacts/performance/2026-10-06-inline-cause/` (Git 제외).
계획: [InlineCauseInvestigation](../planning/2026-10-06-Performance-InlineCauseInvestigation.md).
