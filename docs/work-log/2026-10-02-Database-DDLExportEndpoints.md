# C5 DDL REST/MCP·공유 메뉴·다운로드

- 계획: [DDLExportEndpoints](../planning/2026-10-02-Database-DDLExportEndpoints.md). 서버의 동일 MVCC snapshot에서 DB/profile/revision/version/sequence·전체 물리 SQL·진단과 UTF-8 파일명을 반환한다.
- `GET /projects/:id/ddl`과 MCP `export_project_ddl`은 같은 readonly 서비스를 사용한다. v1 PostgreSQL은 기존 검증 exporter의 전체 설계 호환 경로, native v2는 readiness를 포함한 공통 정책, v1 MySQL/SQLite는 형식 업그레이드·복구가 필요하다. 실패 결과는 SQL 공백이다.
- 기존 공유 메뉴 순서를 JSON → DDL → PNG로 연결했다. native 화면에는 JSON/DDL 메뉴를 연결했고 native PNG는 후속이다. 서버 상태와 browser own user/project pending·draft·storage failure를 확인한다. SQL 다운로드 직전에 서버 version/sequence/profile/revision을 다시 조회하며 변경 시 재생성을 요구한다.
- 기본/구조 form의 dirty 및 storage failure는 actor/project별 memory hook으로 전달한다. persisted native shared/personal pending과 입력도 검사한다. 입력을 저장하거나 되돌리기 전 공유 내보내기를 차단한다. 미지원 개인 camera의 단순 zoom/pan은 물리 export 차단 원인으로 삼지 않는다.
- 오류 창은 객체 이름과 진단으로 편집 위치를 안내한다. 실제 브라우저에서 native 화면과 DDL 창의 React key가 같은 프로젝트 ID여서 poll/render마다 화면이 중복되는 버그를 발견해 DDL key에 prefix/actor를 포함했다. 수정 후 native 창을 반복 열고 닫아 main 1개를 확인했다.
- 최종 전체 `pnpm check`: 포맷/타입/빌드 통과, 1443개 통과/139개 DB 통합 건너뜀. 기존 Vite 번들 경고 유지. DDL frontend/MCP 단위 11개, 실제 versioned/MCP/DB change 통합 49개 통과를 확인했다. QA suite는 actor token을 재사용해 제품의 토큰 발급 제한을 변경하지 않는다.
- 실제 브라우저에서 화면 필터가 모든 테이블을 숨긴 상태에서도 DDL 메뉴가 활성화되고 SQL에 전체 parent/child 2개·FK 1개가 한 번씩 포함됨을 확인했다. [화면](assets/2026-10-02-Database-DDLExportQA.png), [실제 다운로드 SQL](assets/2026-10-02-Database-DDLExportQA.sql).
- 내려받은 475바이트 파일을 UTF-8 fatal decoder로 읽고 전용 QA DB에서 실제 CREATE TABLE/FK를 실행한 뒤 ROLLBACK했다. 브라우저 download event는 timeout을 반환했으나 지정 파일이 실제 Downloads에 생성되어 내용·생성 시각·DB 실행으로 확인했다.
- SQL 생성 후 QA source version/sequence가 변경되면 다운로드가 차단되고 새 SQL 만들기로 최신 version 2를 표시했다. native MySQL의 미해결 namespace/type/readiness 오류는 다운로드 버튼을 비활성화했다. [차단 화면](assets/2026-10-02-Database-NativeDDLBlockedQA.png). 기본 설명의 미저장 입력 시 공유 비활성, 원래 값으로 복구 시 활성도 확인했다.
- 임시 웹 QA 서버·전용 DB·harness를 정리했다. 사용자 Downloads에 생성한 테스트 SQL은 작업 기록으로 복사했고 사용자 폴더를 임의 정리하지 않았다. native JSON 메뉴를 호출했지만 해당 JSON 파일의 실제 생성은 이 QA에서 확인되지 않았으므로 후속 versioned web transfer QA에서 재확인한다.

native v2 타입/기능 usable gate는 아직 false이며 세 DB의 native 성공 다운로드·고급 옵션 전체 실행·native PNG 및 JSON import/history/clipboard/DB 물리 변환의 완성은 후속이다. 현재 결과를 전체 명세 완료로 계산하지 않는다.
