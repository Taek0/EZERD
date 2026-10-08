# v1 서버 진입 폐기

- [계획](../planning/2026-10-07-Legacy-ServerRetirementPlan.md)의 첫 단위 완료.
- GET project, PUT document, POST operations/baseline/undo/restore, GET operation/events/history의 v1 REST 9개 경로는 인증 후 410과 document.legacy-api-retired 코드를 반환한다. 저장 서비스를 호출하지 않는다.
- MCP의 get_project, get_project_summary, list_tables, get_project_view, list_view_relations, get_table_details, diagnose_project, diagnose_layout, apply_project_changes, get_project_history, undo_project_operation, restore_project_deletion을 등록에서 제거했다. 지침은 Native 도구와 versioned 원본 조회로 갱신했다.
- 개인 상태 공통 mutate 경계에서 원본 v1의 신규 변경도 410으로 거부한다. 기존 동일 operation replay는 저장된 결과 반환 순서를 유지한다. Native 개인 상태와 파일 호환 기능은 유지한다.
- Native REST/MCP, 공통 WebSocket, 원본 document-state, capabilities, 파일 import/export/upgrade 및 프로젝트·리뷰 관리는 유지했다.
- 서버 타입 검사 통과. 메모리 MCP 테스트 7개와 실제 로컬 HTTP/개인 상태 경계 테스트 3개 통과. HTTP 테스트는 서비스 대역을 사용하며 사용자 DB에 접근하지 않는다.
- 기존 SyncService와 MCP 전용 구현의 의존성 제거 및 공통 만료 정리 분리는 다음 단위에서 수행한다.
