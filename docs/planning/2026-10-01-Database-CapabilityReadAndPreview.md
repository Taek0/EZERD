# C4a DB capability 조회와 카드 변경 preview

- 시작 HEAD: `ea3c883`, 작업 트리 깨끗함. [전체 명세](2026-10-01-Database-CapabilitySpecification.md) C4의 조회/빈 물리 설계 DB 변경 부분이다.
- DB/profile/revision과 문서 버전을 한 snapshot에서 읽어 REST 및 MCP `get_project_database_capabilities`로 반환한다. 타입/옵션·엔진 기능은 공통 model 카탈로그를 사용한다.
- 카탈로그 정의와 검증 완료/사용 가능 상태를 분리한다. 아직 native v2 저장·editor·DDL 전체 경로가 완성되지 않았으므로 모든 정의를 사용 가능으로 표시하지 않는다. 기존 v1 편집 API가 native 기능을 제공하는 것으로 오해하게 하지 않는다.
- 카드에서 DB가 변경되면 서버 preview를 먼저 읽어 물리 설계 변환 필요/보관 상태 등을 구체적으로 안내한다. 이름과 DB는 기존 잠긴 PATCH에서 원자적으로 적용하며 preview 뒤 변경은 최종 version 검사로 차단한다. 같은 DB의 이름 변경은 preview를 호출하지 않는다.
- 단위 모델/계약/MCP/HTTP 및 카드 요청 흐름을 검증하고 포맷·타입·빌드를 확인한다. 실제 브라우저 검증은 격리된 API/DB에서 진행한다. 기존 데이터, 개인 화면 및 선행 변경은 보존한다.
