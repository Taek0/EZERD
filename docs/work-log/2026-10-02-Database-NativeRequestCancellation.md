# Native 미확인 요청의 서버 취소 확정 구현 결과

- [확정 계획](../planning/2026-10-02-Database-NativeRequestCancellation.md)의 전용 marker 설계를 구현했다. 기준 HEAD `2a03939`. git add/commit은 하지 않았다. 공유 model/gate, MCP renderer/server, AppModule, contracts index와 web 파일은 수정하지 않았다.

## 변경 파일

1. `packages/contracts/src/native-cancellation.ts` 및 새 계약 테스트.
2. `apps/server/src/sync/native-cancellation.service.ts`, `native-cancellation.controller.ts`, `native-cancellation-record.ts`.
3. `apps/server/src/sync/native-sync.service.ts`: findReplay/apply/lookup의 기존 ledger가 없을 때 marker 조회.
4. `apps/server/src/workspace/native-upgrade.service.ts`: 기존 ledger가 없을 때 upgrade marker 조회.
5. `apps/server/src/sync/native-history.service.ts`: 기존 ledger가 없을 때 history marker/wrapper 조회.
6. `apps/server/src/db/schema.ts` 및 정상 db:generate 생성물 `apps/server/drizzle/0015_sloppy_groot.sql`, `meta/0015_snapshot.json`, `meta/_journal.json`.
7. 새 `apps/server/test/native-cancellation.integration.test.ts`와 이 결과 문서.

## 계약과 동작

- POST `/api/projects/:projectId/native-sync/cancel`은 session 인증 후 `{kind, request, sourceOperationId?}`를 받는다. kind는 `protocol-operation`, `native-command`, `native-upgrade`, `history-undo`, `history-restore`다. history source UUID는 필수이며 다른 kind에는 envelope source를 받지 않는다.
- 원본 request는 operation/group/client UUID + passthrough 최소 구조만 확인한다. upgrade는 operation/client UUID를 확인하고 groupId를 operationId로 서버에서 정한다. 최신 전체 요청 스키마로 읽을 수 없는 구형 요청도 취소할 수 있다. 원문 unknown 필드/문자열/특수 JSON 키를 보존해 fingerprint를 계산한다. 원문 UTF-8 JSON envelope 예산은 8,000,000 bytes로 baseline/candidate/diff 중복을 수용하며 비 JSON/순환값을 차단한다.
- fingerprint는 기존 구현과 동일하다: protocol의 request 원문, command의 `apply_native_project_changes` + route projectId + includeDocument 제외 body, upgrade의 `upgrade_project_document` + projectId + input, history의 `native-history.undo/restore` + projectId + sourceOperationId + input. command request에 projectId가 있으면 route와 일치해야 한다. includeDocument는 표시 옵션으로 제외하지만 그 외 의미 필드 및 UUID의 원문 대소문자도 해시에 유지한다.
- writable transaction의 read 확인 → ordinary ledger → marker → project UPDATE lock → read 재확인 → ledger/marker 재확인 → marker INSERT 순서다. 기존 ledger는 accepted/rejected 모두 우선한다. actor/fingerprint가 맞는 기존 ACK는 `{outcome:'recorded', result:raw protocol 1/2 ACK}`로 반환한다. 새 marker와 기존 marker는 `{outcome:'cancelled', result:raw native rejected ACK}`다.
- outcome별 strict contract의 custom raw 검증은 저장 ACK를 trim/default로 다시 쓰지 않는다. cancellation 증명은 `status:'rejected'`, `reason/reasonCode:'operation.cancelled'`, 빈 changedPaths, document 부재인 native ACK만 허용한다. marker helper는 저장 operation/group/actor 일치도 확인한다. PostgreSQL의 UUID 저장 대소문자 정규화와 ACK 원문은 구분하며, fingerprint 비교는 원문 그대로다.
- 취소와 재생은 설계 document, project version/sequence/revision/updatedAt, sync ledger, baseline, field versions, tombstones와 WS 이벤트를 모두 변경하지 않는다. ACK sequence와 nextBaseline.baseSequence는 잠근 현재 sequence이며 nextBaseline의 UUID는 baseline 테이블에 발급·저장하지 않는다. INTMAX에서도 증가하지 않는 취소 ACK를 안전하게 생성한다.
- v1 source를 포함한 upgrade 취소를 허용한다. cancellation marker는 v1/v2 sync stream/history에 추가되지 않는다. arbitrary client document/previous/legacy/retired ID를 쓰기 authority로 사용하거나 복원하는 로직도 없다.
- marker는 `native_request_cancellations`에 operationId 전역 PK, project cascade FK, actor, fingerprint, kind, client/group UUID, optional source UUID, result JSONB, sparse metadata, createdAt만 저장한다. 원본 큰 요청 body/document나 privileged claim은 저장하지 않는다. history metadata는 `{nativeHistory:{command, sourceOperationId, identityMap:[]}}`다. 같은 전역 operationId를 다른 project에서 재사용하는 cancellation은 409로 차단한다.
- marker는 project 수명 동안 유지되고 기존 7일 sync cleanup 대상이 아니다. project 삭제 때 FK cascade로 제거된다. 기존 baseline TTL은 marker 조회/late replay에 적용하지 않는다.
- 새 cancel REST의 다른 actor는 `native.cancellation-actor-mismatch` 403, 다른 fingerprint는 기존 `sync.replay-mismatch` 409다. 기존 NativeSync/Upgrade marker replay의 actor mismatch는 원래 409, History는 원래 `history.replay-actor-mismatch` 403을 유지한다. 미가입/read loss는 모든 경로에서 403이다. viewer/workspace archive/project archive에서 현재 read를 유지한 자기 요청만 취소·재생 가능하다.
- History의 늦은 요청은 source/command가 일치하는 stored marker metadata에서 기존 result wrapper를 구성한다. current baseline/source/document 검증 이전에 rejected ACK를 재생하고 identityMap은 비어 있다. ordinary candidate/복원/legacy 검증 정책은 변경하지 않았다.

## 검증

- 새 계약 **13개 통과**: `pnpm exec vitest run packages/contracts/src/native-cancellation.test.ts`.
- 새 취소 REST integration **55개 통과**: 아래 독립 모듈 환경으로 `pnpm --filter @ezerd/server exec tsx scripts/test-isolated.ts apps/server/test/native-cancellation.integration.test.ts`.
- 기존 history integration **36개 통과**: 같은 컴파일 출력의 실제 classes를 `NATIVE_HISTORY_TEST_DIR`로 지정해 기존 테스트를 실행했다. 기존 history 테스트 파일은 수정하지 않았다.
- main이 contracts index/AppModule 등록 및 emit을 완료한 뒤, 환경 변수 `NATIVE_CANCELLATION_TEST_DIR`를 제거한 기본 bootstrap으로 **actual AppModule 취소 56개 통과**를 확인했다. 같은 단위의 기존 history 회귀도 `NATIVE_HISTORY_TEST_DIR`를 제거한 **actual AppModule 36개 통과**로 확인했다. 두 실행은 각각 별도 disposable DB에서 정상 migration을 적용하고 실제 configureApplication/controller/provider를 사용했다.
- actual 취소 56개에는 own `__proto__` JSON 필드의 원문 fingerprint 회귀를 추가했다. 같은 요청은 취소 ACK를 재생하고, 해당 own 필드 값이 바뀐 요청은 cancel/late upgrade 모두 409로 차단한다. 현재 공개 model의 requestFingerprint 구현을 그대로 사용하며 모델 파일은 수정하지 않았다.
- 등록 전 독립 검증은 `apps/server/dist/native-cancellation-qa`의 ignored 임시 barrel/런타임 alias로 실제 기존 contract exports와 새 cancellation contract만 연결했다. 루트 strict/NodeNext/exact optional/noUncheckedIndexedAccess/decorator 옵션으로 담당 서비스/helper/새 테스트 및 필요한 의존 파일의 targeted noEmit/emit을 수행했다. 임시 barrel이나 이 모듈을 실제 AppModule 검증으로 계산하지 않는다. 이후 main 공개 contracts exports를 사용하는 동일 strict 옵션의 직접 파일 목록 targeted tsc noEmit도 통과했으며 이 최신 타입 검증에는 임시 barrel을 사용하지 않았다.
- integration은 `NATIVE_CANCELLATION_TEST_DIR=apps/server/dist/native-cancellation-qa/compiled/apps/server/src`일 때 실제 Database/Access/Session/Gateway/NativeSync/Upgrade/History/McpNativeDocument/Sync cleanup classes와 실제 컨트롤러를 구성한 독립 Module로 부팅한다. 환경 변수 없는 기본은 actual AppModule/configureApplication이며 main 등록·emit 이후 동일 테스트를 그대로 실행할 수 있다. 서비스/권한/model/gate mock은 사용하지 않았다. gateway는 실제 publish를 call-through spy로 관찰했다.
- 모든 테스트는 localhost의 disposable `ezerd_qa_*` DB와 정상 migration runner를 사용한다. actor/session/project는 격리 SQL fixture이며, 빈 PostgreSQL v1 문서는 실제 upgrade REST를 거쳐 native로 만든다. 일반 작업·history source는 실제 logical domain/note REST 작업으로 생성해 현재 gate를 조작하지 않는다.
- 다섯 kind 각각에서 cancel→late identical apply rejected / body 변경 409, accepted→cancel raw recorded 불변, concurrent cancel/apply의 한 outcome, 구형 request가 최신 검증 전에 취소·재생됨을 확인했다. 다섯 kind × viewer/workspace archive/project archive/both에서 read 허용·actor mismatch·outsider/read loss를 검증했다.
- sparse marker와 전 상태 불변, baseline UUID authority 거부, concurrent 동일 취소 한 marker, ledger 우선순위, v1 raw ACK/upgrade 취소, raw actor와 UUID 원문 보존, 전역 ID 충돌, INTMAX/원문 예산/인증, 삽입 실패 rollback, project row lock 대기 중 read loss 재확인을 검사했다.
- marker 생성일을 14일 전으로 두고 실제 SyncService.cleanupExpired를 실행해 ordinary ledger/baseline이 제거되어도 marker와 같은 결과 재생이 유지됨을 확인했다. project 삭제 뒤 marker cascade도 확인했다. 실제 WebSocket에 subscribe하고 cancellation operation 이벤트 부재 및 native-sync events의 stream/sequence 불변, lookup의 marker 원문 반환을 검사했다.
- `pnpm --filter @ezerd/server db:generate`로 생성한 migration은 isolated runner에서 실제 적용됐다. `pnpm --filter @ezerd/server exec drizzle-kit check --config drizzle.config.ts` 통과. 담당 TS targeted Prettier와 diff whitespace 검사 통과. generated migration/meta 및 docs는 루트 prettierignore대로 포맷하지 않았다.

## 메인 통합 요청과 ready 범위

- main이 contracts index의 `export * from './native-cancellation.js'` 등록 및 emit을 완료했다. 공개 계약은 nativeCancellationInputSchema/nativeCancellationResultSchema, NativeCancellationInput/Result, MAX_NATIVE_CANCELLATION_BYTES, NATIVE_CANCELLATION_REASON이다.
- main이 AppModule의 NativeCancellationService provider와 NativeCancellationController 등록 및 emit을 완료했다. 실제 기본 bootstrap 취소 56개/기존 history 36개로 등록을 검증했다. 서비스 의존성은 DatabaseService/WorkspaceAccessService 두 개이며 새로운 gateway 의존성은 없다. MCP cancel 도구/validated raw output 및 web pending 연결은 main 담당이다.
- 기존 DatabaseService.checkReady의 전체 migration readiness 목록에 `nativeRequestCancellations` 조회를 추가해야 한다. 이 파일은 추가 허용 write set에 없어 직접 수정하지 않았다.
- main은 migration/schema, helper, 기존 NativeSync/Upgrade/History의 작은 marker lookup hunk 및 새 계약/서비스/컨트롤러/테스트/이 문서를 같은 독립 unit으로 commit할 수 있다. main의 확정 planning 문서는 수정하지 않았다.
- 담당 backend 구현, 독립 QA 및 main 등록 후 actual AppModule REST QA는 ready다. MCP/web 경계 QA는 이 단위에서 수행하지 않았다. 전체 pnpm check/build와 git add/commit은 실행하지 않았고 다음 legacy import 단위도 시작하지 않았다.
