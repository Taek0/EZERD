# Native 제품 활성화와 최종 QA 계획

- 선행: native 타입/옵션/AST/키/인덱스/clipboard/이력/import/create 소비와 서버 최종 후보가 같은 정책을 사용하는 상태를 확인한다. engine evidence만으로 전체 feature usable를 올리지 않는다.
- 완료한 실제 fixture와 제품 경로를 이름으로 매핑한 coverage registry를 만들고, 검증한 항목만 editor/contracts/server/MCP/DDL/integration 경로를 공개한다. 미검증 parser/설치 의존 charset/collation/SRID/타 DB 변환은 제한을 유지한다. 엔진 allowed와 제품 usable를 한 판정으로 혼동하지 않는다.
- 활성화 후보 상태에서 세 DB 실제 create→물리 편집/타입·옵션·키·FK·식/인덱스→저장/ACK→MCP 조회·편집→전체 DDL 다운로드→엔진 DDL/값 동작을 검증한다. export는 domain/filter/private 화면과 독립적인 project whole physical design이다.
- 기존 v1 read/write·explicit upgrade·legacy repair/import/history/retired ID·same request replay, stale DB revision 및 권한 변경을 포함한 전체 HTTP/MCP/WS QA를 실행한다. actor/session·응답 유실·two-tab pending·storage 실패·draft 원문 보존과 실제 JSON/SQL 다운로드를 브라우저에서 확인한다.
- SQLite 지원 하한3.45 실행과 실제 사용 runtime 버전을 구분한다. MySQL 프로필은 검증한 InnoDB 환경·strict/charset를 SQL과 진단에 명시한다. C8 integer mapping은 실제 enabled 원자 apply/audit/rollback을 확인한다.
- 실패는 소비/정책을 보완하여 검증하고 전체 pnpm check 및 실제 통합 뒤 커밋한다. 마지막 진행 기록에 완료 범위/제한/증거를 정리하고 전체 완료 시에만 자동 이어가기를 종료한다.
