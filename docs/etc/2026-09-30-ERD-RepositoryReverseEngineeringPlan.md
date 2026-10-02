# 현재 코드의 ERD 생성 계획

- 기준: apps/server/src/db/schema.ts의 Drizzle PostgreSQL 정의.
- EZERD MCP로 TY 공간에 별도 프로젝트 `EZERD 코드 ERD · 2026-09-30`을 생성한다.
- 런타임 스키마 메타데이터에서 테이블, 컬럼, 기본값, PK, UNIQUE, FK, ENUM을 추출한다.
- 인증, 공간, 프로젝트, 리뷰, 동기화 도메인 및 전체 조회 화면을 구성한다.
- JSONB 내부 모델은 물리 테이블로 오인하지 않도록 컬럼 설명에 표시한다. 조건부 유일 인덱스와 CHECK, 일반 인덱스는 테이블 메타데이터에 기록한다.
- 카드 크기는 모델의 tableCardMetrics로 계산하고 모든 카드 사이 최소 40px 간격을 확인한다.
- MCP 생성 결과를 재조회하여 객체 수와 배치를 검증하고 작업 기록을 남긴다.
- docs/EZERD.txt는 수정하지 않는다.
