# Native advanced activation 전체 actual integration 회귀 계획

## 범위

기준 커밋은 advanced 활성화 `64bd831`과 후속 QA `fedc8a9`다. 부모가 준비한 stable model/contracts/server/web build를 재사용한다. 생산 원문/권한/검증/registry/gate 및 기존 runner를 수정하지 않는다. 담당 write set은 실패한 server integration 테스트와 이 계획/작업 기록뿐이다. git add/commit 및 중복 build는 하지 않는다.

`apps/server/test/*integration.test.ts` 전체 24개 중 workspace/workspace-domain/direct-table/project-gallery 네 파일은 `apps/server/scripts/test-workspaces.mjs`, 나머지 native/API/MCP/WS/legacy/transfer/history 등 20개는 기존 `apps/server/scripts/test-isolated.ts`로 실행한다. 각 runner는 localhost의 고유 QA DB를 생성/마이그레이션하고 종료 시 제거한다. Vitest workers를 4개로 제한하여 병렬 부하를 줄이며 skip/fixture isolation/ACK 기대값은 약화하지 않는다.

고유 `.data/native-actual-regression/<runId>/` 아래 원문 stdout 로그, JSON reporter 결과, 실행 파일/기준 commit manifest를 남긴다. native feature 경로는 `EZERD_NATIVE_FEATURE_REQUIRE_ALL=1`로 전체 accepted를 요구한다. 준비 SQL을 actual integration 성공으로 계산하지 않는다.

실패 시 활성화 전 false 기대값인지 실제 unsupported/invalid 조합인지 먼저 확인한다. valid new write 성공과 실제 invalid combination/legacy/ID reuse 차단을 분리하고 원문·권한·transaction·replay·budget·boundary 검증을 유지한다. 실제 production bug는 부모에게 원인/재현 파일을 보고하고 생산 코드 수정을 맡긴다. 수정 파일을 targeted format/typecheck하고 관련 isolated integration을 재검증한다. 완료 결과와 각 runner의 pass/fail/skip, 수정 사항 및 미완료는 `docs/work-log/2026-10-03-Database-NativeActualRegression.md`에 기록한다.
