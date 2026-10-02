# Versioned native 프로젝트 전송 구현 결과

- 기준 HEAD: `0edbd16`. [계획](../planning/2026-10-02-Database-NativeTransfer.md)에 따라 담당 새 파일만 작성했다. 사용자 지시에 따라 git add/commit은 수행하지 않았다. 동시에 진행 중인 DDL/UI/MCP/공통 정책·index 수정은 이 단위의 변경에 포함하지 않는다.

## 변경 파일과 실제 동작

- `packages/contracts/src/native-transfer.ts`: versioned export envelope, 원본 source coordinates, v1/compact v2 구조 reader, import 요청/결과 계약. parser가 trim하기 전에 raw UTF-8 문서/전송 예산을 검사한다. compact reader도 원본 document ID/타입 문자열을 보존한다.
- `apps/server/src/workspace/native-transfer.service.ts`: WorkspaceAccessService의 기존 repeatable-read read-only 트랜잭션에서 권한과 프로젝트 행을 일관 조회한다. document-state와 동일하게 MVCC snapshot을 사용하며 READ ONLY에서 금지된 FOR UPDATE는 사용하지 않는다. sourceDocument와 preview를 구분하고 개인 상태를 조회·병합하지 않는다.
- `apps/server/src/workspace/native-transfer.controller.ts`: `GET /api/projects/:projectId/native-transfer`, `POST /api/projects/native-transfer/import`. 실제 session 인증 및 UUID 검증을 사용한다. 기존 API와 충돌하지 않는 독립 route다.
- `packages/contracts/src/native-transfer.test.ts`: 계약/원본/버전/context/private 필드/UTF-8 예산 테스트.
- `apps/server/test/native-transfer.integration.test.ts`: 기존 isolated runner로 임시 로컬 DB를 생성·마이그레이션하고 실제 production 클래스를 독립 Nest 모듈에 등록하여 REST 요청을 실행한다. 테스트는 `ezerd_qa_*` 로컬 DB만 허용하고 gate를 조작하지 않는다.

## 파일 형식과 복구 정책

- 새 export는 `format: ezerd-project`, `formatVersion: 2`, `exportedAt`, `project: {name,databaseKind,databaseProfileId}`, `source: {projectId,version,sequence,databaseRevision}`, `sourceDocument`, `native`를 반환한다. `native`는 document-state와 같은 available(document/migrationIssues/issues) 또는 unavailable(code) 분기다. 물리 tables/columns/keys/FK/enums/indexes/checks와 공유 canvas는 sourceDocument에 원문 그대로 보존한다.
- source metadata/클라이언트 diagnostics는 인증된 provenance가 아니다. native preview를 제출하면 서버가 source에서 다시 계산한 preview와 fingerprint를 비교한다. metadata를 이용해 임의 native 문서를 previous로 인정하지 않는다.
- v1 및 sourceDocument가 v1인 versioned envelope는 서버 migration이 candidate/previous를 함께 만든다. 새 프로젝트 ID와 전체 엔티티/node/참조 ID를 재발급하고, graph는 previous 예외와 관계없이 전·후 검사한다. 기존 MySQL/SQLite DB 표시, 타입/기본값/namespace legacy 원문을 보존한다.
- v2 source에는 previous를 부여하지 않는다. 현재 미검증 native 타입은 `type.not-implemented`, native legacy 신규 생성은 `legacy.source-not-trusted` 등의 공통 진단으로 422 차단한다. 기존 원본을 export하는 것은 허용한다.
- MySQL/SQLite v1의 legacy 타입 안에 enumId가 있으면 기존 remapper가 원문 증거를 보존하는 동안 참조 ID가 이전 값으로 남는다. 원문을 임의 수정하지 않고 remap 후 `project-transfer.graph-invalid` / `document.enum-not-found`로 차단한다. PostgreSQL v1 ENUM은 native enumId로 migration 후 정상 remap할 수 있으며 통합 테스트에서 확인했다.
- createProject 권한과 활성 workspace를 잠근 트랜잭션 안에서 확인한다. 새 프로젝트는 DB 기본값으로 active/version 0/sequence 0/revision 0이며 source counter/status/개인 상태/ledger는 복제하지 않는다. 프로젝트와 `project.imported` 감사 기록을 같은 트랜잭션으로 저장한다.
- 각 원본/preview/최종 remap 문서 1,500,000 UTF-8 bytes, 파일 전체 2,000,000 bytes를 검사한다. 원본과 preview의 중복 표현 때문에 개별 문서가 한도 이하여도 export 파일 전체가 2 MB를 넘으면 명시 422 진단을 반환한다.

## 검증

- 계약 테스트: `pnpm exec vitest run packages/contracts/src/native-transfer.test.ts` — 5개 통과.
- 격리 DB/REST: `pnpm --filter @ezerd/server exec tsx scripts/test-isolated.ts apps/server/test/native-transfer.integration.test.ts` — 최종 19개 통과. 담당 서비스/컨트롤러와 필요한 dependencies만 임시 `dist/native-transfer-qa/server`로 compile하고 `NATIVE_TRANSFER_TEST_DIR`로 지정했다.
- 최종 검증은 메인이 갱신한 실제 model/contracts public barrel·정책을 사용했다. 초기에 발생했던 native-editor-command runtime 로딩 오류는 최신 shared emit에서 해소됐고, 우회 export를 제거한 상태로 담당 TypeScript compile 및 격리 19개를 다시 통과했다. 실제 transfer 서비스·권한·session·DB 트랜잭션을 사용했고 gate/mock 정책 변경은 없다. 독립 Nest 모듈이므로 전체 AppModule 통합 통과로 계산하지 않는다.
- 담당 서비스/컨트롤러/통합 테스트/계약/계약 테스트에 `tsc --ignoreConfig --noEmit`과 루트와 같은 strict/NodeNext/decorator 옵션을 적용 — 통과. 전체 server typecheck 및 전체 pnpm check/build는 실행하지 않았다.
- 담당 TS 파일 targeted Prettier 적용/검사 — 통과. 문서 링크는 planning/work-log 상대 경로로 연결했다.
- 검증 범위: 세 DB v1 원본 export/복구 import, 빈 native v2 roundtrip, ID/소유권/ENUM/FK/layout/AST remap, literal/legacy 원문 보존, 개인 상태 격리, untrusted legacy/미검증 타입/위조 preview/context/graph 차단, role·session·active 상태, 실제 audit 실패 시 rollback, 동시 미commit DB 변경 중 MVCC snapshot 일관성, 문서·전송 예산과 UUID remap 증가량.

## 메인 통합 요청과 미완료

1. AppModule에 NativeTransferController와 NativeTransferService를 등록한다. 별도 helper 접근 변경은 필요 없다. WorkspaceAccessService 공개 runProject/runWorkspace와 기존 reader를 사용한다.
2. contracts index의 `export * from './native-transfer.js'`, model index의 `nativeReferenceProblems` 공개 export는 메인이 등록했고 최신 public barrel로 검증했다. 담당자가 기존 index/model 파일을 수정하지 않았다.
3. 기존 compact `nativeProjectTransferSchema`와 새로운 `versionedProjectTransferSchema`는 이름/형식이 다르다. 웹/MCP는 새 GET/POST와 `nativeTransferReadSchema`, `importNativeProjectSchema`, `nativeTransferImportResultSchema`를 소비해야 한다. 기존 workspace v1 import/export를 이 단위에서 변경하지 않았다.
4. 실제 AppModule 등록 상태의 통합 QA를 메인에서 수행한다. 독립 Nest 모듈 검증은 이를 대신하지 않는다.
5. native legacy 원본 전체 roundtrip의 쓰기 허가는 아직 없다. 검증된 provenance/명시 복구 계약 없이 풀지 않는다. MySQL/SQLite legacy ENUM 복구, 신규 physical native 타입/기능 활성화, MCP/web 소비 및 전체 DDL/엔진 실행 QA는 이 단위의 완료 범위 밖이다.

## 메인 실제 AppModule 통합

- NativeTransferController/Service와 public 계약·graph export를 등록했다. 통합 테스트의 기본 경로는 실제 AppModule/configureApplication을 사용하고 별도 compile 경로는 명시 `NATIVE_TRANSFER_TEST_DIR` 때만 유지한다.
- audit 실패 재현 trigger는 fixture workspace에만 영향을 주도록 제한해 병렬 API import QA와 충돌하지 않는다.
- 전체 `pnpm check` 1041개 통과/89개 건너뜀, 포맷·타입·빌드 통과. 최신 실제 AppModule versioned/API/transfer 61개 통과 및 앞 전체 API/MCP/autosync/versioned/transfer/DDL 72개 통과를 확인했다. MCP/web 소비 및 native legacy provenance 복구의 후속 제한은 유지한다.
