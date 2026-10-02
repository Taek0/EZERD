# Native REST/MCP ACK 재생 접근 권한 구현 결과

- 시작 HEAD `de644d4`. [계획](../planning/2026-10-02-Database-NativeReplayAccess.md)에 따라 진행했다. git add/commit은 하지 않았다. history 서비스, main mcp-server/history/versioned 테스트, model/gate는 수정하지 않았다.

## Replay 단위 변경 파일

1. `apps/server/src/sync/native-sync.service.ts`: writable transaction의 read 확인 → actor/fingerprint replay → current project UPDATE lock/replay 재확인 → 새 쓰기 design 확인 → 전체 입력 및 candidate 검증 순서. public findReplay도 read 권한을 사용한다. 기존 actor/fingerprint 불일치의 `sync.replay-mismatch` 409와 protocol mismatch 코드는 유지한다.
2. `apps/server/src/mcp/mcp-native-document.service.ts`: apply의 전체 명령 검증, baseline 발급 및 candidate 생성을 NativeSyncService.apply의 locked preparation callback으로 이동했다. 별도 replay 조회와 별도 baseline transaction 사이의 race를 제거했다. 명령 fingerprint 및 includeDocument 표시 규칙은 유지한다.
3. `apps/server/test/native-replay-access.integration.test.ts`: 새 actual AppModule/configureApplication isolated REST/MCP 회귀 테스트.
4. `apps/server/test/native-command-editor.test.ts`: Aristotle가 갱신한 기존 callback mock을 사용했다. 사용자 지시에 따라 이 변경은 Replay 단위의 main commit 대상으로 기록한다. 새로운 apply의 5번째 preparation callback과 optimistic 기대값/complete candidate 전달을 검사한다.
5. `docs/planning/2026-10-02-Database-NativeReplayAccess.md` 및 이 결과 문서.

- 같은 MCP service에 Domain 단위가 이미 추가한 helper import/metadata/renderer/batch claims 변경을 보존했다. Domain 논리를 Replay 소유 변경으로 계산하지 않는다. 사용자 지시에 따라 main은 당시 서비스 diff의 앞 renderer/domain hunk(대략 line <290)와 뒤 apply/replay hunk(대략 line >=290)를 분리 staging한다. 포맷으로 줄 번호가 달라질 수 있으므로 함수/변경 목적 기준으로 확인해야 한다.
- `native-editor-candidate.ts` 및 native-domain 모델/관련 계약·테스트는 Domain 단위다. 이 단위가 새 구현하거나 커밋하지 않았다. 현재 union/renderer에 대한 targeted typecheck는 통과했으며 exhaustive renderer 오류는 발생하지 않았다.

## 실제 동작과 보호

- 같은 actor가 read 권한을 유지하면 viewer로 변경되거나 workspace가 보관되어도 같은 요청 ACK를 재생한다. read 권한 상실/미가입 actor 및 새 쓰기의 design 권한 부족은 403이다. 다른 actor 또는 다른 fingerprint의 동일 operationId는 기존 409를 유지하며 권한을 넓혀 새 변경을 허용하지 않는다.
- replay는 full operation/command schema, 현재 document format/DB revision/head, baseline 조회·발급 및 candidate 생성보다 앞선다. 기존 writable db.transaction을 유지하고 read-only snapshot에 row lock을 추가하지 않았다.
- 저장 result의 구조를 safeParse로 확인한 뒤 원문 structuredClone을 반환한다. Zod의 trim/default로 과거 ACK를 다시 쓰지 않는다. 반복 응답은 문서·ledger·field versions·tombstones·baselines를 변경하거나 WS event를 새로 발행하지 않는다.
- MCP preparation은 project row lock과 fresh design 권한 확인 후 같은 tx에서 실행한다. 내부 issueBaseline helper는 기존 public baseline과 동일한 active 상태/expected version·sequence·revision/context/canonical raw 검증을 재사용한다. 반환 operationId를 replay identity와 대조하며 ordinary raw claims/retired IDs/legacy/engine 검증은 기존 prepareNativeSyncCandidate를 사용한다.
- fresh candidate 실패 시 내부 baseline INSERT도 함께 rollback된다. 동시 동일 요청은 row lock 이후 replay 재확인으로 하나의 ledger/ACK만 만든다. 기존 새 입력이 DB 정책으로 rejected 되는 native ledger 동작과 readiness gate는 변경하지 않았다.
- 최소 project/operation identity와 includeDocument 표시 입력은 기존처럼 ACK 조회 전 확인하고 전체 명령 schema는 조회 후에 검사한다. 임의 prepare callback은 REST/MCP 입력으로 받지 않으며 server code만 전달한다.

## 검증

- actual AppModule/configureApplication + disposable local PostgreSQL HTTP/MCP **21개 통과**: `pnpm --filter @ezerd/server exec tsx scripts/test-isolated.ts apps/server/test/native-replay-access.integration.test.ts`.
- 대상 두 서비스와 필요한 의존 파일만 TypeScript 파일 목록으로 `apps/server/dist`에 targeted emit한 후 기존 실제 AppModule을 부팅했다. 별도 fake 모듈/서비스/권한 mock 없이 session 및 MCP token을 실제 REST로 발급하고 실제 `apply_native_project_changes` SDK 호출을 실행했다. 마지막 실행은 보존한 Domain renderer 연결도 포함하는 최신 서비스 emit 기준이다. 전체 server build/check 또는 전체 제품 QA로 계산하지 않는다.
- 경로별 native operations REST / commands REST / 실제 MCP에서 viewer·workspace archive·동시 조건, 같은/다른 fingerprint, 다른 actor, read loss, fresh write, current format/context/head/baseline 변경 뒤 원래 ACK, 현재 runtime schema로 읽을 수 없는 역사적 요청 fixture, 동시 동일 요청, 전체 상태 불변을 검증했다. native REST 및 commands REST에서 저장 ACK의 trim되지 않은 원문도 확인했다.
- 역사적 요청 fixture는 accepted ledger의 stored fingerprint만 그 과거 요청으로 설정했다. gate/validator를 조작해 새 입력을 허용하지 않았으며 같은 obsolete 요청의 새 operationId는 400으로 거부했다. 새 프로젝트는 실제 create/upgrade 경로로 만들고 빈 native 설계의 논리 도메인/메모만 사용했다.
- MCP는 프로토콜상 isError로 도구 실패를 전달하므로, 실제 서버 audit의 `HTTP_403`/`HTTP_409` 등으로 내부 HttpException status를 확인했다. MCP transport 자체가 HTTP 403/409를 반환한 것으로 주장하지 않는다. 토큰/session auth 사용 기록은 의도된 부수 효과이며 project 관련 상태 불변 검사와 구분한다.
- 공통 QA 4개 파일 **36개 통과**: `packages/model/src/database/native-domain.test.ts`, `packages/contracts/src/native-editor-command.test.ts`, `apps/server/test/native-editor-candidate.test.ts`, `apps/server/test/native-command-editor.test.ts`. 이 중 기존 callback/renderer 회귀 6개는 Replay 소유 변경을 검증하며 Domain 전용 모델/helper/계약 테스트의 파일 소유권은 별도다.
- 담당 서비스 및 새 integration/callback mock에 루트 strict/NodeNext/decorator/exact optional 옵션의 targeted tsc noEmit 통과. SDK 1.30 Transport declaration의 기존 exact optional 차이는 기존 MCP 코드와 같은 narrow cast로 테스트에서 처리했다. 담당 TS 파일 Prettier 및 기존 변경 파일 git diff --check 통과.

## 메인 통합 안내 및 제한

- 메인은 Domain renderer를 `2c2edf9`로 분리한 뒤 replay 변경을 통합했다. MCP outer handler는 전체 계약을 검증하되 raw actor/document를 clone으로 반환하고 SDK output validation도 데이터를 재작성하지 않음을 로컬 SDK 코드에서 확인했다. raw actor 공백 원문을 REST/commands/MCP 모두에서 재생하는 실제 21개 suite가 통과했다.
- native history cached compensation도 검증 후 원문을 반환하도록 보완했다. actual AppModule history 36개와 MCP/기존 callback 12개가 통과했고 신규 history raw actor 회귀는 project/ledger/baseline/tombstone 불변을 확인했다. 업그레이드 서비스 자체의 replay permission/raw parse는 다음 독립 단위로 추적한다.

- 새 AppModule 등록/index export/DTO 변경은 필요 없다. main은 Replay service의 뒤 apply 부분과 NativeSyncService, 기존 callback mock, 새 integration 및 문서를 독립 commit하고 Domain renderer/helper/model 변경은 별도 단위로 분리한다.
- main 소유 `mcp-server.ts`의 apply_native_project_changes 반환은 현재 nativeSyncOperationResultSchema.parse로 tool output을 다시 파싱한다. 일반 canonical ACK의 실제 MCP 재생은 위 테스트에서 원문과 같지만, 비정규 과거 문자열이 들어 있는 저장 ACK는 이 바깥 output parser가 trim할 수 있다. 서비스 자체의 원문 clone은 완료됐으며 wire까지 모든 과거 raw 필드를 유지하려면 main이 해당 반환 지점을 검증만 하고 원래 값을 반환하도록 조정해야 한다. 이 서비스 단위에서 main 파일을 수정하지 않았다.
- history backend는 `de644d4`의 그대로 유지했다. 그 파일/기존 history 및 versioned tests와 다른 agent 작업은 변경하지 않았다. 현재 Replay 단위는 위 검증 및 wire parser 통합 항목을 포함해 main 리뷰 가능한 ready 상태다.
