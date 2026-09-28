# MCP 범위별 조회와 응답 크기 개선 기록

## 범위별 조회

- 전체 문서를 반환하는 기존 `get_project`는 유지했다.
- `get_project_summary`는 프로젝트 버전·동기화 순서·객체 개수·화면과 도메인 목록만 반환한다.
- `list_tables`는 도메인·검색어 필터와 최대 100개 제한, ID 커서를 제공한다.
- `get_project_view`는 해당 화면에 실제 배치된 카드와 연결 관계·좌표를 반환한다. 결합 화면의 외부 참조 테이블도 화면 노드 기준으로 포함한다.
- `get_table_details`는 테이블 한 개의 컬럼·키·관계·연결 테이블 이름·배치·사용 ENUM을 반환한다.
- MCP 초기화 지침이 전체 조회 대신 범위별 조회를 안내하도록 바뀌었다.

검증: 서버 타입 검사 통과, MCP 범위별 조회 및 서버 도구 단위 테스트 2개 파일 5개 통과.

## 이력과 쓰기 결과

- `get_project_history`에 `limit`(기본 50, 최대 100), `nextSince` 커서와 `includeChanges`·`includeDocument`·`includeDeletionSnapshot` 옵션을 추가했다. 기본 응답은 변경 경로와 작업 메타데이터만 반환한다.
- 이력은 DB에서 최대 `limit + 1`건만 읽어 다음 페이지 존재를 판단한다. REST 이력 API는 유지했다.
- `apply_project_changes`, `undo_project_operation`, `restore_project_deletion`의 기본 MCP 결과에서 전체 설계 문서를 제외하고, `includeDocument: true`로 요청할 때만 포함한다.
- `includeDocument`는 문서 변경 서비스에 전달하기 전에 분리한다. 같은 `operationId`의 재요청에서 표시 옵션만 바뀌어도 지문과 작업자 검증은 동일하다.

검증: MCP 응답 투영 단위 테스트를 포함한 관련 4개 파일 10개 통과, 서버 타입 검사 통과. 격리 PostgreSQL을 사용하는 API·WebSocket·MCP 통합 테스트 3개 파일 23개 통과. MCP 통합 테스트에서 축소된 기본 결과, 전체 문서 옵션, 이력 페이지 커서를 확인했다.

전체 단위 테스트는 67개 파일 348개 통과(통합 전용 3개 파일 23개는 기본 실행에서 제외), 루트 타입 검사와 `pnpm format:check` 통과. `list_tables`의 ID 정렬과 커서 비교도 같은 문자 순서를 쓰도록 맞췄다.
