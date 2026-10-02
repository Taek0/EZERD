# Native 인덱스 타입/접근 방식 검증 결과

- 계획: [NativeIndexPolicy](../planning/2026-10-02-Database-NativeIndexPolicy.md).
- PostgreSQL18.6 실제 65개 builtin 선언 × 6 접근 방식을 실행하여 default opclass 허용/거부를 공통 index policy와 비교했다. ENUM/integer array/XML array는 생성 이후 실제 삽입을 추가했으며 XML 배열은 빈 인덱스 생성 성공만으로 허용하지 않는다. btree/hash/gist/spgist/gin/brin 대표 실제 삽입/조회도 통과했다. 재현: `apps/server/scripts/verify-native-index-methods.ts`.
- validator는 PG 모든 방식 및 expression 결과 타입을 검사하며 MySQL SPATIAL 단일 NOT NULL 공간 컬럼과 functional JSON/미검증 TEXT 결과 제한을 검사한다. JSON/JSONB 결과를 구분하고 PG JSON literal을 boolean 결과 컬럼 타입으로 잘못 CAST하는 회귀를 수정했다.
- MySQL8.4.11 실제 DDL fixture에서 FULLTEXT 검색, SPATIAL 삽입/조회, invisible 함수 인덱스 metadata를 확인했다. FULLTEXT/SPATIAL explicit ASC는 엔진 ERROR1221을 일으켜 emitter에서 제외하고 회귀 테스트를 추가했다. 기본37종과 기존 CHECK/FK/generated/prefix/default 실행도 통과했다.
- 정책 targeted 221개 및 PG 식/취소 격리57개 통과. 최종 DDL 회귀 targeted 결과는 아래 후속 기록에 포함한다. 타입/feature usable는 아직 false이며 UI/공통 MySQL character/복합 key budget 연결과 전체 활성화 QA는 후속이다.

- 최종 index/expression/DDL/validation 4파일222개 통과. MySQL 실제 실행은 마지막 emitter 수정 뒤 성공했다. 병렬 MySQL character helper·integer conversion 변경은 이 커밋에서 제외한다.
