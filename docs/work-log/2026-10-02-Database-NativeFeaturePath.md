# Native advanced feature full-path fixture 결과

## 완료 범위

33개 등록 feature의 DB별 지원 subset, PostgreSQL 6개 index method, default 9개, MySQL ON UPDATE/invisible index를 최종 77개 fixture로 구성했다. PostgreSQL 31개, MySQL 26개, SQLite 20개다. 동일 ID/builder를 준비 SQL과 실제 API에 사용하며, incompatible 옵션은 별도 프로젝트/engine 실행으로 분리한다.

담당 변경 파일은 다음 6개다. 기존 모델/registry/validation/service/AppModule/barrel을 수정하지 않았고 git add/commit 및 전체 check/build를 실행하지 않았다.

- `apps/server/scripts/native-feature-path-fixtures.ts`: 공통 ID, canonical candidate, MCP command, 실제 정책 readiness, engine smoke probe.
- `apps/server/scripts/verify-native-feature-path-ddl.ts`: prepared와 actual manifest를 구분하고 원문/hash/전체 집합을 확인한 뒤 3엔진에서 SQL 실행.
- `apps/server/test/native-feature-path-fixtures.test.ts`: 33 feature/지원 DB subset, 6 method, graph/shape/engine 오류/입력 불변 검증.
- `apps/server/test/native-feature-path.integration.test.ts`: actual AppModule REST/MCP 경로 77개와 부정 사례 6개.
- [계획](../planning/2026-10-02-Database-NativeFeaturePath.md).
- 이 작업 기록.

## 실제 API 경로

실제 로그인/workspace/project 생성 → REST native command로 기본 table/column prepare → 서버가 발급한 baseline → `POST /projects/:id/native-sync/operations` → 같은 요청 replay → 현재 원문/version/sequence 검증을 수행한다. 별도 프로젝트에는 인증된 MCP `apply_native_project_changes`로 같은 physical candidate를 적용하고 logical definition 편집도 보존한다. REST document-state와 MCP `get_project_document_state`를 대조하며 REST `GET /projects/:id/ddl` 및 MCP DDL export 결과를 각 프로젝트에서 비교한다.

새 candidate를 previous로 신뢰하거나 coverage를 주입하지 않는다. 미활성 dependency는 실제 rejected ACK/문서 불변을 검증하고, 활성화되면 같은 fixture의 accepted를 요구한다. 미설치 collation 및 예약 default 함수는 3DB 각각 부정 사례로 유지했다.

## 최종 검증과 출처

| 증거 | 결과 | 실행/확인 주체 |
| --- | --- | --- |
| targeted fixture unit | 78 PASS | 담당, 최신 registry에서 2026-10-02 19:51 재실행 |
| 네 코드/test 파일 targeted TypeScript | PASS | 담당, strict/noUncheckedIndexedAccess/exactOptionalPropertyTypes |
| prepared SQL 3엔진 | 77 PASS, missing 0 | 부모 실행, 담당 결과 및 현재 candidate 77개 일치 확인 |
| actual AppModule isolated REST/MCP | 83 PASS | 부모 실행 보고, 담당 manifest accepted 77 / blocked 0 / 파일 154개 확인 |
| actual REST/MCP SQL 3엔진 | 154 PASS, missing 0 | 부모 `--manifest` 절대 경로 실행 보고, 담당 결과 파일 확인 |

준비 SQL artifact는 `.data/native-feature-prepared/501cf437-1751-4bfc-aeaa-b63c35848a21/engine-result-postgresql-mysql-sqlite.json`이다. 현재 77개 candidate JSON이 이 artifact와 모두 일치한다. 담당의 초기 엔진 실행에서도 PG 31/MySQL 26개가 통과했다. 당시 SQLite NOCASE probe 실패는 실제 compiler의 COLLATE 누락이었고 부모가 `3c2be6e`에서 수정한 뒤 최종 77개를 재검증했다.

actual manifest는 `.data/native-feature-path/6a922889-3a6f-4786-a18e-4a554f2aa812/manifest.json`이다. `expectedCases=77`, `cases=77`, `accepted=77`, `blocked=0`, REST/MCP SQL 각 77개다. 같은 폴더의 `engine-result-postgresql-mysql-sqlite.json`은 source `actual-rest-mcp`, result `PASS`, checked 154개, missing 0을 기록한다. 준비 SQL 성공을 actual API 성공으로 계산하지 않았다.

83은 API 테스트 수(77 경로 + 6 부정 사례), 78은 fixture unit 수(77 candidate + 1 집합 검증), 154는 실제 SQL 실행 수(77 × REST/MCP)다. 현재 최종 수는 79가 아니다. GIST/SP-GiST INCLUDE 추가 2개는 최종 77개 집합에 없다. INCLUDE는 BTREE, identity는 byDefault, SRID는 4326, array는 builtin integer 2차원, ON UPDATE는 precision 0의 선택 사례를 검증한다. 이 사례들이 모든 옵션 조합을 검증했다고 주장하지 않는다.

SRID readiness gate와 direct-column geometry readiness 문제도 fixture가 탐지했으며 정책 수정은 부모가 담당했다. 담당 fixture는 오류를 숨기거나 생산 gate를 수정하지 않았다.

## 재현

공유 model/contracts/server build가 준비된 상태에서 실행한다. build는 부모 통합 소유다.

```powershell
pnpm exec vitest run apps/server/test/native-feature-path-fixtures.test.ts
$env:EZERD_NATIVE_FEATURE_REQUIRE_ALL = '1'
pnpm --filter @ezerd/server exec tsx scripts/test-isolated.ts apps/server/test/native-feature-path.integration.test.ts
Remove-Item Env:EZERD_NATIVE_FEATURE_REQUIRE_ALL
pnpm --filter @ezerd/server exec tsx scripts/verify-native-feature-path-ddl.ts --prepared
pnpm --filter @ezerd/server exec tsx scripts/verify-native-feature-path-ddl.ts --manifest D:/Code/EZERD/.data/native-feature-path/6a922889-3a6f-4786-a18e-4a554f2aa812/manifest.json
```

스크립트는 준비 SQL 대체를 금지하고 manifest/document/SQL SHA 및 compiler 출력, 누락/중복 case를 확인한다. PG transaction rollback, disposable MySQL QA database, 고정 SQLite 하한의 메모리 DB를 사용한다. full actual 모드에 `--partial`을 붙이지 않는다.

독립 fixture unit은 ready다. 새 등록 필요 사항은 없으며 전체 QA/registry commit은 부모 소유다.
