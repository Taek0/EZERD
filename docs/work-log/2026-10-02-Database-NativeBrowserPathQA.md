# Native 실제 브라우저 경로 QA 진행

- [계획](../planning/2026-10-02-Database-NativeBrowserPathQA.md). 전용 UUID QA DB/Native QA workspace와 qa-native-owner/viewer PIN9042, loopback3139 실제 AppModule/web를 실행했다. 첫 pipe 실행은 stdin EOF로 자동 정리돼 PTY로 다시 실행했다. 사용자의 원본 DB는 변경하지 않았다.
- 실제 브라우저 로그인→갤러리 Native 기본 선택→PostgreSQL 프로젝트 생성→native 화면 진입 성공. 구조 편집으로 논리 고객 테이블을 생성하고 ACK 후 입력이 초기화됐다. 논리 모드에서 테이블과 ERD가 표시됐다.
- clipboard 선택→복사 summary/sourceProjectId/원문 수동 textarea→동일 원문 붙여넣기→새 UUID/name review→저장 ACK→논리 고객_copy를 확인했다. 입력은 matching ACK 이후 초기화됐다. OS clipboard 권한이 없어도 수동 경로를 사용할 수 있었다.
- main overflow:hidden으로 화면 밖 구조 summary 클릭이 실패했으며 `43c15ae`로 수정했다. 실제 main overflow:auto/clientHeight668/scrollHeight1401, 구조 폼 클릭/입력/저장을 확인했다.
- native logical-only DDL은 incomplete 진단/SQL download disabled를 확인했다. Share에 프로젝트 내보내기/DDL 메뉴가 나타난다. JSON 내보내기 클릭 후 오류는 없으나 Downloads에서 파일을 확인하지 못했으므로 실제 JSON 다운로드 성공으로 계산하지 않는다. explicit 다운로드 소비/브라우저 저장 기능 확인은 후속이다.
- 이후 활성화 후보의 native 전체 기본 타입 API/MCP 및3엔진 실제 SQL 실행은 별도 CatalogPath 검증이다. 최신 server/web 재시작 뒤 물리 편집/개인 상태·advanced/JSON/SQL 실제 파일·two-tab/actor/race 등 전체 QA를 이어간다. 이 문서는 전체 QA 완료 기록이 아니다.
