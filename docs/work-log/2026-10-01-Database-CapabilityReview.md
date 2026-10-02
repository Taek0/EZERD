# 프로젝트 DB별 타입·기능 집합 검토 결과

- 작성일: 2026-10-01
- 계획 및 설계: [DB별 타입·기능 집합](../planning/2026-10-01-Database-CapabilityDesign.md)
- 기존 계획: [다중 DB DDL](../planning/2026-10-01-DDL-MultiDatabaseExportPlan.md)

## 결론

- 지원 DB의 타입·기능을 제품의 공통 정의로 관리하고 선택 DB가 허용하는 집합만 사용하도록 하는 방향을 권장했다.
- 적용 범위를 UI 후보 필터링부터 옵션, 서버 저장, sync, MCP, import 및 DDL 최종 검증까지 정리했다. 같은 이름이라도 DB별 의미가 다른 타입과 기능별 조건은 각각 정의한다.
- 타입·기능 등록, 구현 완료, 실제 DB 검증 완료를 구분하고 지원 버전의 컬럼용 기본 타입 전체를 목표로 하되 사용자 타입·확장·SQLite 일반/STRICT 모드를 별도 취급한다.
- 기존 DB 선택 변경은 메타데이터만 갱신하므로 새 구조에서는 호환성 검사 및 설계와 DB의 원자적 변경이 필요하다. 기존 MySQL/SQLite 표시 프로젝트에도 PostgreSQL 타입이 들어 있을 수 있어 명시적인 호환 전략이 필요하다.
- 이전 export 변환 우선 계획에 후속 설계 링크와 우선순위 변경을 표시했다. 사용자의 요청은 구조에 대한 의견이며 제품 구현은 진행하지 않았다.

## 확인과 변경

- 현 코드의 `TableEditor`, `relational.ts`, 서버의 `WorkspaceService.updateProject`, sync/MCP의 구조 검증 사용을 읽고 적용 지점을 확인했다.
- PostgreSQL/MySQL 타입 및 SQLite affinity/STRICT 공식 문서를 확인했다. 세부 전체 타입/기능 명세 작성은 향후 구현 첫 단계로 남겼다.
- 이번 변경은 계획 문서 추가, 기존 계획의 후속 안내, 검토 로그로 한정했다. 제품 코드·동시 작업·`docs/EZERD.txt`는 수정하지 않았다.
- 문서 링크와 이번 diff 공백 오류를 확인한다. 문서는 Prettier 제외 대상이며 제품 테스트/빌드/DB 실행은 이번 검토에서 수행하지 않았다.
