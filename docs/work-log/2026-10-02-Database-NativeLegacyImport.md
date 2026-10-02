# Native legacy import provenance와 ENUM 호환 구현 결과

- 기준 HEAD `aa22d10`. [계획](../planning/2026-10-02-Database-NativeLegacyImport.md)에 따라 구현했다. git add/commit, 전체 pnpm check/build는 하지 않았다. model/validation/index/gate, contracts, MCP/web는 수정하지 않았다. 사용자 추가 승인에 따라 기존 native-transfer.integration.test.ts의 두 정책 기대값도 교정했다.

## 변경 파일과 검토 지점

1. `apps/server/src/shared/native-import-provenance.ts`: nativeImportLegacyProvenance의 서버 v1 재현 마스크, validateNativeImportWithProvenance의 fresh/recovered 검증 대조와 정확한 허용 원인. 별도 공개 model/index export 없이 server-local helper로 사용한다.
2. `apps/server/src/workspace/native-transfer.service.ts`: source1/server migration 및 source2 canonical 분기, legacy enumId의 source ID 보존 여부, graph/shape/budget/검증, importProvenance audit.
3. `apps/server/src/sync/native-history.service.ts`: proven deletion snapshot의 freshMapping 직후 immutable ENUM origin 충돌 진단 및 기존 restore catch에서 해당 422 보존. 일반 candidate/retired ID 검증은 수정하지 않았다.
4. 새 `apps/server/test/native-import-provenance.test.ts`: 기본 Vitest discovery에 맞춘 helper 테스트 위치.
5. 새 `apps/server/test/native-transfer-legacy.integration.test.ts`: 실제 AppModule의 import/export/native sync/history REST 검증.
6. `apps/server/test/native-transfer.integration.test.ts`: 사용자 write set 확장 승인 후 기존 native feature 차단/rollback과 legacy ENUM 성공의 graph/원문/audit 기대값을 교정했다.
7. 계획과 이 결과 문서. 총 8파일의 독립 단위다.

## 출처 정책과 ID

- source1은 기존 서버 migration candidate/previous 예외를 유지한다. source2 전체 candidate를 previous로 지정하지 않는다. 최소 v1 표현으로 migration을 재실행해 실제로 재현되는 legacy type/default/namespace와 참조 ENUM 정의만 마스크로 사용한다. native type을 가진 column의 legacy default만 검증할 때는 native type authority를 만들지 않는 sentinel v1 type을 사용한다.
- Source coordinate/클라이언트 diagnostics/legacy 태그/previous 주장만으로 신뢰를 부여하지 않는다. 알려진 PG integer를 legacy로 숨기는 입력처럼 서버 migration 결과와 불일치하는 branch는 legacy.source-not-trusted로 차단한다. 이 provenance는 검증된 파일 내용의 복구 근거이며 과거 특정 서버가 내보냈다는 서명/인증 증명이 아니다.
- full fresh write 검증을 항상 계산하고 제한된 마스크의 recovered 검증과 합친다. unresolved/origin legacy 및 재현된 v1 기본 table/column/참조 ENUM의 정확한 원인만 허용한다. native typed readiness, generation/options, keys/FK/index/check, context, graph, 이름/값/식 오류는 fresh 결과에서 유지한다. 마스크가 같은 NUL comment/duplicate name을 갖더라도 해당 fresh 오류는 되살린다.
- MySQL 중앙 정책 연결 후 발생한 mysql.column-byte-budget-unverified는 proven legacy type의 정확한 path에서만 예외다. candidate와 server mask의 legacy type 원문, owner, generation, column/table options를 대조하며 모델의 recovered cause 검사도 유지한다. native 옵션·generation 변경의 byte 오류와 table 전체 column/row budget은 허용하지 않는다. 해당 중앙 정책이나 gate flags를 수정하지 않았다.
- legacy type.original.enumId가 있으면 새 project UUID 안에서 전체 source entity/node ID를 보존한다. matching ENUM definition ID, 원본 legacy JSON/token/labels, 공유 canvas와 모든 참조가 함께 유지된다. enumId가 없으면 기존 fresh UUID remap을 유지한다. 구조/중복/예약 ID와 graph는 remap 전후 모두 검사한다.
- 새 project의 ID/status/version/sequence/revision/ledger/baseline/tombstones/개인 state는 source에서 복제하지 않는다. source2는 shape parser의 canonical 값과 원문이 같아야 하며 불일치는 project-transfer.native-canonical-required로 명시 차단한다. 원본을 정규화해서 조용히 저장하지 않는다.
- createProject 권한/활성 workspace를 잠근 기존 transaction에서 새 프로젝트와 project.imported audit를 원자 생성한다. 원본/최종 document 1,500,000 bytes 및 transfer 2,000,000 bytes 한도를 유지한다. versioned native preview는 기존대로 서버가 다시 계산한 결과와 일치해야 한다.
- audit는 검증된 sourceDocument 전체, canonical-json-utf8 source/transfer SHA-256, source schema/context, 새 targetProjectId, mappingPolicy, identityMappingSha256, legacyMaskSha256 및 target trustedLegacyPaths를 저장한다. JSONB가 객체 키 순서를 바꿔도 해시를 검증할 수 있고 문자열의 공백/token/labels 변경은 구분한다. API가 파싱한 JSON 트리의 보존이며 업로드 파일의 들여쓰기/이스케이프 표기까지 보존한다고 주장하지 않는다.

## 이력 ENUM 경계

- 원래 matching ENUM이 live이면 삭제된 legacy column을 fresh column ID로 복원할 수 있다. legacy original.enumId/default 원문과 ENUM labels는 그대로다. 세 DB 컨텍스트에서 실제 native sync deletion→history restore로 검증했다.
- ENUM 정의까지 삭제되면 같은 프로젝트의 retired ENUM ID를 재사용할 수 없고, fresh ENUM ID로 immutable original.enumId를 덮어쓸 수도 없다. source/actor/ACK/baseline/field read-set/deletion snapshot/tombstone 증명을 마친 후 history.legacy-enum-origin-remap-required 422로 명시 차단한다. 기존 document.enum-not-found issue와 status 422 호환을 유지하고 실패 시 상태는 불변이다.
- 이 경우를 열려면 immutable origin enum ID→live definition ID의 별도 모델/계약과 trusted history 유래를 묶는 지원이 필요하다. graph/validator/remapper/DDL/transfer reader까지 일관되게 소비해야 하므로 이번 단위에서 추가하지 않았다. 새 project import의 ID 보존 정책을 ordinary clipboard나 동일 project restore에 적용하지 않았다.

## 검증

- helper **14개 통과**: pnpm exec vitest run apps/server/test/native-import-provenance.test.ts. 세 DB의 재현/불변, fake origin, native type/feature/generation/options gate, comment/이름 오류, changed refs/context, canonical hash 및 MySQL byte-budget 원인 범위를 검사했다. 1018개 전부 proven legacy column인 경우에도 whole-table column-count 오류를 유지한다.
- 새 actual AppModule isolated integration **27개 통과**: pnpm --filter @ezerd/server exec tsx scripts/test-isolated.ts apps/server/test/native-transfer-legacy.integration.test.ts. 세 DB v1 legacy ENUM→native2 안전 roundtrip, 새 namespace/원문/공유 canvas/hash/audit, 일반 fresh remap, private/counters 격리, typed/추가 native 기능/잘못된 refs/context/preview/source claim/명명/canonical 차단, UTF-8 예산, role/auth, 잠긴 workspace가 archive된 후 거부, audit 실패 rollback, 안전/unsafe 이력 복원을 검증했다.
- 기존 actual AppModule history **36개 통과**. 기존 history 테스트 파일은 수정하지 않았다. fresh restore의 기존 422를 유지하기 위해 새 진단의 UnprocessableEntityException을 restore catch에서 그대로 전달한다.
- 사용자 추가 승인 후 새 legacy와 기존 transfer 전체를 actual AppModule의 동일 isolated runner로 함께 실행하여 **46개 통과(27+19)**를 확인했다. 기존 feature 차단/rollback을 유지하고 ENUM 성공 사례의 matching graph, source 불변, 원문/canvas, 새 UUID/counters, audit source/sha/mappingPolicy 및 project/audit 각각 1 증가를 검사했다.
- main의 최신 MySQL 중앙 physical policy/public emit에 대해 helper와 새 integration을 다시 검증했다. 현재 Unicode fixture는 native mysql valueList가 아니라 PG v1 원문을 보존하는 legacy type + ENUM definition이다. 중앙 ci Unicode valueList 규칙은 native valueList 분기에 적용되며 이 원문을 bin 옵션 추가/labels 변경으로 고치지 않았다. native MySQL ENUM fixture를 실행하려면 명시 binary collation 조건이 별도로 필요하며 그것으로 gate를 활성화하지 않는다.
- 앱 저장 DB는 disposable local PostgreSQL이고 설계 DB 컨텍스트가 PostgreSQL/MySQL/SQLite다. 실제 3개 엔진 DDL 실행을 이 단위의 API 검증으로 계산하지 않는다.
- 실제 기존 AppModule/configureApplication에 이미 등록된 서비스를 사용했다. 담당 Transfer/History와 필요한 의존 파일만 기존 dist에 targeted emit했다. 임시 barrel/독립 모듈, 서비스·권한·gate mock 없이 실제 REST 세션/프로젝트/이력과 정상 isolated migration runner로 검사했다.
- 담당 helper/서비스/새 테스트에 루트 strict/NodeNext/decorator/exact optional/noUncheckedIndexedAccess 옵션의 targeted TypeScript noEmit/emit 통과. 담당 TS targeted Prettier 및 tracked diff whitespace 검사 통과. 문서는 루트 prettierignore대로 별도 관리한다.

## 메인 교정 요청과 ready 제한

- main 최종 재검증: helper14개 및 기존/new transfer·history actual AppModule3파일82개 전부 통과. 원본 ENUM 참조/namespace/audit 및 false readiness 거부 정책을 보존했다. 새 타입의 positive write/export 활성화 QA와는 별도 결과다.

- 새 AppModule/index 등록이나 model helper export는 필요 없다. helper는 기존 서비스가 직접 import한다. main은 위 8파일을 독립 commit할 수 있다.
- 기존 transfer 두 옛 기대값은 사용자 추가 승인 후 교정했다. 검증된 legacy에 blanket origin 오류를 요구하는 대신 native check/index의 feature.not-implemented와 원자 거부를 검사한다. v1 MySQL legacy ENUM은 201/새 namespace의 matching IDs·원문·audit를 검사한다. 최종 기존 19개 모두 통과했으므로 이 교정 요청은 남아 있지 않다.
- source2의 복구 허용은 재현된 legacy 기본 table/column/ENUM 범위다. unverified native keys/FK/index/check/generation/options가 섞인 파일은 현재 fresh 정책에 따라 계속 차단될 수 있다. 모든 과거 native 파일을 포괄 roundtrip한다고 주장하지 않는다. source1 기존 migration 예외는 유지한다.
- 담당 구현/helper 14개/actual transfer 46개/actual history 36개 및 targeted 타입·포맷 검증은 ready다. 안전하지 않은 deleted ENUM restore는 의도된 명시 차단 상태다. model gate/ordinary creation/clipboard/retired ID를 완화하지 않았고 MCP/web/새 복구 계약·엔진 readiness는 이번 단위에서 변경하지 않았다.
