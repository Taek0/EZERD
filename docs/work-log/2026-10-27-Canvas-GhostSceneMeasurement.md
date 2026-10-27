# 고스트 드래그 실제 장면 계산 측정

작성일: 2026-10-27. [검증 계획](../planning/2026-10-27-Canvas-GhostDragValidationPlan.md)에 따른 Node/Vitest 검증이다. 제품 소스·실제 프로젝트·서버에는 쓰지 않았다.

## 결론

이동 중 장면 계산을 생략하고 최종 위치에서 한 번 계산하는 시뮬레이션은 동일한 최종 장면을 만들었다. 원본 134테이블의 20회 업데이트 누적 장면 시간 중앙값은 단일 3,678.16ms, 5개 그룹 6,361.30ms였고, 한 번의 최종 장면은 각각 182.04ms, 389.66ms였다. 238개 저장 경로를 적용한 메모리 복사본에서도 최종 한 번에 단일 65.02ms, 그룹 273.46ms가 남았다. 이동 중 계산 감소와 별개로 drop 동기 계산의 지연은 제품 통합에서 다뤄야 한다.

이 결과는 장면 함수의 하한 비교다. 실제 drop의 submittedNodes·낙관적 document 갱신·ACK로 생기는 추가 장면 계산, React 렌더·DOM·layout·paint·고스트 transform·저장 비용은 포함하지 않는다. 제품 통합에서 drop 장면이 반드시 1회라는 보장은 없다. 현행 배치 보존은 이동 중 로컬 상태/초안에 반영하고 서버 onSave는 pointerup에서 수행하므로, 이번 비교를 서버 저장 호출 감소로 해석하지 않는다. 브라우저 FPS는 측정하지 않았다.

## 입력과 방법

- 환경: Node v24.18.1, Windows, AMD Ryzen 9 7900X. 다른 에이전트의 집중 테스트 종료 후 CPU 측정 구간을 예약했으며, 부모 에이전트에 benchmark/build/typecheck 동시 실행을 피하도록 알렸다.
- 원본 43테이블은 `2026-10-14-actual-document/snapshot.json`의 `native.document`를 사용했다. 원시 관계 66개, physical 장면 관계 61개, 표시 노드 58개다. 저장된 table-view 관계 layout 66개 모두 비어 있지 않은 waypoints를 가진다.
- 원본 version 407은 `2026-10-21-relation-search/version407.json`을 그대로 읽었다. 원시 관계 245개, physical 장면 관계 238개, 표시 노드 160개다. 저장된 table-view 관계 layout은 66개, 비어 있지 않은 waypoints는 55개다. 저장 layout 수와 표시 관계 수는 같은 개념이 아니다.
- 보조 입력은 같은 version 407의 메모리 복사본에 이전 `optimized-routes-300000.json`의 238개 경로를 적용했다. 기존 offset을 보존하고 없으면 0으로 설정했다. 결과 table-view layout 238개, 비어 있지 않은 waypoints 213개다. 원본 파일·서버에는 기록하지 않았다.
- `nativeCanvasScene(document, '__tables__', 'physical')`로 실제 카드 크기와 행/포트 측정을 만들고, 그 장면의 캐시된 metrics를 실제 `nativeCanvasPlacementDraftScene` 경로에서 공유했다. 고정 가짜 카드 크기는 사용하지 않았다. 기본 장면 생성과 두 번의 최종 위치 워밍업은 본 측정에서 제외했다.
- 표시 관계의 접속 수가 높은 테이블을 결정적으로 정렬해 단일 1개와 그룹 5개를 선택했다. 모든 경우 workspaces가 첫 카드다. 정확한 선택·원래 좌표·측정된 폭/높이는 raw JSON에 있다. 이 표본은 고연결 카드의 사례이며 무작위 전체 분포가 아니다.
- 20개 위치 입력을 먼저 준비했다. 각 업데이트는 시작 위치에서 x +12, y +6만큼 누적 이동해 최종 +240/+120이다. 현행 비교는 각 위치마다 실제 장면 함수를 호출했다. 고스트 시뮬레이션은 이동 중 마지막 입력만 보관하고 release에서 같은 함수를 한 번 호출했다. 초안 문자열/JSON 준비는 시간에서 제외했다.
- 원본은 시나리오당 5회, 보조 입력은 3회 반복했다. baseline/ghost 실행 순서를 교대했다. 계측 없는 시간 측정과 relationGeometry spy를 넣은 1회 호출 수/CPU 귀속 측정을 별도 Vitest 프로세스로 실행했다.
- 아래 p95는 정렬된 표본의 nearest-rank이다. 드래그 합계/최종 drop 표본은 5개 또는 3개뿐이므로 p95가 최대값이며 정밀한 꼬리 지연 추정으로 보지 않는다.

## 드래그 누적 시간과 최종 drop

단위 ms. 현행은 20개 장면의 합계, 고스트는 최종 장면 1개의 시간이다. 이동 중 고스트 장면 호출은 0회다.

| 입력 / 선택 | 반복 | 현행 20회 합계 median / p95 | 고스트 drop 1회 median / p95 |
| --- | ---: | ---: | ---: |
| saved43 / 단일 | 5 | 91.28 / 116.58 | 6.98 / 10.31 |
| saved43 / 5개 그룹 | 5 | 423.25 / 428.24 | 17.22 / 17.33 |
| version407-134 / 단일 | 5 | 3678.16 / 3769.15 | 182.04 / 182.31 |
| version407-134 / 5개 그룹 | 5 | 6361.30 / 6475.85 | 389.66 / 432.01 |
| version407-134-arranged-copy / 단일 | 3 | 1191.42 / 1198.56 | 65.02 / 65.25 |
| version407-134-arranged-copy / 5개 그룹 | 3 | 4845.93 / 4849.23 | 273.46 / 275.61 |

개별 장면 표본의 통계도 보존했다. 고스트 총합은 전체 반복에서 계산한 최종 장면 시간의 합이다.

| 입력 / 선택 | 현행 장면 표본 수 | 현행 전체 합계 ms | 현행 장면 median ms | 현행 장면 p95 ms | 고스트 전체 합계 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| saved43 / 단일 | 100 | 489.19 | 3.29 | 9.73 | 37.69 |
| saved43 / 5개 그룹 | 100 | 2106.89 | 20.22 | 31.79 | 85.64 |
| version407-134 / 단일 | 100 | 18506.93 | 183.66 | 195.73 | 908.34 |
| version407-134 / 5개 그룹 | 100 | 31906.44 | 304.21 | 390.63 | 1977.14 |
| version407-134-arranged-copy / 단일 | 60 | 3552.79 | 62.72 | 67.50 | 191.55 |
| version407-134-arranged-copy / 5개 그룹 | 60 | 14540.58 | 270.67 | 280.55 | 816.49 |

기본 장면 첫 호출은 원본 43테이블 7.63ms, 원본 134테이블 213.95ms였다. 단 한 번의 준비 단계 측정이므로 평균이나 개선율로 사용하지 않는다.

## 관계 라우팅 별도 계측

계측한 한 드래그의 relationGeometry 호출 수는 정확히 표시 관계 수 × 장면 수였다. 원본 43테이블은 1,220→61회, 134테이블은 4,760→238회다. 따라서 현재 함수는 이동된 카드에 접한 관계만이 아니라 매 장면 전체 표시 관계를 처리한다. 이 호출 수 차이는 같은 장면 20→1회라는 실험 조건의 결과이며 FPS 개선율이 아니다.

| 입력 / 선택 | route 호출 수 현행→고스트 | route 동기 wall 합계 ms 현행→고스트 | route process CPU 합계 ms 현행→고스트 |
| --- | ---: | ---: | ---: |
| saved43 / 단일 | 1220 → 61 | 113.47 → 6.32 | 172.00 → 0.00 |
| saved43 / 5개 그룹 | 1220 → 61 | 428.91 → 17.90 | 452.00 → 15.00 |
| version407-134 / 단일 | 4760 → 238 | 3692.15 → 191.35 | 3891.00 → 219.00 |
| version407-134 / 5개 그룹 | 4760 → 238 | 6435.08 → 398.94 | 6469.00 → 407.00 |

route CPU는 각 호출 전후 `process.cpuUsage` 차이의 user+system 합이다. Windows 카운터 해상도, GC와 프로세스 전체 스레드 CPU, spy/카운터 오버헤드 때문에 짧은 호출에서 0ms도 나타난다. 정확한 스레드 프로파일이나 wall 비중 계산에는 사용할 수 없다. 이 계측 실행의 wall/CPU 값은 위의 계측 없는 타이밍 표와 섞지 않았다. raw JSON에는 시나리오 전체 process CPU도 별도로 남겼다.

## 최종 결과 동등성

각 반복에서 현행 마지막 장면과 고스트 최종 장면을 deep equality로 비교했다. 동일 최종 배치 document에 직접 `nativeCanvasScene`을 호출한 결과도 deep equality로 일치했다. 모든 선택 카드의 +240/+120 이동을 확인했다. 3회 Vitest 실행 모두 1개 테스트 통과이며, 원본 4개와 보조 2개 시나리오에서 검증했다.

baseline/ghost/direct의 JSON SHA-256도 각 경우 일치했다.

| 입력 / 선택 | 동일 최종 장면 SHA-256 |
| --- | --- |
| saved43 / 단일 | `b5fa5ea369a35c2c7e3d9c373176e300e88c859409ad5b04d1ee70c8ec968c7a` |
| saved43 / 5개 그룹 | `d7fb99f641c961dc003a8061ec9dfcf5e17e1bf5201127c1bb82d9219088d839` |
| version407-134 / 단일 | `59c34d9f16fc9f589343bada7948f6f52c7b36d801874a1f5b041b64f7a5732b` |
| version407-134 / 5개 그룹 | `1c944d754d61dba762e6da1d9e19082a981dcf27bc59ff26b50ca72bce912b9c` |
| version407-134-arranged-copy / 단일 | `f5e701dff2ac47096d192f2110bbd6cf83eb8375dde7044df5ded71dde8a00c4` |
| version407-134-arranged-copy / 5개 그룹 | `41e6053c6d5b14c7f177aeb78f1212f392fc4af60b73471676ba23f994ac76fe` |

원본과 보조 입력 파일의 SHA-256, 개별 장면 샘플과 반복 합계는 raw JSON에 포함된다. 이는 위치·치수·관계 geometry·label·viewId의 정확한 최종 결과 동등성 검증이며, 브라우저 상호작용 및 저장 경합 검증을 대신하지 않는다.

## 산출물과 재현

- [계측 없는 원본 결과](../../artifacts/performance/2026-10-27-ghost-drag/scene-timing.json), [별도 관계 계측](../../artifacts/performance/2026-10-27-ghost-drag/scene-routes.json), [저장 경로 보조 입력 결과](../../artifacts/performance/2026-10-27-ghost-drag/scene-arranged-timing.json).
- [재현 캡처 소스](../../artifacts/performance/2026-10-27-ghost-drag/scene-capture.test.ts), [원본 실행 로그](../../artifacts/performance/2026-10-27-ghost-drag/scene-timing.log), [관계 계측 로그](../../artifacts/performance/2026-10-27-ghost-drag/scene-routes.log), [보조 입력 로그](../../artifacts/performance/2026-10-27-ghost-drag/scene-arranged-timing.log).
- 재현 시 캡처 소스를 `apps/web/src/features/projects/ghost-scene-measure.capture.test.ts`로 복사한다. PowerShell에서 `$env:GHOST_MEASURE_MODE = 'timing'` / `'routes'` / `'arranged-timing'` 각각 설정한 뒤 `pnpm.cmd exec vitest run apps/web/src/features/projects/ghost-scene-measure.capture.test.ts --maxWorkers=1 --no-file-parallelism`를 실행한다. 실행 뒤 임시 테스트를 제거한다.
- 작업 종료 때 임시 테스트는 제거했다. 제품 소스 변경과 영구 중복 테스트는 남기지 않았고, 원시 결과·재현 소스·로그는 Git 제외된 artifacts에 남겼다. 문서의 커밋과 전체 검증은 부모 작업에서 담당한다.
