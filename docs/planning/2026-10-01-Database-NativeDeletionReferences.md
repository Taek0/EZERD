# C2f native 삭제 계획과 참조 정리

- 시작 `69b8e53`, 작업 트리 깨끗함. [전체 명세](2026-10-01-Database-CapabilitySpecification.md)의 native 객체 수명/undo/clipboard 기반 단위다.
- 테이블·컬럼·키·ENUM·index·check를 여러 개 선택하는 순수 삭제 planner를 만든다. 계획에는 제거 객체/물리 FK의 logical 전환/차단 참조/최종 후보를 포함해 UI가 구체적인 영향을 보여줄 수 있게 한다.
- 컬럼 참조 index/check/key를 제거한다. 참조 FK의 physical-only 관계는 제거하고 both 관계는 logical 관계로 보존한다. 제거 key 대신 같은 대상 컬럼의 다른 적격 key가 있으면 FK를 유지한다. 관련 layout 경로도 정리한다.
- 남는 generated/default/onUpdate 표현식과 ENUM 참조는 차단 목록에 표시한다. generated 컬럼 연쇄 삭제는 명시 옵션을 선택한 경우에만 계획한다. 기본값을 자동 비우거나 다른 타입으로 바꾸지 않는다.
- AUTO_INCREMENT를 뒷받침하는 마지막 키/index 또는 SQLite WITHOUT ROWID의 PK 삭제는 차단 목록을 제공한다. 기존 무관한 오류 때문에 복구 삭제를 새로 막지 않는다.
- planner는 구조·DB 규칙/제품 readiness/권한/동시성 검증을 대신하지 않는다. 적용 helper는 차단이 있으면 원본을 보존한다. 후보는 이후 서버에서 trusted previous와 다시 비교해야 한다. live v2는 활성화하지 않는다.
- 복합 키/FK·AST/predicate/include·생성식 연쇄·layout·ENUM·undo/원본 보존을 의미 있는 테스트로 확인하고 전체 검증 후 독립 커밋한다.

후속 C3/C7에서 FK 후보 판단을 검증기·planner·sync·DDL에 공통화한다. 현 단계는 기존 검증기의 선언 key 목록을 기준으로 한다. PostgreSQL에서 참조할 수 있는 non-deferrable key와 non-partial unique index의 구분은 [PostgreSQL 18 CREATE TABLE 문서](https://www.postgresql.org/docs/18/sql-createtable.html#SQL-CREATETABLE-CONSTRAINTS)를 확인했다. 이 고급 후보/deferrable 조합의 실제 실행 검증 전에는 native 기능을 활성화하지 않는다.
