# PostgreSQL DDL 내보내기

현재 설계의 물리 객체에서 생성 SQL을 다운로드한다. 화면 상단 **PostgreSQL DDL ↓**를 누르면 진단을 먼저 실행하고, 오류가 없을 때 `.sql` 파일을 저장한다. 앱이 사용자의 대상 DB에 연결하거나 SQL을 실행하지는 않는다.

프로젝트 공통 ENUM과 생성 DDL 확장은 [추가 확정 기획](../planning/EDITOR_WORKFLOW_DECISIONS.md)이며 아직 구현하지 않았다. 아래 지원 목록은 현재 구현 기준이다.

## 지원 타입

| 분류 | 타입과 매개변수 |
| --- | --- |
| 정수·일련번호 | smallint, integer, bigint, smallserial, serial, bigserial |
| 숫자 | numeric / decimal (precision 1–1000, scale -1000–1000), real, double precision |
| 문자열 | text, varchar / character varying, char / character (length 1–10,485,760) |
| 날짜·시간 | date, time, timetz, timestamp, timestamptz (시간 정밀도 0–6) |
| 기타 | uuid, boolean, json, jsonb, bytea |
| 배열 | 위의 실제 타입에 1차원 배열 표시를 지원. serial 계열 배열은 제외 |

`int`, `int2`, `int4`, `int8`, `bool`, `float4`, `float8`과 표준 시간대 타입 이름도 정규화한다. 타입은 이름과 길이·정밀도·배열 여부를 각각 편집한다. `varchar(50)`처럼 이름 필드에 매개변수까지 직접 쓴 값은 초안으로 저장할 수 있지만 내보내기 시 진단한다.

## 구조와 검증

- 스키마, 테이블, 컬럼, PK, UNIQUE, 명시적인 FK, 테이블·컬럼 주석을 생성한다.
- 복합 키와 순서 있는 FK 대응을 지원한다. 모든 테이블을 만든 다음 ALTER TABLE로 FK를 추가하므로 순환 참조도 생성할 수 있다.
- FK 대상은 같은 순서로 정의된 PK 또는 UNIQUE여야 한다. 양쪽 컬럼 수·물리 적용 범위·타입 호환성과 참조 동작을 검사한다.
- 삭제·수정 동작은 NO ACTION, RESTRICT, CASCADE, SET NULL, SET DEFAULT를 지원한다. PK 포함 여부를 반영해 NOT NULL과 충돌하는 동작을 진단한다.
- 논리 전용 테이블·컬럼·키·관계, 도메인 업무 관계, 자유 메타데이터는 SQL에서 제외한다. 논리 관계를 그렸다는 이유로 FK를 자동 생성하지 않는다.
- 모든 식별자는 큰따옴표로 인용하며 내부 따옴표를 이스케이프한다. 빈 이름, NULL 문자, UTF-8 63바이트 초과 이름, 중복 이름과 제약 충돌을 진단한다. PostgreSQL 기본 식별자 길이 규칙은 [공식 어휘 구조 문서](https://www.postgresql.org/docs/18/sql-syntax-lexical.html)를 기준으로 했다.
- json은 기본 동등 비교 인덱스가 없어 PK/UNIQUE 대상으로 제외한다. 제약 구문의 기준은 [PostgreSQL CREATE TABLE](https://www.postgresql.org/docs/18/sql-createtable.html)이다.

## 기본값의 지원 범위

| 대상 | 지원 예시 |
| --- | --- |
| 모든 타입 | NULL; 입력이 비어 있으면 기본값을 생성하지 않음 |
| 정수·숫자 | 0, -12, 12.50, 숫자형의 지수 표기. 정수 범위와 numeric 반올림 후 자리수 및 부동소수 범위를 검사 |
| boolean | true, false |
| timestamp / timestamptz | now(), CURRENT_TIMESTAMP |
| date | CURRENT_DATE, 유효한 'YYYY-MM-DD' 문자열 |
| uuid | gen_random_uuid(), 표준 UUID 문자열 |
| text / varchar / char | '문자열', 'owner''s title'처럼 작은따옴표를 두 번 써서 인용 |
| json / jsonb | 작은따옴표 안의 유효한 JSON |

임의 SQL 식·캐스트·서브쿼리·사용자 함수·배열 리터럴 기본값은 현재 지원하지 않는다. 문자열 기본값의 직접 역슬래시 이스케이프도 진단한다. numeric 기본값 상수는 현재 JavaScript의 유한 수 범위 안에서 받고 자리수 검증은 BigInt 기반으로 수행한다. 타입 자체의 값 범위와 내보내기에서 지원하는 기본값 식의 범위는 구분한다. numeric 정밀도·스케일 규칙은 [공식 숫자 타입 문서](https://www.postgresql.org/docs/18/datatype-numeric.html)를 참고했다.

모르는 타입이나 기본값은 문서에서 지우지 않는다. 진단이 하나라도 있으면 불완전한 SQL을 다운로드하지 않고 수정할 대상을 표시한다. 기존 DB와의 이름 충돌, 실행 계정 권한, 실제 저장할 데이터의 FK 정합성은 이 생성기의 검증 대상이 아니다. DDL 가져오기·DB 역공학·변경 SQL·뷰·트리거·함수·파티션·사용자 정의 타입 생성은 후속 범위다.

## 검증

```powershell
pnpm test:ddl
```

현재 공유 모델·서버를 빌드한 후 로컬 PostgreSQL 트랜잭션에서 생성 SQL을 실행한다. 별도 임시 스키마에 복합·순환 FK와 여러 타입을 생성하고 기본값 INSERT를 검사한 뒤 전체 롤백한다. 기존 프로젝트의 설계나 DB 테이블은 삭제하지 않는다.

코드: `packages/model/src/postgres.ts`, 단위 테스트: `postgres.test.ts`, 실제 DB 검증: `scripts/verify-postgres-export.mjs`.
