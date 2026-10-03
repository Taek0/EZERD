# Native advanced activation 전체 actual integration 회귀 결과

## 결과

부모가 준비한 stable model/contracts/server/web build를 재사용하여 요청한 normal 20파일과 workspace 전용 4파일을 실제 localhost 격리 DB에서 실행했다. 최종 **24파일 409 PASS / 0 FAIL / 0 SKIP**다. 기준은 `fedc8a9`(advanced `64bd831` 포함)이며 [계획](../planning/2026-10-03-Database-NativeActualRegression.md)의 파일 집합을 고정한 뒤 검증했다.

| 실행 | 파일 | PASS | FAIL | SKIP | artifact |
| --- | --- | --- | --- | --- | --- |
| normal 최초 | 20 | 376 | 15 | 0 | `normal.json` / `normal.log` |
| 수정 세 파일 targeted | 3 | 68 | 1 | 0 | `targeted.json` / `targeted.log` |
| normal 최종 | 20 | 391 | 0 | 0 | `normal-final.json` / `normal-final.log` |
| workspace 최초 | 4 | 15 | 0 | 3 | `workspace.json` / `workspace.log` |
| workspace explicit direct-table opt-in 최종 | 4 | 18 | 0 | 0 | `workspace-full.json` / `workspace-full.log` |

artifact root는 `.data/native-actual-regression/e675c591-70c8-4d60-a187-301094ada460/`다. `run.json`에 기준 commit/정확한 두 runner 파일 집합/worker 수를 보존하고, `summary.json`에 최종 합계와 feature manifest를 기록했다. 각 JSON reporter의 assertion 상태로 실패/skip 0을 확인했다. 최초 workspace에서 skip된 direct-table은 별도 `EZERD_DIRECT_TABLE_DB_TEST=1`을 켜서 4파일 전체를 다시 실행했으며 skip을 성공으로 계산하지 않았다.

## 담당 수정과 보호 경계

생산 변경 없이 integration 기대값 세 파일만 수정했다.

- `apps/server/test/native-project-create.integration.test.ts`: 모든 capability가 false라는 활성화 전 기대값을 제거했다. 현재 모델 catalog와 실제 HTTP capabilities를 대조하고 기본 type/PK usable을 요구한다. deprecated type와 지원하지 않는 DB feature는 unusable이어야 한다. factory 원문/version/sequence/revision 0, 개인 state/ledger 없음, archive/viewer/ownership 보호를 유지한다.
- `apps/server/test/native-transfer.integration.test.ts`: 원문 export는 허용하지만 신규 index/CHECK가 unresolved legacy type을 사용하는 경우 expression 오류를 요구한다. import 중 fresh ID remap이 일어나므로 UUID를 원본 ID로 단정하지 않고 진단 collection 경로로 검증한다. 유효 PG PK/FK import는 fresh graph IDs/AST references/physical 원문/audit SHA와 초기 counter를 확인한다. 별도 새 FK type 불일치는 fake source coordinates와 빈 diagnostics에도 차단되어야 한다.
- `apps/server/test/native-transfer-legacy.integration.test.ts`: PG의 유효 standalone ENUM과 primitive/default import를 성공으로 구분하고 원문/audit/legacy mask 범위를 검증한다. MySQL/SQLite의 legacy ENUM context mismatch, PG 중복 ENUM label, NOT NULL + NULL default, 신규 legacy index/key 표현식 사용, generated/default 동시 설정 및 legacy target, STRICT legacy type, PK 없는 WITHOUT ROWID를 구체적인 현재 오류로 차단한다. Boolean CHECK 성공 뒤 비boolean CHECK 오류도 검증한다. source coordinate 공격은 현재도 미검증인 `txid_snapshot`으로 검증하며 검증된 integer와 standalone PG ENUM은 성공한다. arbitrary previous 주입은 계속 400이다.

불변 원문/token/label, provenance audit/sha, private 제외, 전체 document/transfer 예산, stale workspace lock 재확인, audit 실패 transaction rollback, same-actor/read 권한 replay, changed fingerprint/actor/read-loss 차단, retired-ID/신규 legacy 생성 금지, history restore 원본 입증 및 conflict/read-set 보호, v1 ledger/boundary 보호를 유지했다. feature activation을 fake previous/gate injection으로 대체하지 않았다. 최초 15개 실패는 activation 전 기대값에서 발생했으며 이번 검증에서 부모의 생산 수정이 필요한 버그는 발견되지 않았다.

## 현재 advanced 경로와 검증 조건

normal 전체 실행에 `EZERD_NATIVE_FEATURE_REQUIRE_ALL=1`을 사용했다. 최종 feature-path 83개 테스트가 통과하고 `D:\Code\EZERD\.data\native-feature-path\738761a8-0edc-4d09-b1c3-439c840ae1e2\manifest.json`에 77 accepted / 0 blocked, requireAllPositive=true를 기록했다. 각 사례의 실제 REST/MCP SQL 파일 154개가 생성되었다. 이번 단위는 actual integration 회귀이며 새 SQL artifact의 MySQL/SQLite 3-engine 실행까지 다시 했다고 주장하지 않는다. 각 native catalog/DDL/expression/option integration 자체가 요구하는 PostgreSQL 실제 실행은 포함한다. 이전 독립 154 SQL/3-engine 증거는 해당 feature-path 기록을 참조한다.

수정한 세 entry의 strict targeted TypeScript(noUncheckedIndexedAccess/exactOptionalPropertyTypes/decorators/NodeNext)와 담당 파일 Prettier/diff whitespace는 PASS다. 기존 runner를 수정하거나 전체 check/build, web build를 실행하지 않았다. 부모의 UI/validation 동시 작업은 보존했고 git add/commit하지 않았다.

실행 중 부모가 추가한 `apps/server/test/native-conversion-websocket.integration.test.ts`는 최초 요청의 normal 20파일 manifest에 없으며 이번 409개 합계에 포함하지 않았다. 부모 별도 진행 중인 unit의 검증 항목이다. 본인 요청 범위의 미완료/추가 등록 필요 사항은 없으며 ready다.

## 실행 파일

normal runner 파일:

- `apps/server/test/api.integration.test.ts`
- `apps/server/test/autosync.integration.test.ts`
- `apps/server/test/mcp.integration.test.ts`
- `apps/server/test/native-cancellation.integration.test.ts`
- `apps/server/test/native-canvas-decoration.integration.test.ts`
- `apps/server/test/native-catalog-path.integration.test.ts`
- `apps/server/test/native-clipboard.integration.test.ts`
- `apps/server/test/native-ddl.integration.test.ts`
- `apps/server/test/native-deferrable-patch.integration.test.ts`
- `apps/server/test/native-expression-policy.integration.test.ts`
- `apps/server/test/native-feature-path.integration.test.ts`
- `apps/server/test/native-history.integration.test.ts`
- `apps/server/test/native-option-policy.integration.test.ts`
- `apps/server/test/native-project-create.integration.test.ts`
- `apps/server/test/native-replay-access.integration.test.ts`
- `apps/server/test/native-transfer-legacy.integration.test.ts`
- `apps/server/test/native-transfer.integration.test.ts`
- `apps/server/test/native-upgrade-replay.integration.test.ts`
- `apps/server/test/project-database.integration.test.ts`
- `apps/server/test/versioned-document.integration.test.ts`

workspace runner 파일:

- `apps/server/test/direct-table.integration.test.ts`
- `apps/server/test/project-gallery.integration.test.ts`
- `apps/server/test/workspace-domain.integration.test.ts`
- `apps/server/test/workspace.integration.test.ts`

## 재현

부모의 공유 build가 준비된 저장소 루트 PowerShell에서 실행한다. 파일 목록은 고정 manifest를 사용한다.

```powershell
$regressionRoot = 'D:/Code/EZERD/.data/native-actual-regression/e675c591-70c8-4d60-a187-301094ada460'
$regressionManifest = Get-Content "$regressionRoot/run.json" -Raw | ConvertFrom-Json
$normalFiles = @($regressionManifest.normalFiles)
$workspaceFiles = @($regressionManifest.workspaceFiles)
$env:EZERD_NATIVE_FEATURE_REQUIRE_ALL = '1'
pnpm --filter @ezerd/server exec tsx scripts/test-isolated.ts @normalFiles --maxWorkers=4
Remove-Item Env:EZERD_NATIVE_FEATURE_REQUIRE_ALL
$env:EZERD_DIRECT_TABLE_DB_TEST = '1'
pnpm --filter @ezerd/server exec node scripts/test-workspaces.mjs @workspaceFiles --maxWorkers=4
Remove-Item Env:EZERD_DIRECT_TABLE_DB_TEST
```

runner가 만든 고유 QA DB의 migration 및 종료 cleanup을 재사용했다. 기존 개발 DB를 test target으로 쓰지 않았다. repository 권한 profile에 따라 담당 쓰기/검증 명령은 require_escalated로 실행했다.
