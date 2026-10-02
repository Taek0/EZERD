# C4 native 생성·갱신/FK 파생 모델 결과

- 계획: [NativeEditModel](../planning/2026-10-02-Database-NativeEditModel.md). 시작 `9ae996b`.
- `createNativeTable`/`createNativeColumn`은 프로젝트 profile의 native 기본 타입과 파라미터, namespace/options, 소유 테이블 scope를 사용한다. PG TEXT, MySQL VARCHAR(255), SQLite TEXT를 서로 다른 native ID로 생성한다. factory는 legacy 분기를 생성하지 않는다.
- `addNativeColumn`, `updateNativeColumn`, `updateNativeTable`은 새 ID·소유자·DB 문맥 및 legacy 출처를 보호한다. 부분 갱신에서 지정하지 않은 type/default/generation/options를 지우지 않는다. 테이블 도메인 이동·배치는 property patch 대상에서 제외했다. 원문 설명 수정과 명시 native 타입 복구는 허용하고 새 legacy 복사/원문 교체는 차단한다.
- strict column/table patch 계약은 기존 native field 계약을 재사용한다. ID·소유자·문맥·unknown field 주입은 파싱 실패이며 조용히 무시하지 않는다. 표현식 예산과 native 값 구조도 재사용한다.
- `createNativeForeignKeyFromPrimaryKey`는 순서 있는 전체 PK에서 child→parent FK 후보를 원자적으로 만든다. 타입/PG ENUM·배열/MySQL unsigned/charset/collation은 유지하고 default/identity/serial/autoIncrement/computed 및 MySQL onUpdate는 제거한다. 새 ID·키/참조·scope를 사전 검사하고 derived 컬럼/관계에 엔진 검증을 적용한다. 이름 충돌은 Unicode를 깨뜨리지 않는 DB별 제한 안에서 해소한다.
- MySQL 문자열의 table-level charset/collation은 derived 컬럼에 명시한다. parent collation이 미확정인데 child에 다른 collation이 지정돼 있으면 `foreign-key.collation-unresolved`로 차단한다. 실제 환경 매핑을 추측하지 않는다. 미해결 legacy/ENUM, deferrable PK 및 지원 불가 generated FK 후보도 거부한다.

## 검증 및 범위

- model 15개 + contracts 5개 테스트, 총 **20개 통과**. 세 DB generation 제거·타입 보존, composite 순서, PG ENUM/array, MySQL 상속 옵션·onUpdate 제거, 긴 numeric 문자열, Unicode 식별자, 전역 ID·scope·문맥, immutable patch, 원문 provenance 및 unknown-field 차단을 확인했다.
- 전체 `pnpm check`: 포맷·타입·빌드 통과, **833개 통과/54개 건너뜀**. 이후 patch 계약 output을 model patch 타입으로 명시한 변경은 shared build·해당 20개 테스트로 재확인했다. 기존 대형 웹 번들 경고가 있다.
- 이 단위는 편집 후보의 순수 model/입력 계약이다. schema·전체 예산·참조 및 현재 잠긴 원본을 previous로 하는 write policy 검증, retired ID와 sync ACK는 별도 경계다. helper가 반환됐다는 사실을 저장 승인으로 간주하지 않는다.
- native 편집 UI/MCP·shared 저장·upgrade/import/history·DDL·실제 SQL 실행을 완료한 것으로 계산하지 않는다. usable gate는 그대로 비활성이다. 다른 종류의 DB 변환이나 legacy 타입 신규 복제도 허용하지 않는다.

다음은 이 model을 실제 native 편집 소비와 versioned sync 저장 경로에 연결하는 단위다. 필요 시 공통 canvas 함수의 형식 독립성을 확장하되 v1 physical payload를 통한 native 투영은 사용하지 않는다.
