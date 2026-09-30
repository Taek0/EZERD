# C1 DB별 타입·기능 카탈로그 구현 결과

- 날짜: 2026-10-01
- 계획: [C1 카탈로그](../planning/2026-10-01-Database-CatalogImplementation.md)
- 기준: [전체 구현 명세](../planning/2026-10-01-Database-CapabilitySpecification.md)

## 완료한 내용

- `Worker 1 - Sol`의 최종 완료를 확인하고 깨끗한 HEAD `e07e178`에서 시작했다. 전체 캔버스/필터 변경은 보존했다.
- 모델 패키지에 PG18/MySQL8.4/SQLite 프로필, 타입 ID/별칭/파라미터 규칙, native 기능 조건 및 활성화를 위한 경로별 증거 검사를 추가했다.
- 타입 정의는 PostgreSQL 65개, MySQL 37개, SQLite 추천 선언 23개이며 기능 정의는 33개다. 별칭/생성 구문은 별도 타입 레코드를 무의미하게 늘리지 않고 resolver로 처리했다.
- MySQL serial의 실제 의미와 PG serial의 차이를 공식 numeric 문서로 확인하고 양쪽의 생성/옵션 의미를 별도로 유지했다. SQLite affinity 우선순위와 STRICT 6개 타입, PG interval seconds 조건도 구현했다.
- 아직 제품 경로에 연결하지 않은 항목은 모두 `specified` 상태다. UI/계약/서버/MCP/DDL/실제 실행 증거가 없는 항목은 선택 가능 목록에서 제외한다. 이 단계가 전체 기능의 사용 가능 구현 완료를 의미하지 않는다.
- 기존 PostgreSQL 타입/DDL 진입점과 실제 제품 UI는 변경하지 않았다.

## 검증

- `pnpm format` 적용, `pnpm format:check` 통과. 요청과 무관한 포맷 차이는 발생하지 않았다.
- 모델 TypeScript 빌드 통과.
- 새 카탈로그/조건 테스트와 기존 PG 타입/DDL/ENUM 테스트: 4개 파일 74개 통과.
- 구체 사례: DB별 별칭 분리, 소수 scale 차이, 필요한 길이와 무관한 옵션, 원형 객체 이름을 사용한 옵션 우회, 부정확한 활성 증거, SQLite STRICT/affinity, AUTO_INCREMENT/INTEGER PK/FK 조건.
- 실제 DB 실행 검증은 아직 수행하지 않았으며 `verified`로 활성화하지 않았다.

## 다음 단위

C2에서 v2 native 타입·생성·기본값·테이블 모드와 v1 읽기/복구 어댑터 및 계약을 추가한다. 이후 서버 문맥/편집기/DDL을 단계별 연결한다. 전체 구현 명세는 미완료이고 자동 확인은 이어지는 작업의 진행을 위해 유지한다.
