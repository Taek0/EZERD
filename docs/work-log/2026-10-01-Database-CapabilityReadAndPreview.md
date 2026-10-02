# C4a capability 조회와 카드 변경 preview 결과

- 기준: [계획](../planning/2026-10-01-Database-CapabilityReadAndPreview.md), 시작 HEAD `ea3c883`.
- model의 공통 native 카탈로그에서 현재 DB 타입 ID·SQL명·별칭·파라미터·array/STRICT/affinity 조건과 엔진 기능 정의를 계산한다. profile/revision, 대상 버전, 환경 전제와 documentSchemaVersion을 함께 반환한다.
- `GET /api/projects/:id/database/capabilities`와 MCP `get_project_database_capabilities`가 같은 계약/서버 snapshot을 사용한다. read 권한을 요구하며 MCP 결과는 호출 사용자의 프로젝트 접근 경로로 읽는다.
- `supportedByEngine`과 `usable`을 분리한다. 기능은 객체 조건 재검증이 필요하다. v1 문서 및 검증 evidence가 없는 항목은 native 사용 가능으로 표시하지 않는다. 모든 native 정의는 현재 `specified`이며 활성화하지 않았다.
- 카드 DB 변경은 서버 preview 후 기존 원자적 PATCH를 수행한다. 물리 설계/보관 차단 이유를 한국어/영어로 안내한다. 프로젝트 ID/version/revision/현재·대상 DB가 다르면 변경을 진행하지 않는다. preview 이후의 변경도 PATCH version 검사로 차단한다. 같은 DB의 이름 변경은 preview를 생략한다.

## 검증

- `pnpm check`: 포맷/전체 타입/전체 테스트/전체 빌드 통과. **710개 통과, 44개 건너뜀**.
- DB별 카탈로그/사용 가능 상태 3개, 카드 preview 흐름 3개, MCP tools 등록/structured 결과/actor 경로를 검증했다.
- 격리된 PostgreSQL에서 마이그레이션과 autosync **8개 통합 테스트 통과**. 새 HTTP capabilities 결과의 profile/revision/엔진 타입 필터와 무인증 거부도 검사했다.
- Browser 스킬로 별도 임시 DB·로컬 API의 빌드 화면을 확인했다. 빈 프로젝트의 PostgreSQL→MySQL은 저장되어 카드 DB 표기가 갱신됐다. 테이블이 있는 프로젝트의 SQLite 변경은 변환 필요 안내가 나왔고, 취소 후 PostgreSQL 표기/테이블이 유지됐다. 브라우저 error 로그는 없었다. 검증 계정/프로젝트는 임시 환경에만 생성했다.
- [검증 화면](assets/2026-10-01-Database-PreviewQA.jpg): 왼쪽 빈 설계는 MySQL 변경 완료, 오른쪽 물리 설계는 PostgreSQL 유지.

## 남은 범위

이번 단위는 C4 전체 완료가 아니다. native 편집·sync/import/clipboard/이력 소비와 실제 v2 저장, DDL 및 고급 기능 활성화는 남아 있다. 이전 결과에 기록한 기존 API/MCP 통합 실패 5건도 전체 QA 전에 해소해야 한다. 전체 명세 구현은 미완료다.
