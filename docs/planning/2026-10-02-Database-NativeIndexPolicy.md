# Native 인덱스 접근 방식별 타입 정책 계획

- PG btree/hash/gist/spgist/gin/brin의 기본 opclass 허용 타입을 실제 지원 프로필에서 확인하고 공통 판정 API로 제공한다. 모든 타입에 모든 인덱스 방식을 허용하지 않는다.
- 배열/프로젝트 ENUM 및 식 인덱스는 element·result 타입과 방식 조건을 검사한다. unique/include/parts/order/partial 조건은 기존 정책에 유지한다.
- MySQL FULLTEXT는 CHAR/VARCHAR/TEXT 및 동일 charset/collation, SPATIAL은 단일 NOT NULL 공간 컬럼으로 제한한다. prefix/functional/invisible 및 조건은 별도로 검사한다.
- 실제 선언·인덱스 생성 및 대표 삽입/조회 fixture, 공통 validator·UI 소비 테스트를 수행하고 verified는 전체 경로 증거를 확인한 후 별도 활성화한다.
