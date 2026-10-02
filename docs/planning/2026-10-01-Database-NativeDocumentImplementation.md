# C2 native 문서·호환 어댑터 구현

- 기준: [구현 명세](2026-10-01-Database-CapabilitySpecification.md).
- 선행 단위: C1 카탈로그 완료(`d7d8ddd`). 기존 UI/서버는 아직 v1 API로 동작하며 native 기능은 활성화하지 않았다.
- 작업을 C2a 모델/순수 어댑터와 C2b 계약/저장 전환으로 나누어 독립적으로 검증한다. C2a는 기존 문서 API와 병존하는 v2 모델, 생성/기본값/테이블 모드, index/check 식 참조 및 v1의 의미를 보존하는 변환을 추가한다.
- 알려진 PostgreSQL v1 타입만 의미를 유지해 native로 변환한다. MySQL/SQLite 표시 v1의 PG 표현을 자동 재해석하지 않는다. unknown 타입·기본값·스키마는 읽기/복구용 legacy 분기로 보존한다.
- GET/기존 제품 쓰기 경로와 DB 저장 형식은 이번 C2a 단위에서 변경하지 않는다. C2b 이후 서버 revision/baseline 보호와 함께 전환한다.
- 검증: 원본 불변성, serial/ENUM/정수·소수 리터럴 보존, 비호환 문서 복구 표현, 함수·SQL 조각 기본값 보존, 구조화 식 참조/깊이 한도 및 기존 model 회귀 테스트.
