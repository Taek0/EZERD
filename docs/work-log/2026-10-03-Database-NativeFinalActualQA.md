# Native 최종 actual API 및 3엔진 QA

## 최종 결과

기준 source HEAD `e80999269af0658cf375aa9901c0d24d3ed7bf0f` (`e809992`)에서 요청한 **27파일 498 PASS / 0 FAIL / 0 SKIP**를 확인했다. normal 23파일은 480 PASS, workspace 4파일은 18 PASS다. 이번 actual 실행의 최신 77-case manifest는 accepted 77 / blocked 0이며 **REST/MCP export SQL 154개가 PostgreSQL/MySQL/SQLite에서 모두 PASS**다. source 변경, 신규 build, web build, 전체 pnpm check는 수행하지 않았다.

artifact root는 `.data/native-final-actual-qa/521c6982-fa7c-4d1f-bfcf-a31181c1d912/`다. `run.json`에 exact HEAD/27파일 목록/opt-in/worker 수, `normal.json` 및 `workspace.json`에 모든 assertion 결과, `normal.log`/`workspace.log`/`engine.log`에 원문 실행 출력을 보존했다. `summary.json`은 498개와 154 SQL/cleanup을 검증한 집계다.

## 실행 조건 및 준비 확인

- 부모가 준비한 public model/contracts/server/web dist를 재사용했다. 모든 server source `.ts`와 대응 dist `.js`의 존재/mtime를 비교하여 source보다 뒤처진 server dist가 없음을 확인했다. 추가 shared/server build도 필요하지 않았다.
- 실행 시작과 검증 종료에 HEAD가 e809992로 유지되었다. model index/literals, contracts index, server AppModule/native-sync 대표 dist 5개 hash를 API 실행 종료 후 기록하고 engine 검증 종료 후 동일함을 확인했다(`build-hashes.json`, `build-hashes-final.json`). 이를 전체 dist 파일을 사전 해시했다고 확대하지 않는다.
- 기존 `test-isolated.ts`로 normal 23파일을 실행했다. `EZERD_NATIVE_FEATURE_REQUIRE_ALL=1`, workers 4, actual latest public/compiled module을 사용했다.
- 기존 `test-workspaces.mjs`로 workspace/workspace-domain/direct-table/project-gallery 4파일을 실행했다. `EZERD_DIRECT_TABLE_DB_TEST=1`, workers 4를 명시해 direct-table도 skip 없이 실행했다.
- `.env`의 localhost 설정을 사용하되 각 runner가 생성한 고유 임시 QA DB만 integration target으로 사용했다. 개발 프로젝트 DB를 integration target으로 쓰지 않았다. 엔진 SQL verifier는 기존 localhost PG transaction rollback, 이름 검증된 MySQL disposable QA DB, SQLite memory DB를 사용했다.
- 기존 [제품 활성화 및 전체 QA 계획](../planning/2026-10-02-Database-NativeReadinessActivation.md)에 따른 최종 actual 회귀다. 하위 에이전트의 write set은 이 결과 문서와 own data 로그로 제한했고 기존 runner/test/source/생산 정책은 수정하지 않았다.

## 정확한 파일별 결과

| runner | 파일 | PASS | FAIL | SKIP |
| --- | --- | --- | --- | --- |
| normal | `api.integration.test.ts` | 14 | 0 | 0 |
| normal | `autosync.integration.test.ts` | 8 | 0 | 0 |
| normal | `mcp.integration.test.ts` | 5 | 0 | 0 |
| normal | `native-cancellation.integration.test.ts` | 56 | 0 | 0 |
| normal | `native-canvas-decoration.integration.test.ts` | 6 | 0 | 0 |
| normal | `native-catalog-path.integration.test.ts` | 3 | 0 | 0 |
| normal | `native-clipboard.integration.test.ts` | 7 | 0 | 0 |
| normal | `native-conversion-websocket.integration.test.ts` | 4 | 0 | 0 |
| normal | `native-ddl.integration.test.ts` | 1 | 0 | 0 |
| normal | `native-deferrable-patch.integration.test.ts` | 3 | 0 | 0 |
| normal | `native-expression-policy.integration.test.ts` | 1 | 0 | 0 |
| normal | `native-feature-path.integration.test.ts` | 83 | 0 | 0 |
| normal | `native-history.integration.test.ts` | 36 | 0 | 0 |
| normal | `native-option-policy.integration.test.ts` | 1 | 0 | 0 |
| normal | `native-postgres-bounded-literal.integration.test.ts` | 62 | 0 | 0 |
| normal | `native-project-create.integration.test.ts` | 13 | 0 | 0 |
| normal | `native-replay-access.integration.test.ts` | 21 | 0 | 0 |
| normal | `native-transfer-legacy.integration.test.ts` | 34 | 0 | 0 |
| normal | `native-transfer.integration.test.ts` | 22 | 0 | 0 |
| normal | `native-upgrade-replay.integration.test.ts` | 9 | 0 | 0 |
| normal | `native-xml-jsonpath.integration.test.ts` | 23 | 0 | 0 |
| normal | `project-database.integration.test.ts` | 25 | 0 | 0 |
| normal | `versioned-document.integration.test.ts` | 43 | 0 | 0 |
| workspace | `direct-table.integration.test.ts` | 3 | 0 | 0 |
| workspace | `project-gallery.integration.test.ts` | 2 | 0 | 0 |
| workspace | `workspace-domain.integration.test.ts` | 6 | 0 | 0 |
| workspace | `workspace.integration.test.ts` | 7 | 0 | 0 |
| normal 합계 | 23파일 | 480 | 0 | 0 |
| workspace 합계 | 4파일 | 18 | 0 | 0 |
| 전체 | 27파일 | 498 | 0 | 0 |

Vitest reporter의 모든 assertion status가 passed이고 numFailedTests/numPendingTests가 0임을 확인했다. skip을 성공에 합산하지 않았다. 실제 두 client WS DB 변환, bounded typed family, XML/jsonpath 새 경로도 이번 고정 27파일에 포함한다. 따라서 이전 24파일/409개 결과의 재인용이 아니다.

## 최신 77 manifest / SQL 154개 실제 실행

manifest는 `D:\Code\EZERD\.data\native-feature-path\a43a3dba-2085-40e5-a2b7-668bc963876c\manifest.json`다. `requireAllPositive=true`, expectedCases/cases 77, 모든 case accepted, 각 REST/MCP SQL 2개로 총 154개다. 해당 테스트는 정상 경로 77개와 음성 사례 6개로 총 83개다.

| 엔진 | 실행 SQL | 실제 버전 | 결과 |
| --- | --- | --- | --- |
| PostgreSQL | 62 (31 × REST/MCP) | 18.6 (Debian 18.6-1.pgdg13+2) | PASS |
| MySQL | 52 (26 × REST/MCP) | 8.4.11 | PASS |
| SQLite | 40 (20 × REST/MCP) | 3.45.0 | PASS |
| 전체 | 154 (77 × REST/MCP) | 지정 3엔진 | PASS |

기존 `verify-native-feature-path-ddl.ts --manifest <절대경로>`를 사용했다. `--prepared`, `--partial` 대체 없이 원본 document/hash/SQL/source/full manifest를 확인한 actual-rest-mcp 실행이다. engine 결과는 `D:\Code\EZERD\.data\native-feature-path\a43a3dba-2085-40e5-a2b7-668bc963876c\engine-result-postgresql-mysql-sqlite.json`이고 own artifact에 `engine-result.json`으로도 복사했다. result PASS, checked 154개 모두 unique, partial=false, missing=[]를 확인했다.

공용 MySQL container는 `ezerd-native-ddl-qa-20261002`, QA label은 기존 script가 요구하는 `ezerd.qa=native-ddl-20261002`다. SQLite CLI는 `.data/native-sqlite-345/sqlite3.exe`, 고정 source ID `2024-01-15 17:01:13 1066602b2b1976fe58b5150777cced894af17c803e068f5918390d6915b46e1d`를 그대로 검증했다. 154개는 엔진별 유효 subset의 합계이며 각 엔진에 154개씩 실행했다는 의미가 아니다.

normal 실행은 자체 XML/jsonpath 22 SQL artifact와 다른 bounded fixture 증거도 생성한다. 이 후속 요구의 별도 engine verifier 실행 범위는 최신 77 feature manifest의 154 SQL만이다. 그 밖의 엔진 script를 추가 실행했다고 주장하지 않는다.

## Cleanup 및 부모 인계

runner와 engine script가 고유 임시 DB/drop 또는 rollback finally cleanup을 완료했다. 종료 후 PostgreSQL `ezerd_qa_%` / `ezerd_workspace_test_%` / `ezerd_direct_table_test_%` 잔여 DB 0, `qa_native_feature_path` schema 0, MySQL `ezerd_feature_%` 임시 DB 0을 read-only로 확인했다. 증거는 `pg-cleanup.json`, `mysql-cleanup.json`이다. SQLite는 memory DB다.

공용 MySQL QA container와 SQLite CLI는 삭제하지 않았으며 부모 최종 cleanup 소유로 유지한다. 부모 3139 브라우저 및 전체 pnpm check 결과는 이 단위의 수행 결과에 합산하지 않았다. 최종 actual/엔진 scope는 완료되었고 실패·미완료·source 수정 요청은 없다. 문서 외 기존 수정/staged 내용은 부모 소유로 보존한다.

## 재현

```powershell
$qaRoot = 'D:/Code/EZERD/.data/native-final-actual-qa/521c6982-fa7c-4d1f-bfcf-a31181c1d912'
$qaRun = Get-Content "$qaRoot/run.json" -Raw | ConvertFrom-Json
$normalFiles = @($qaRun.normalFiles)
$workspaceFiles = @($qaRun.workspaceFiles)
$env:EZERD_NATIVE_FEATURE_REQUIRE_ALL = '1'
pnpm --filter @ezerd/server exec tsx scripts/test-isolated.ts @normalFiles --maxWorkers=4
Remove-Item Env:EZERD_NATIVE_FEATURE_REQUIRE_ALL
$env:EZERD_DIRECT_TABLE_DB_TEST = '1'
pnpm --filter @ezerd/server exec node scripts/test-workspaces.mjs @workspaceFiles --maxWorkers=4
Remove-Item Env:EZERD_DIRECT_TABLE_DB_TEST
pnpm --filter @ezerd/server exec tsx scripts/verify-native-feature-path-ddl.ts --manifest D:/Code/EZERD/.data/native-feature-path/a43a3dba-2085-40e5-a2b7-668bc963876c/manifest.json
```

사용자 권한 profile에 맞춰 승인된 QA 및 기록 명령은 require_escalated로 실행했다.

## 문서 commit 인계

문서 단독 commit을 허용받아 준비했으나, staging 전 HEAD guard에서 부모의 `ff93235 fix(web): explain native key and literal conditions` 변경을 감지하여 중단했다. 본 단위는 git add/commit을 수행하지 않았으며 이 문서는 미커밋 상태로 인계한다. 해당 부모 커밋은 web condition hints/UI 및 문서이고 이번 actual API/SQL 검증의 source 기준은 e809992로 유지한다. 부모의 새 web/browser/전체 check 결과까지 검증했다고 주장하지 않는다. 추가 QA나 source 변경은 수행하지 않는다.
