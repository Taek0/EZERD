# 전체 테이블 캔버스 실제 DB·API 검증

[구현 계획](../planning/2026-10-01-Canvas-DirectTableImplementation.md)의 저장·협업·파일 이동을 실제 PostgreSQL과 HTTP API로 검증했다.

- 실행: `EZERD_DIRECT_TABLE_DB_TEST=1 pnpm exec vitest run apps/server/test/direct-table.integration.test.ts`.
- 결과: 2개 테스트 통과. 매 실행 임의 UUID를 포함한 새 로컬 데이터베이스를 생성하고 마이그레이션을 적용한 뒤 테스트했다. 애플리케이션 연결을 닫고 생성한 DB만 삭제했다.
- 도메인이 0개인 프로젝트에서 테이블 2개·컬럼·PK/FK·테이블 색상·공유 메모를 작업 API로 저장하고 다른 사용자가 다시 조회했다.
- 내보낸 PostgreSQL DDL을 격리 DB의 전용 스키마에 실제 실행했다. 프로젝트 파일을 내보내고 가져온 후 테이블 색상과 FK 모델의 동일성을 확인했다.
- 도메인 지정·해제와 직접 색상 초기화 후 전체 배치·컬럼·키·FK ID가 유지됐다.
- viewer는 공유 색상 수정 작업이 403으로 거부됐고 전체 뷰의 개인 viewport는 저장할 수 있었다. 해당 viewport는 다른 사용자의 개인 상태나 공유 문서에 적용되지 않았다.

검증 중 DDL 예시 이름이 애플리케이션의 `users` 테이블과 겹치는 것을 확인해 예시 스키마를 분리했다. 기존 문서의 초기 viewport는 보존되는 정책이므로 개인 viewport 격리는 기존 공유 viewport의 유지와 사용자별 상태를 비교해 확인했다.
