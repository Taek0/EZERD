# 고스트 드롭 장면 준비·Worker·geometry 캐시 구현 결과

[구현 계획](../planning/2026-10-27-Canvas-GhostDragImplementationPlan.md)에 따라 기존 Native 장면 계산을 UI에서 분리했다. 이 기록은 순수 장면/라우팅 담당 범위다. UI와 브라우저 검증은 통합 작업 기록에서 별도로 다룬다.

- `native-canvas-scene.ts`는 기존 장면·단일/그룹 초안 도우미와 metrics WeakMap을 보존한다. `prepareNativeCanvasScene` 및 `prepareNativeCanvasPlacementScene`은 라우팅 없이 카드 크기·열 anchor·라우팅 입력만 준비한다. `completeNativeCanvasScene`은 현재 relation 객체와 metrics 공급자를 유지하며 준비된 geometry를 조립한다.
- Worker DTO는 bounds 배열 하나와 관계별 source/target 인덱스, labelWidth, lane, offset, bend, source/target anchor·waypoints만 담는다. 문서/React/관계별 장애물 배열을 전송하지 않는다.
- `native-ghost-routing.worker.ts`는 기존 일반 `relationGeometry`를 호출한다. 자동 관계선 정리 알고리즘을 호출하지 않는다. Worker 생성 코드는 순수 core와 분리하여 Worker 자신을 다시 번들링하는 의존성을 피한다. Worker 이름은 `native-ghost`다.
- 응답은 정확한 입력 JSON 키, 개수, 유한 좌표, 직교 points/path 일치, label/handle 및 입력 endpoint bounds를 검증한다. AbortSignal, 생성 중 취소, 제한 시간, Worker 오류, message decode 오류, postMessage 오류, 늦은 응답을 처리하고 생성된 Worker를 종료한다.
- 캐시는 마지막 geometry 한 건만 유지한다. 실제 bounds/순서·관계 인덱스·labelWidth·lane·offset·bend·anchor·waypoints를 정확하게 비교한다. layout ID/문서 참조는 geometry와 무관하므로 키에 포함하지 않는다. 단일/그룹 초안은 metrics와 캐시를 WeakMap으로 상속한다.

## 검증

집중 회귀 테스트 `native-canvas-scene.test.ts`, `native-ghost-routing.test.ts`, 기존 `NativeERDCanvas.test.ts` 합계 **49개 통과**, 웹 `tsc --noEmit` 통과. 일반 physical/logical 장면, metrics 유지, 문서 불변성, 캐시 적중/무효화·최신 한 건 제한, 정상/비정상 Worker 응답, 취소/시간 제한/오류 정리를 확인했다. 최종 전체 검사와 제품 빌드는 통합 담당 범위다.

기존 HEAD의 순수 장면 코드를 임시 reference로 추출하여 원본 장면, 단일 이동, 5개 이동을 새 DTO 계산 결과와 정확하게 비교했다. 비교 입력은 복제본만 읽었고 실제 문서와 main 서버를 변경하지 않았다. 임시 reference와 테스트는 검증 후 제거했다. 원시 결과(성능 워크트리 Git 제외 경로: artifacts/performance/2026-10-27-ghost-drag/scene-worker-parity.json)는 Git 제외 artifacts에 남겼다.

| 입력 | 장면 노드 | physical 관계 | 단일/5개 최종 장면 일치 | 동일 geometry의 새 layout ID ACK 캐시 | DTO JSON 크기 |
| --- | ---: | ---: | --- | --- | ---: |
| 저장 43테이블 | 58 | 61 | 통과 | 통과 | 23,851 bytes |
| version407 134테이블 | 160 | 238 | 통과 | 통과 | 59,455 bytes |

입력 SHA-256은 원시 결과에 기록했다. 노드 수에는 테이블 외 카드가 포함된다. 위 parity는 구조 복제 DTO를 기존 알고리즘으로 계산한 결과다. 실제 브라우저 Worker 실행, 포인터/페인트·ACK 통합 검증을 대체하지 않는다.

## 검토 한계

동일 geometry와 노드 순서를 유지한 layout ID 변경은 캐시를 재사용한다. 실제 reader-generated 배치의 ACK는 `ensureTableCanvasLayout`이 기존 raw 노드를 먼저 두고 누락된 preview를 다시 추가하면서 순서 또는 fallback 위치를 바꿀 수 있다. 그런 ACK는 geometry 입력 자체가 달라지므로 안전하게 무효화하며 동기 계산이 다시 실행될 수 있다. generated 카드의 저장 전 성공과 실제 정규화 ACK의 캐시 적중은 구분해야 한다.

UI 읽기 전용 검토에서는 Worker 완료까지 마지막 고스트를 유지하고 geometry 캐시 설치 후 최종 배치를 보존·저장하는 연결, ACK를 기다리지 않는 종료, 문서/권한/뷰/카메라 변경과 Escape·unmount 취소 경로를 확인했다.

## version407 메인 단계 분리 측정

실제 version407 복제 입력의 physical 관계 차수 내림차순 선택을 사용했다. 단일은 `workspaces`, 5개는 `workspaces`, `memberships`, `class-20261006-tbl_class_sessions`, `class-20261006-tbl_classes`, `mig20261021.public.commerce_recurring_subscriptions`다. 기존 계측과 동일하게 +240/+120 이동했고 선택별 준비 1회 후 5회 측정했다. 다른 벤치마크와 브라우저 활동이 없는 상태에서 기존 shared build와 Node v24.18.1/tsx를 사용했다.

| 단계별 중앙값 | 단일 | 5개 |
| --- | ---: | ---: |
| `prepareNativeCanvasPlacementScene` wall | 0.55ms | 0.54ms |
| 일반 `routeNativeScene` wall | 176.12ms | 477.35ms |
| 일반 routing process CPU | 187ms | 531ms |
| `completeNativeCanvasScene` + 캐시 설치 wall | 0.81ms | 1.12ms |
| 같은 metrics 공급자·캐시의 최종 `nativeCanvasScene` wall | 1.35ms | 1.83ms |
| prepare + complete + 최종 장면 합계 wall 중앙값 | 2.92ms | 3.31ms |

각 sample은 새 최신 1건 캐시를 사용했다. 최종 장면은 기본 장면과 **동일한 metrics 공급자**를 받고, 각 관계의 geometry가 별도 routing 결과와 **동일한 객체 포인터**임을 모두 확인했다. 따라서 cache-hit 최종 장면에서 geometry를 다시 계산하지 않았다. 조립 장면 및 최종 캐시 장면은 기존 HEAD의 원래 `nativeCanvasPlacementDraftScene` 결과와 모두 정확하게 일치했다.

routing 단계는 Node 안에서 일반 알고리즘을 별도로 실행한 CPU/wall 측정으로, Worker 계산 부분에 해당하는 비교다. 실제 Worker 시작·IPC·구조 복제·브라우저 render/paint·저장·ACK·전체 pointer release 시간을 포함하지 않는다. 구조 복제와 동등성 검증은 단계 시간 밖에서 수행했다. `process.cpuUsage`는 프로세스 CPU 집계이므로 wall과 다를 수 있으며, 짧은 메인 단계의 CPU가 0으로 기록되는 해상도 한계 때문에 해당 단계는 wall을 보고했다. 합계 중앙값은 sample별 합계를 먼저 계산한 값이다.

원시 sample·환경·선택 목록(성능 워크트리 Git 제외 경로: artifacts/performance/2026-10-27-ghost-drag/scene-worker-phase.json), 재현 runner(성능 워크트리 Git 제외 경로: artifacts/performance/2026-10-27-ghost-drag/scene-worker-phase.ts), 측정 시 기존 HEAD reference(성능 워크트리 Git 제외 경로: artifacts/performance/2026-10-27-ghost-drag/scene-worker-phase.reference.ts)를 Git 제외 artifacts에 보존했다. 워크트리 루트에서 재현 명령은 `pnpm.cmd --filter @ezerd/server exec tsx ../../artifacts/performance/2026-10-27-ghost-drag/scene-worker-phase.ts`다. 실제 generated ACK에서 geometry/노드 순서가 바뀌는 경우는 위 캐시 적중 결과에 포함하지 않으며, 앞 절의 안전한 캐시 무효화 조건이 그대로 적용된다.
