# 프레임 단위 입력 반영

작성일: 2026-09-28
기준: `735f60a`, `feat/performance-measurement`.

## 구현

- 단일/다중 카드 이동·resize의 preview와 팬/wheel/zoom 카메라 상태 반영에 latest-only rAF queue를 적용했다. 연결 preview·marquee·관계선 직접 조절은 아직 별도 처리다.
- pointer는 시작 위치 기준 마지막 절대 delta를 사용한다. wheel은 pending camera에 순서대로 계산해 누적 delta와 zoom 중심을 보존하고 실제 상태 publish만 묶는다.
- pointerup/cancel/lost capture·blur·hidden 및 명시적 navigate에서 예약 입력을 flush한다. pointercancel은 기존 마지막 위치 확정 의미를 유지한다. 외부 뷰/권한 변경과 unmount에서는 이전 작업을 취소한다.
- 문서 preview 시 live ref를 즉시 갱신해 React가 다시 그리기 전에 pointerup이 와도 최종 문서를 commit한다. 예약 patch는 실행 시점의 최신 문서에 적용하며 이미 바뀐 다른 컬럼을 덮어쓰지 않는다.
- 측정 빌드에서 실제 preview와 applyCameraFrame 호출도 집계한다. 제품 빌드에는 계측 wrapper가 없다.
- 측정 화면에 Replay 120 wheel inputs를 추가했다. DOM의 실제 wheel listener에 합성 이벤트를 전달하며 `mode=internal-replay`, `scenario=WHEEL_BURST`로 기록한다. 물리 장치·native event 전달 검증을 대신하지 않는다.

## 검증

- queue 테스트에서120개 이동→1회 preview·동일 최종문서,120개 혼합wheel의 순서·최종카메라, cancel·다음frame·재진입, 대기 중 다른 문서 변경 보존을 확인했다.
- `pnpm check` 통과:389개 테스트 통과, DB 관련25개 skip, 포맷·타입·일반 빌드 통과. 측정 전용 빌드도 통과했다. 기존 큰 청크 경고는 남는다.
- 작은 실제 drag는 pointermove4개와100px 최종 이동을 확인했다. 팬 문서 불변·geometry0회도 유지했다.
- 커밋 전 wheel burst 검사에서 wheel120개, moveViewport120회, applyCameraFrame1회, Canvas render1회, 카메라 x=-120px을 확인했다. 고정 커밋 결과는 아래에 기록한다.

## 해석 범위

- 입력이 이미 서로 다른 frame에 도착하면 합쳐지지 않는다. Browser의 paced drag에서도 관계 계산 수가 감소한다고 보장하지 않는다.
- 큐는 비싼 경로 계산 자체를 빠르게 만들지 않으며 한 번의 계산이 긴 경우 여전히 main thread를 막을 수 있다.
- rAF 외부 종료 flush는 마지막 값 보존을 위해 별도로 허용한다. flush를 프레임당 중복 갱신 위반으로 세지 않는다.
- 실제 원격 서버·권한 전환·창 focus 변경과 브라우저 전체 lifecycle의 모든 조합은 수동 확인하지 않았다. queue 단위 검증과 코드상 context guard/cleanup을 적용했으며 남은 확인 사항으로 둔다.

## 시간 변동 조사

고정 커밋 `44fef72`의100개 EDIT/MOVE 각3회는 이전과 최종 문서·SVG paths가 동일했다. paced MOVE는 preview4회·경로400회로 그대로였다. 첫 비교의 경로 시간 중앙값은 EDIT49.4ms/MOVE177.3ms, 재측정은38.2ms/209.0ms로 변동했다. 이전 기록의36.9ms/163.1ms와 시간대가 달라 원인을 확정하지 않는다.

동일 코드의 입력 병합만 바꾸는 측정 전용 제어를 추가한다. `EZERD_PERF_FRAME_MODE=immediate`로 perf:build하면 queue를 즉시 적용하는 test-only 빌드를 dist-performance-immediate에 생성한다. 기본은 raf이며 일반 제품 빌드에는 이 변환이 없다. metadata.frameMode로 구분하고 별도4176 포트에서 같은 fixture·입력으로 교차 비교한다. 이 제어는 과거 코드를 완전히 재현한 빌드가 아니라 병합 여부만 분리한 실험이다.

## 고정 커밋 입력 검증

- `44fef72` dirty=false 빌드의100개 EDIT/MOVE 각각 준비1+반복3회에서 기존 `f775bf4`와 최종 문서·전체 SVG paths가 동일했다.300개 MOVE1회도 기존 결과와 동일했다. 실제 paced MOVE는100개 경로400회,300개 경로1,200회로 줄지 않았다.
- 300개 장면의 internal replay3회에서 wheel120개를 실제 listener에 전달해 moveViewport120회→applyCameraFrame1회, 문서 불변, 카메라 x=-120px, geometry0회를 확인했다. 이 결과는 native 입력 성능 측정이 아니다.
- `scripts/performance/browser-wheel-burst.mjs`로 burst 결과를 재검증할 수 있다. 결과는 `artifacts/performance/44fef72-browser/`, 시간 재측정은 `44fef72-repeat/`에 저장했다.

## 동일 코드 immediate/raf 대조

도구 커밋 `c35aa63`에서 동일 제품 코드의 immediate/raf 두 빌드를 생성했다.100개·컬럼10·locale ko·1440×900 조건이다. 초기 두 탭 비교 중 viewport가 달랐던 첫 실패와 추가 input 이벤트가 섞인3개 표본은 제외했다. 해당 기록은 `artifacts/performance/c35aa63-paired/`와 excluded-samples.json에 보존했다. 추가 입력 발생 원인은 확정하지 않았다.

탭 하나에서 같은 viewport로 immediate→raf→raf→immediate 순서로 다시 실행했다. 각 빌드 진입 후 준비1회·측정1회를 수행했고4개 모두 최종 문서·경로·입력 이벤트가 같았다. 경로 누적 시간은158.6 / 238.9 / 161.3 / 162.3ms였다. 높은 raf 표본에는 단일 경로59ms가 포함돼 있었으며 원인을 GC 등으로 단정하지 않고 그대로 보존했다. 이 표본을 제거해 속도 개선율을 만들지 않는다.

같은 코드의 wheel burst 제어에서는 아래 결과를 확인했다.

| 지표 | immediate | raf |
| --- | --- | --- |
| wheel 입력 | 120 | 120 |
| 카메라 상태 반영 | 120 | 1 |
| Canvas 렌더 | 1 | 1 |
| 전체 x 이동 | -120px | -120px |
| 문서 geometry 재계산 | 0 | 0 |

React도 동기 이벤트 묶음의 렌더를 병합하므로, 상태 반영120→1을 렌더120→1이나120배 속도 개선으로 표현하지 않는다. 입력 누락 방지·프레임당 상태 반영 제한은 검증했지만 paced drag 속도 개선과 시간 회귀 원인은 아직 판정 보류다. 한 번의 관계 계산 자체가 긴 문제는 여전히 남는다.

같은 탭 대조 원시 결과·summary·burst JSON·화면은 `artifacts/performance/c35aa63-single-tab/`에 저장했다. Git 제외 대상이며 증거 이미지는 frame-inputs.png다.

```powershell
# 임시 셸에서 immediate 제어 빌드 생성
$env:EZERD_PERF_FRAME_MODE = 'immediate'
pnpm perf:build
Remove-Item Env:EZERD_PERF_FRAME_MODE
pnpm perf:serve --outDir dist-performance-immediate --port 4176
```

기본 raf 빌드는 환경 변수 없이 perf:build/perf:serve를 사용한다. 비교 스크립트에 선택적인 크기 인수를 추가하여 `... BASELINE_DIR CANDIDATE_DIR 100`처럼 동일 크기만 명시적으로 비교할 수 있다.

## 최종 상태

프레임 입력 구현은 로컬 브랜치에 저장했다. 전체 lifecycle·권한 변경의 브라우저 자동화, 실제 입력 지연·GC/프레임 trace, paced drag의 통계적 속도 판정은 후속으로 남긴다. 이번 측정으로 이미 검증된 경로 최적화와 입력 병합 효과를 혼동하지 않는다. 테스트 탭·두 fixture 서버는 종료하며 원격 push는 수행하지 않는다.

최종 `pnpm check`는390개 통과·DB 관련25개 skip, 전체 타입·포맷·일반 빌드 통과다. 기본 raf·immediate 측정 전용 빌드도 성공했다.
