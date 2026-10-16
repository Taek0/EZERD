# DB 검증 컬렉션 인덱스 결과

- 계획: [우선 성능 개선](../planning/2026-10-16-Performance-PriorityImprovements.md)
- 감사 항목: [S1](2026-10-16-Quality-CodebaseAudit.md)
- 대상: `packages/model/src/database/validation.ts`와 기존 검증 테스트. `collect` 호출마다 테이블별 visible 컬럼, 이름별 서로 다른 컬럼 ID 집합, physical 키 목록을 한 번 구성한다.

## 변경과 보존 조건

- 컬럼마다 전체 `doc.columns.filter`와 이름 peer 순회를 반복하던 부분을 테이블 인덱스와 이름 조회로 바꿨다. 빈 테이블 검사도 같은 인덱스를 사용한다.
- `tableKeys`의 전체 키 필터를 테이블별 조회로 바꿨다. 키 배열 순서와 원본 객체를 유지하여 fingerprint 입력은 보존한다.
- physical/both 범위, PostgreSQL의 대소문자 구분과 나머지 프로필의 기존 ASCII folding, generated 컬럼의 원본 peer 순서, 진단 순서를 보존한다.
- 중복 ID가 있는 입력도 기존의 마지막 ID 해석과 원시 peer 항목을 유지한다. 동일 ID가 반복되어도 자기 자신만으로 중복 이름을 만들지 않는다.
- 현재/이전 문서마다 별도 인덱스를 구성한다. 기존 오류 면제와 새 오류 판단은 기존 `issueIdentity`와 cause 입력을 사용한다. 모듈 전역 캐시는 추가하지 않았다.
- generated dependency cycle 순회(S8), DB 정책, SCC 구조, 기타 정리는 변경하지 않았다. 테이블 내부의 생성/키 규칙 순회는 남아 있으므로 검증 전체가 선형이라고 주장하지 않는다.

## 검증

- `pnpm.cmd exec vitest run packages/model/src/database`: 25개 파일, 1,028개 테스트 통과.
- `pnpm.cmd --filter @ezerd/model typecheck`: 통과.
- 수정한 TS 파일만 루트 Prettier 설정으로 포맷하고 검사했다.
- 영구 회귀 테스트 8개: 네 프로필의 이름/범위/진단 순서, 현재와 이전 이름 cause 변경, physical 키 원본 순서, MySQL 생성 컬럼 순서, 손상된 중복 ID 처리.
- 임시 변경 전 구현과 PostgreSQL/MySQL/SQLite/generic 각 100개, 총 400개 입력을 비교했다. scope·키 순서·중복 ID·없는 owner·autoIncrement 변형을 포함하며 inspect와 read/export/write 및 이전 문서 두 종류의 공개 결과를 총 2,800회 완전히 비교해 일치했다. 기존 전체 validator 복사본과 임시 테스트는 제품 소스에서 제거하고 Git 제외 측정 자료에 보관했다.

## 측정

Node v24.18.1, PostgreSQL의 테이블당 컬럼 10개·키 2개인 단순 합성 문서를 사용했다. 변경이 없는 `write` 검증에 같은 문서를 trusted previous로 전달하므로 호출당 현재/이전 수집을 각각 한 번 수행한다. 워밍업 3회 후 9회 중앙값이며 변경 전/후 같은 프로세스에서 순서대로 측정했다. 런타임 샘플에서는 predicate 계측을 제거했다.

| 테이블 / 컬럼 / 키 | 변경 전 중앙값 | 변경 후 중앙값 | 속도 비율 |
| --- | ---: | ---: | ---: |
| 30 / 300 / 60 | 6.87 ms | 2.61 ms | 2.63배 |
| 150 / 1,500 / 300 | 125.64 ms | 11.95 ms | 10.51배 |
| 300 / 3,000 / 600 | 530.17 ms | 23.64 ms | 22.43배 |

별도 계측에서 가장 큰 입력의 원본 컬럼 배열 `filter/some` predicate 방문은 18,897,600회에서 0회, 원본 키 배열 `filter` 방문은 3,960,000회에서 0회가 되었다. 변경 후 인덱스를 만드는 전체 컬럼/키 한 번 순회는 존재하며 이 predicate 수에 포함하지 않았다. 이는 해당 반복 검색 제거의 증거다. 실서비스 지연이나 모든 DB 프로필·생성식·키 밀도에서 같은 비율을 보장하는 수치가 아니다.

원시 데이터·변경 전 소스·임시 재현 테스트: `artifacts/performance/2026-10-16-validation/` (Git 제외). 재현 테스트는 상대 import를 위해 변경 전 구현과 함께 원래 database 디렉터리에 임시 배치 후 실행했고, 실행 뒤 두 파일을 제거했다.
