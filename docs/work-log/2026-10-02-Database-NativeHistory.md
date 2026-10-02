# Native ledger 이력·undo·삭제 restore 구현 결과

- [계획](../planning/2026-10-02-Database-NativeHistory.md), [명세 6.2 및 sync 원칙](../planning/2026-10-01-Database-CapabilitySpecification.md)에 따라 담당 새 파일 7개만 작성했다. 시작 시 HEAD는 `0edbd16`, 검증 중 메인 독립 DDL commit 후 HEAD는 `79ae574`였다. git add/commit은 하지 않았다.
- `native-sync.service.ts`, ordinary candidate/shared helper, model/validation/gate, AppModule/index/MCP/web는 수정하지 않았다. 진행 중인 메인/다른 agent 변경은 이 단위에 포함하지 않는다.

## 변경 파일과 API

- `packages/contracts/src/native-history.ts`, `native-history.test.ts`: strict history query/command/page/result 계약과 테스트. 클라이언트 before/document/previous/legacy claim/identityMap/deletionSnapshot/read-set은 입력으로 받지 않는다.
- `apps/server/src/sync/native-history.service.ts`, `native-history.controller.ts`: 실제 ledger 조회와 별도 trusted compensation 서비스.
- `apps/server/test/native-history.integration.test.ts`: 실제 production sync/upgrade/history/session/access/gateway 클래스로 구성한 독립 Nest REST 모듈 및 격리 로컬 PostgreSQL 검증.
- 계획 및 이 결과 문서: `docs/planning/2026-10-02-Database-NativeHistory.md`, `docs/work-log/2026-10-02-Database-NativeHistory.md`.

| 경로 | 동작 |
| --- | --- |
| GET `/api/projects/:projectId/native-history?since=0&limit=25` | sequence 오름차순 실제 ledger 페이지. limit 1~100, default 25. 현재 project version/sequence/DB/profile/revision 및 nextSince 반환 |
| POST `/api/projects/:projectId/native-history/:operationId/undo` | 같은 actor가 accepted native 작업의 전체 변경 bundle을 역연산 |
| POST `/api/projects/:projectId/native-history/:operationId/restore` | accepted 삭제 작업에서 삭제 객체·원래 배치 순서만 복원. source bundle의 무관한 scalar 수정/추가는 유지 |

- command body는 새 operationId/groupId/clientId, 서버 baselineId/발급 시각, expectedVersion/expectedSequence, database kind/profile 및 databaseRevision을 요구한다. `NativeSyncService.baseline`의 실제 발급 좌표를 사용한다.
- history page는 저장 result/changes/deletionSnapshot을 원문으로 제공하고 legacy/native/upgrade 형식을 표시한다. sourceDocument를 포함한 v1 upgrade audit를 자동 migration/덮어쓰기하지 않는다. read는 기존 runProject(read)의 read-only repeatable-read이며 row lock을 하지 않는다.

## 권한·출처·충돌 경계

- 보상 요청은 writable db.transaction 안에서 read 권한 확인 → 동일 actor/fingerprint ACK 조회 → project row FOR UPDATE/ACK 재확인 → 새 쓰기의 design 권한 확인 순서로 처리한다. read 권한이 남은 같은 actor는 project/workspace 보관 또는 viewer 역할 변경 후에도 동일 accepted ACK를 재생한다. 다른 actor 재생은 `history.replay-actor-mismatch` 403, read 권한 상실 및 새 쓰기의 design 권한 부족도 403이며 같은 actor의 fingerprint 변경은 기존 409를 유지한다. 새 쓰기에만 활성 project/context/revision/version/sequence 및 최신 native baseline 검사를 적용한다. history 조회의 read-only repeatable-read는 변경하지 않았다.
- source는 같은 project/actor의 accepted native ledger만 가능하다. result operation/group/actor/sequence/nextBaseline 좌표를 확인하고 source result 문서를 독립 저장된 서버 ACK baseline과 대조한다. ACK proof가 보존되지 않았으면 `history.source-provenance-invalid`로 차단한다. source 수명은 기존 이력과 같은 7일이며 새 요청 baseline은 24시간 및 현재 head에 한정한다.
- 서버가 source document와 inverseChanges로 before를 재구성하고 forward/derived fingerprint를 검사한다. v1 result와 document.upgraded 경계는 새 native 역연산 대상으로 사용하지 않는다. 기존 accepted v1/native sync의 재생 코드에는 변경이 없다.
- 원본 before/after/current의 서버 파생 structural read-set, layout 객체·관계 참조 의존성 및 edited paths를 field versions와 source sequence로 비교한다. 충돌하면 409이며 project/ledger/baseline을 바꾸지 않는다. 다른 사람의 무관한 새 메모나 source bundle 내 무관한 scalar는 유지된다.
- 삭제 snapshot은 accepted changes에서 계산한 값과 정확히 같아야 한다. 최신 tombstone의 원문/operation/sequence/수명과 field version을 대조하고 현재 원본 경로가 비어 있음을 확인한다. 같은 source를 새 operationId로 중복 compensation할 수 없다.
- 삭제된 엔티티/node에는 새 UUID를 부여하고 native remapper로 소유자·FK·ENUM·AST·index include·배치 참조를 갱신한다. 원본 retired entity/node ID는 계속 금지한다. 자체 ID가 없는 relation placement의 `(viewId,relationId)` virtual pair만 원문 snapshot+최신 tombstone으로 입증한 동일한 비어 있는 pair에 한해 전용 서비스에서 복원한다. ordinary native candidate의 retired pair 거부는 유지한다.
- previous의 기본은 locked current다. 복원되는 새 엔티티는 proven historical snapshot과 byte/fingerprint가 일치한 값만 보완한다. 삭제 planner가 참조 컬럼 삭제 때문에 both FK를 logical/physical null로 정리한 경우, undo는 정확한 stored physical/scope cleanup에만 제한된 이전 값을 보완한다. unrelated existing-object type/legacy 정상화를 되돌리는 예외는 없다.
- 추가로 remapped historical before와 복원 객체/입증한 FK 원인의 검증을 비교한다. 현재 문서의 새 이름 충돌 등을 과거 오류로 grandfather하지 않는다. candidate 전체를 previous로 넣지 않는다. graph와 raw canonical structure는 항상 검사한다.
- 구조/raw 문서 1,500,000 bytes, source/result changes 최대 1,000, DB policy 및 sequence/version PostgreSQL int 한도를 지킨다. unsafe legacy ENUM 원문 참조 remap은 변경하지 않고 명시 graph 진단으로 차단한다.
- accepted 변경만 project 문서/version/sequence, ledger, field versions, 신규 삭제 tombstone, 전용 native ACK baseline에 원자 저장하고 commit 뒤 gateway event를 발행한다. precondition/conflict/validation 거부는 HTTP 400/403/404/409/422이며 새 ledger sequence를 소비하지 않는다. 실 DB 저장 실패는 전체 rollback된다.
- 사용자별 project_personal_states를 조회·병합·변경하지 않는다.

## 검증 결과

- 계약 테스트 5개 통과: `pnpm exec vitest run packages/contracts/src/native-history.test.ts`.
- 격리 실제 REST/DB 35개 통과(기존 29개 + 권한 재생 회귀 6개): `pnpm --filter @ezerd/server exec tsx scripts/test-isolated.ts apps/server/test/native-history.integration.test.ts`. 담당자는 필요한 서비스/컨트롤러만 `dist/native-history-qa/server`로 targeted compile하고 `NATIVE_HISTORY_TEST_DIR`를 지정한 독립 모듈에서 35개를 확인했다. 이어서 메인이 부팅 기본값을 실제 AppModule/configureApplication로 전환하고, 등록된 서비스/컨트롤러가 있는 actual root AppModule 기준으로 같은 35개 모두 통과했다고 확인했다. 담당자는 부팅 블록을 수정하지 않았다. 임시 대체 contract export 없이 실제 model/contracts public barrel을 사용했다.
- 권한 회귀: undo/restore 각각 workspace archived, actor viewer, 두 조건 동시 적용에서 같은 actor·같은 요청의 ACK 201/본문 동일, fresh operationId 새 쓰기 403, viewer/editor 다른 actor 재생 403, outsider/read 권한 제거 후 재생 403, 같은 actor의 변경된 fingerprint 409를 확인했다. 거부·재생 모두 project/ledger/field versions/baseline/tombstone 불변을 확인했다.
- 테스트는 local `ezerd_qa_*` DB만 허용하고 runner가 DB 생성·마이그레이션·삭제한다. Nest injection token의 Vitest/native module 이중 로딩을 피하도록 compiled 클래스를 Node createRequire로 함께 로드한다. 실제 gateway와 DB permission/transaction 정책을 사용하고 gate를 mock/변경하지 않았다.
- 담당 service/controller/integration/contract/contract test에 루트와 같은 strict/NodeNext/decorator 옵션의 targeted `tsc --ignoreConfig --noEmit` — 통과. 담당 TS 파일 targeted Prettier — 통과. 전체 server typecheck/pnpm check/build는 수행하지 않았다.
- 확인 범위: 세 DB scalar undo/legacy 포함 삭제 tree restore, column 순서/escaping/FK/index/check/ENUM/generated AST/layout remap, original literal/label 보존, exact/concurrent replay 및 보관/context 변경 뒤 재생, 협업 edited field/reference read-set 충돌, 새 SQL 이름 충돌, current 기존 legacy 정상화의 재발급 거부, provenance/result/ACK/tombstone 훼손·만료, baseline actor/client/head/context, v1 upgrade raw audit/pagination/format boundary, 역할/보관/개인 격리, 용량·counter 한도, 실제 ledger insert 실패 rollback, ordinary retired ID/pair 및 arbitrary legacy 거부 유지, restore와 전체 bundle undo의 차이, 참조 컬럼 삭제의 proven FK cleanup undo.

## 메인 통합 필요 및 범위 제한

1. 메인이 AppModule에 NativeHistoryService/NativeHistoryController 등록 및 실제 AppModule/configureApplication 부팅 기본값 전환을 완료했고 대상 35개 통과를 확인했다. DatabaseService/WorkspaceAccessService/SessionService/SyncGateway는 기존 provider를 사용한다. 담당자는 AppModule 또는 부팅 블록을 수정하지 않았고 기존 helper 접근 변경도 필요 없다.
2. contracts index의 `export * from './native-history.js'`는 메인이 등록/emit했으며 마지막 targeted 검증이 실제 public export로 통과했다. model/ordinary candidate exports 추가는 필요 없다.
3. MCP/web에서 새 page/command/result 계약과 baseline 좌표를 소비한다. history(projectId,since,limit,user), compensate(projectId,sourceOperationId,undo|restore,raw,user)를 호출할 수 있다. 캐시 재생의 옛 ACK를 최신 설계나 새 baseline으로 자동 적용하지 않는다.
4. 대상 history 통합 35개는 실제 AppModule에서도 메인이 통과를 확인했다. 제품 전체 full QA·MCP/web UI·최종 commit은 메인 담당이며, 이 대상 테스트 통과를 제품 전체 QA 완료로 계산하지 않는다. 이번 재생 권한 수정은 ready이며 git add/commit은 수행하지 않았다.
5. v1/upgrade 경계를 넘는 restore, pruning된 ACK provenance, unsafe legacy ENUM remap, 다른 actor 작업 보상은 명시 차단한다. 이 범위를 별도 provenance/변환 설계 없이 풀지 않는다. ordinary legacy/retired ID 정책 및 usable gate에는 변경이 없다.
