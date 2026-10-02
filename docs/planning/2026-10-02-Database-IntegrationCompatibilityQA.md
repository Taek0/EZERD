# DB 구현 중 전체 API/MCP 호환 QA 정리

- 시작 `fa5b5b7`, 작업 트리 깨끗함. native 개인 명령 검증을 확대하면서 확인한 전체 API/MCP 통합 실패 6건을 독립 단위로 해소한다.
- 기존 domain별 공유 note/route 기대값과 누락 global table placement는 현재 canonical 공유 캔버스의 명시 fixture로 갱신한다. 타입/ENUM/ID/참조/좌표 및 재생·독립 import 검증을 약화하지 않는다. 실제 normalize 함수를 expected 생성기로 호출하지 않는다.
- export project metadata의 databaseKind와 새 capabilities/versioned read 도구를 포함해 MCP 계약 기대값을 갱신한다. 단순 도구 수 갱신에 그치지 않고 새 조회 도구의 실제 결과를 확인한다.
- 기존 개인 route 누락 해결 뒤 드러난 import 후 get_project 실패는 MCP 응답을 먼저 확인하고 제품 오류와 fixture 오류를 구분한다. 실패 원인에 필요한 범위만 수정하고 원본/개인 상태·사용자 격리·v1 보호를 유지한다.
- 최종 빌드 완료 뒤 격리 PostgreSQL에서 API/MCP/versioned/autosync를 순차 실행한다. 전체 check·작업 기록·독립 커밋을 완료한다. native shared 저장/DDL/SQL 실행 완료로 간주하지 않는다.
