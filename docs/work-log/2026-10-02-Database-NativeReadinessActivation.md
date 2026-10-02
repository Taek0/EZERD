# Native 제품 활성화 진행 결과

- [계획](../planning/2026-10-02-Database-NativeReadinessActivation.md). 기본 선언은124개(PG64/MySQL37/SQLite23)와 table/column/schema/comments/MySQL value-list·character/SQLite STRICT 경로를 활성화 후보로 연결했다. deprecated txid_snapshot은 기존 데이터 보존용으로 남기고 신규 선택은 계속 차단한다. advanced23개 기능·default/ON UPDATE/parser 경로는 별도 증거·정책이 준비될 때까지 미검증이다.
- 실제 isolated AppModule catalog-path3개에서 새 프로젝트→native 각 builtin 저장·원문/테이블별 순서→ACK replay→인증 MCP 조회·patch→whole physical DDL과 capability 집합을 확인했다. PG C/POSIX와 MySQL 독립 latin1 column, native table/column comment도 실제 명령과 출력에 포함했다. default 경로의 선언 coverage 오인 활성화를 막는 서버 정책을 추가했다.
- 해당 실제 API 출력 SQL을 PostgreSQL rollback QA schema64컬럼/MySQL owned UUID DB37컬럼/SQLite3.45.0 :memory:23컬럼에서 실행했다. `verify-native-catalog-path-ddl.ts` PASS. 사용자 DB에 객체를 남기지 않았다.
- C8 signed16/32/64 PG↔MySQL 양방향6개의 실제 nonempty apply 및 post-write rollback6개를 포함한 service25개를 통과했다. source-map/audit·baseline·field versions·counter·원문/ID 및 role/replay 보호는 [결과](2026-10-02-Database-NativeConversionPositive.md)로 기록했다. latest parent catalog/conversion 실제2파일28개 재검증 통과.
- 실제 브라우저에서 native 물리 table/column 생성→TEXT에서INTEGER 변경→Share DDL→UTF8188-byte SQL 파일을 다운로드했다. 원본 복사 [SQL](assets/2026-10-02-Database-NativeDDLExportQA.sql), SHA256 `a9cef5f187fcb56f94b2d95b5db9df187e77982b40e206ea7be33252906f9e34`. 새 owned PG QA DB에 그 파일을 실행해INTEGER metadata 및 값7을 저장했다. JSON2732-byte 실제 다운로드도 확인했다. 다른 DB UI 및 전체 BrowserPathQA는 후속이다.
- 전체 pnpm format/check:2111개 통과/312개 조건부 통합 건너뜀, 전체 format/type/runtime/tools/build 통과. 이후 default/ON UPDATE 미검증 보호를 보강했으므로 최종 targeted/API 및 전체 QA를 추가로 기록한다. catalog flag는 호출자가 주입하지 못하는 공통 registry를 사용한다. 전체 C6/C7 및 최종 QA가 완료됐다는 의미가 아니다.

- 보강 뒤 전체 unit2124개 통과/312개 건너뜀. versioned/catalog46개와 C8/catalog28개, legacy/new transfer56개 실제 AppModule 검사도 통과했다. 과거 false 기본 타입 기대는 현재 primitive 허용과 malformed generation/default·미검증 고급 기능/legacy 출처 검사를 구분하도록 갱신했다. 기본값·ON UPDATE는 독립 readiness를 검사하여 서버에서 UI보다 먼저 허용되는 경로를 닫았다. 활성화된 기본 생성 폼은 사용 가능한 범위를 올바르게 안내한다.

- 최종 basic 활성화 실제 검증: catalog/C8/versioned/legacy transfer/general transfer5파일127개 전부 통과. 신규 기본 parser는 별도 defaultCoverage가 준비되기 전 막으며 broad legacy 복구/typed import·fresh malformed generation 거부·retired ID/replay/SQL 원문 경계를 확인했다. 독립 활성화 커밋에는 이 registry와 그에 따른 C8/기존 회귀 기대 갱신만 포함하고 private proof/PNG/진단 메시지는 제외한다.
