# C5 전체 물리 설계 DDL 내보내기 소비 연결

- 시작 `79ae574`. DB별 컴파일러와 실제 엔진 fixture를 서버의 일관된 프로젝트 snapshot 조회에 연결한다. source/native 형식·profile/revision/version/sequence·진단과 UTF-8 파일명을 결과로 반환한다.
- 공유 메뉴 순서는 프로젝트 JSON → DDL → PNG다. native 화면에도 공유 메뉴를 제공하며 typed draft/pending 및 저장 실패가 있을 때 내보내기를 차단한다. v1 editor는 autosave flush와 runtime pending/conflict/storage failure를 확인한 뒤 최신 서버 snapshot을 사용한다.
- v1 PostgreSQL은 검증된 기존 전체 프로젝트 exporter를 호환 경로로 유지한다. v1 MySQL/SQLite의 PG 타입을 재해석하지 않고 명시 업그레이드·복구 안내를 반환한다. native v2는 공통 readiness/engine 검증을 통과해야 하며 오류 시 파일을 다운로드하지 않는다.
- REST/MCP 같은 export 서비스를 사용한다. MCP는 읽기 도구이며 native 일반 쓰기와 구별한다. 반환되는 objectId/path 진단을 화면에 표시하고 확인 중 version/sequence/revision이 변하면 다운로드 전 재생성이 필요함을 알린다.
- native JSON REST의 웹/MCP 소비와 이후 native upgrade/고급 policy 활성화는 각각 다음 독립 단위로 연결한다. 이 단위는 SQL endpoint와 공유 메뉴의 실제 성공/오류/변경 보호·파일 검증을 수행한다.
