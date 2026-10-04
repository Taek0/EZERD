# 활성화된 signed integer C8 변환 양성 검증 결과

2026-10-02. [계획](../planning/2026-10-02-Database-NativeConversionPositive.md). 변경 범위는 지정한 네 test 파일과 계획/이 기록이다. production/catalog/core activation은 부모 구현을 그대로 소비했다. git add/commit은 수행하지 않았다.

기존 false coverage 기대를 실제 activated coverage 소비로 갱신했다. immutable registry의 16/32/64 signed 정수는 PostgreSQL↔MySQL 양방향 usable/canApply=true를 확인하고, applied document/candidate·escaped object-ID sourceMap·fixture/rule ID·타입 왕복·원문/논리/개인 metadata 및 source 불변을 검사했다. planner 실행 전후 catalog deep equality를 확인하여 테스트가 coverage를 임의 승격하지 않도록 했다. SQLite/unsigned/aliases/array/installed collation/default/constraints 등 미검증 변환의 기존 거부 검증은 유지했다.

MySQL profile 환경 warning `mysql.environment-profile-assumed`는 positive plan/preview에도 남는다. 이를 오류가 없다는 이유로 숨기거나 모든 issues가 비었다고 기대하지 않는다. source/target 환경을 실제 검증하지 않은 임의 실행 DB로 확장하지 않았다.

실제 격리 localhost PostgreSQL DB에서 nonempty signed16/32/64 × PG→MySQL/MySQL→PG 성공6건 및 post-write rollback6건을 실행했다. 신규 핵심 조합은 총12건이다. 기존 빈 설계6방향, replay/role/concurrency/row-lock/no-op/v1 호환 등도 실행했다. native nonempty 테스트는 fixture 원문·ID·comments·logical/custom metadata와 audit.sourceDocument/sourceVersion/sourceSequence/sourceMap/changedPaths/engineVerified/from/to를 정확히 비교한다.

성공은 shared version7→8, sequence11→12, DB revision3→4를 한 번만 변경하고 project/document context를 함께 바꾼다. baseline 삭제와 새 baseline revision4/sequence12, 변경 path별 field version12/operation ID, polling reset의 실제 document, commit 이후 gateway.publishDatabaseContext 호출을 확인했다. 이 테스트의 WS 검증은 실제 service의 gateway publish boundary이며 WebSocket socket client 수신 자체를 실행한 것으로 주장하지 않는다. 같은 operation은 original ACK를 재생하고 doc/audit/counter/알림을 중복 변경하지 않는다. 기존 replay/role 변경 테스트를 nonempty integer 입력으로 전환하여 viewer/archived/lost read 권한 및 늦은 ACK를 검증했다.

rollback은 callback이 양성 changed result를 만든 뒤 post-write 예외를 주입한다. 계획 거부를 rollback 성공으로 오인하지 않는다. source/project 전체 row·ledger/audit count·baseline 전체 row·기존 field version 전체 row 및 원문 fixture를 전후 비교했고 WS publish가 없는지 검사했다. 실제 migration 포함 fresh UUID `ezerd_qa_*` DB를 scripts/test-isolated.ts로 만들고 finally DROP cleanup을 완료했다. 사용자 DB는 사용하지 않았다. 이 DB 검증은 conversion durable service transaction이며 MySQL DDL 실행 evidence는 이전 3폭 엔진 검증을 참조한다.

검증:

- model conversion-rules25 + conversion23 + server service16: **64 passed**, skip0.
- actual integration: **25 passed**, skip0, 위 성공6/rollback6 포함.
- server typecheck(src/tools) 및 두 server test의 strict 별도 typecheck 통과. model test 두 파일도 Node 타입을 포함한 strict 별도 typecheck 통과.
- model/web typecheck 및 지정 파일 root Prettier 통과. 전체 check/build/commit은 부모 범위다.

전용 재현: `pnpm --filter @ezerd/server exec tsx scripts/test-isolated.ts apps/server/test/project-database.integration.test.ts` (localhost 전용 UUID DB 생성/마이그레이션/제거).
