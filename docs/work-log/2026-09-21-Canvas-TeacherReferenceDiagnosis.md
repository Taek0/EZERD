# teacher 화면 외부 도메인 테이블 표시 진단

MCP 읽기 도구로 klassboard-backend 프로젝트의 문서·진단·변경 이력을 확인했다. 마지막 재조회 버전은23이며 teacher 화면의 외부 소유 테이블은 teacher_workspace_preferences 한 개다.

해당 테이블의 소유 도메인은 workspace지만 teacher와 workspace 양쪽에 배치가 존재한다. 2026-09-21 12:10:42 KST(순서5)에 teacher→workspace 소유권 변경과 workspace 배치 추가가 있었고, 기존 teacher 배치는 삭제되지 않았다. 12:14:03 KST(순서14)에는 남아 있는 teacher 배치가 이동됐다.

로컬 updateTable 구현은 소유권 변경시 기존 배치를 보존하고 새 소유 화면 배치를 생성한다. Canvas는 현재 viewId의 배치를 렌더링하므로 이전 소유 화면에서는 외부 참조로 보인다. 테이블 복제나 도메인 뷰 혼합이 원인이 아니다. MCP 구조 진단은 빈 결과였다.

원치 않는 표시라면 teacher 화면의 참조 배치만 제거하는 것이 적절하다. 테이블 삭제는 원본 컬럼·키·관계까지 제거하므로 사용하지 않는다. 이번 작업은 진단만 수행했고 프로젝트·DB·배치 데이터는 변경하지 않았다.
