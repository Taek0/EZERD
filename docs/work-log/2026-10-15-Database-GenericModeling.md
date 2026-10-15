# RDBMS 미지정 구조 모델링 — 모델·API·MCP

## 변경

- `generic` / `generic-v1`을 독립 프로필로 추가했다. 17개 공통 타입과 길이·정밀도 매개변수를 지원한다.
- 사용자 타입은 `{kind:"custom",database:"generic",name:"List<UserId>"}` 형태로 저장한다. 빈 문자열·제어 문자·120자를 넘는 값과 다른 DB의 타입 조합을 거부한다. SQL로 실행하지 않는다.
- 테이블·컬럼·PK/UNIQUE·FK를 구조적으로 편집한다. PK 기반 FK 생성은 사용자 타입도 복사하며 참조 타입 불일치는 거부한다.
- 빈 프로젝트의 DB 선택 변경은 허용하지만 기존 구조의 자동 DB 변환은 추측하지 않는다.
- DDL 컴파일러와 API 모두 `ddl.database-unspecified`로 내보내기를 거부한다. 프로젝트 JSON 왕복은 유지한다.
- MCP 생성/편집 입력 스키마, 타입 capabilities와 안내를 보완했다. `ddlExport:false`, `customType:true`로 기능을 명시하고 구조 편집 지원을 엔진 실행 검증과 구분한다.
- DB enum 및 프로필 CHECK 마이그레이션 `0016_generic_modeling.sql`을 추가했다. 새 enum 값은 CHECK에서 text로 비교하여 같은 트랜잭션의 미커밋 enum 사용을 피한다.

## 검증과 적용

- 미지원 프로필 실패를 먼저 재현한 뒤 모델·계약 테스트를 추가했다. 사용자 타입 파일 왕복, 잘못된 입력, 키·관계, DB 변경 보호를 검증했다.
- 서버의 생성·DB 변경·파일 가져오기/내보내기·MCP 명령·DDL 차단 관련 42개 테스트 통과.
- 전체 회귀 테스트 2,985개 통과, 499개 환경 의존 테스트 건너뜀. 이후 추가한 관계/변환 테스트도 통과했다.
- 공유 패키지·서버·서버 도구 타입 검사 및 빌드 통과. 전체 Prettier 검사 통과.
- 사용자 DB에는 마이그레이션을 적용하지 않았다. 사용 환경에서 서버 시작 전 `pnpm db:migrate`가 필요하다. 실제 PostgreSQL에 새 마이그레이션을 실행하는 검증은 수행하지 않았다.
- 설치된 도구를 직접 실행했다. 현재 pnpm shim이 지정된 버전을 받으려다 네트워크에서 실패하여 동일한 로컬 TypeScript/Vitest/Prettier 실행 파일을 사용했다. 테스트 TEMP/TMP는 무시되는 `.data/test-temp`를 사용했다.

계획: [GenericModeling](../planning/2026-10-15-Database-GenericModeling.md)
