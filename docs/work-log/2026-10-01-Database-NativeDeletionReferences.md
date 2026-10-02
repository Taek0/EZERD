# C2f native 삭제 계획과 참조 정리 결과

- 기준: [계획](../planning/2026-10-01-Database-NativeDeletionReferences.md). 순서 복원 수정은 별도 `c63078d`에 있다.
- 테이블/컬럼/key/ENUM/index/check/FK 여러 객체의 삭제 후보, 제거 목록, logical 관계로 보존할 FK 목록, 생성식 연쇄 제거 목록, 차단 참조를 반환한다. apply helper는 차단이 있으면 원본을 그대로 두고 오류 코드를 반환한다.
- 컬럼 참조 key/index/check, index parts/predicate/include와 관련 physical-only FK/route를 정리한다. both 또는 이전 logical 관계의 남은 물리 payload는 logical 관계로 보존한다. 같은 대상 컬럼의 선언 key가 남으면 FK를 유지한다. 테이블 삭제는 소유 객체/배치/참조 관계를 함께 제거한다.
- 남는 generated/default/onUpdate 및 ENUM 참조는 objectId/path/reference 목록으로 차단한다. 기본값을 비우거나 타입을 자동 교체하지 않는다. generated 연쇄 삭제는 명시 옵션일 때만 역방향 참조 큐로 계산한다.
- 마지막 AUTO_INCREMENT 기반 key/index 또는 SQLite WITHOUT ROWID PK 삭제는 차단한다. 이전부터 기반이 없던 무관한 오류 때문에 새로운 차단을 만들지 않는다. 후보의 전체 구조/DB 규칙·원인별 복구/readiness/권한·버전 검사는 별도 서버 단계에 남는다.
- 테스트 **12개 통과**: 복합 key/FK, include/predicate/check, 기본값 보존, 명시 연쇄 삭제, 2,000개 역순 생성 참조, 순환 참조 복구, 논리 관계 보존, 기존 ENUM/legacy ID, MySQL/SQLite 생성 키, 테이블/배치/원본/optional 컬렉션, 삭제와 inverse의 정확한 원상 복원을 확인했다. MySQL/SQLite fixture는 기존 엔진 검증의 오류가 없는 native 문맥으로 구성했다.
- `pnpm check` 포맷/전체 타입/전체 테스트/전체 빌드 통과: **737개 통과/44개 건너뜀**.
- FK 대체 후보는 현 검증기와 같은 선언 key 정책이다. PostgreSQL의 non-deferrable constraint/non-partial unique index 후보를 포함한 고급 공통 정책·실제 SQL 검증은 C3/C7에 남겼다([공식 CREATE TABLE 문서](https://www.postgresql.org/docs/18/sql-createtable.html#SQL-CREATETABLE-CONSTRAINTS)). 실제 API/native 화면/DDL는 아직 연결하지 않았고 v2 저장을 활성화하지 않았다.
