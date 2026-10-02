# EZERD DB 구조 MCP 구성 계획

- 요청: 현재 EZERD DB 구조를 EZERD MCP의 `ezerd` 프로젝트로 구성한다.
- 기준: `apps/server/src/db/schema.ts`와 최신 `0010_snapshot.json`을 대조한다. 운영 DB에 직접 접속하여 확인한 구조가 아닌 현재 저장소 스키마를 기준으로 한다.
- PostgreSQL 테이블, 컬럼, 기본값, NULL 허용 여부, PK, UNIQUE, ENUM, 실제 FK를 반영한다. 일반 인덱스와 CHECK는 테이블 메타데이터에 보존한다.
- 인증, 프로젝트/개인 상태, 리뷰, 동기화 도메인으로 구분하고 공유 화면 카드를 최소 40px 간격으로 배치한다.
- JSONB 내부 설계 객체는 물리 테이블로 오인하여 추가하지 않는다.
- MCP로 생성한 결과를 재조회해 객체 수, 제약조건 및 배치 간격을 검증한다. 결과는 work-log에 기록하고 문서 변경을 커밋한다.
