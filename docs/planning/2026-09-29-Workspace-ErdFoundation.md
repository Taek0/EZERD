# Workspace ERD 기본 설계 반영 계획

- 대상은 ezerd MCP 프로젝트의 기존 워크스페이스 초안이다. 실제 DB·API·MCP 구현은 변경하지 않는다.
- 사용자가 지정한 물리 이름 `workspace`, `user_workspaces`, 기존 객체 ID를 유지한다.
- workspace의 UUID/생성 시각 기본값, 수정 시각, active/archived 상태를 정의한다.
- user_workspaces에 (workspace_id, user_id) 복합 PK, owner/editor/viewer 역할 ENUM, 가입 시각을 추가한다. 기본 역할은 viewer다.
- projects.workspace_id는 필수 FK로 정의하며 공간당 프로젝트 1:N을 표현한다. 프로젝트가 남아 있는 공간 삭제는 RESTRICT로 제한한다.
- 기존 멤버 FK의 NO ACTION은 유지한다. 마지막 owner 보장과 updated_at 갱신은 애플리케이션 규칙임을 명시한다.
- workspace 화면에는 참조 안내를 추가하고, 전체 결합 화면의 기존 사용자·프로젝트 카드로 연결을 확인한다. 실제 관계와 도메인 관계를 설명하며 인덱스 제안은 모델이 지원하는 사용자 속성에 기록한다.
- 카드 내용 크기를 계산하고 영향을 받는 공유·개인 화면을 별도 MCP 버전으로 갱신한다. 기존 다른 배치는 보존하고 최소 40px 간격을 재검증한다.
- 저장 결과의 키·컬럼·관계·ENUM 및 모델/DDL 진단을 검증한 뒤 결과를 기록하고 커밋한다.
