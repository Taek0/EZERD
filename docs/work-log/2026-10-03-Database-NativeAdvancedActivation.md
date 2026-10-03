# Native 고급 기능 활성화 결과

- 2026-10-03. [최종 계획](../planning/2026-10-03-Database-FinalQA.md), [활성화 계획](../planning/2026-10-02-Database-NativeReadinessActivation.md), [실제 feature 경로](2026-10-02-Database-NativeFeaturePath.md).
- 기본 타입124개와 기본10개 feature에 이어23개 advanced feature 및 제한된 default/ON UPDATE 정책의 공통 registry coverage를 연결했다. UI/server/MCP는 DB별 허용 여부와 readiness를 같은 모델에서 판정한다. unknown feature ID/deprecated txid_snapshot/설치 미검증 collation·SRID/SQLite custom declaration 신규 default·key의 미검증 판정은 유지한다.
- nativeExpressionDecision의 direct index column은 해당 원본 타입 coverage를 소비한다. point/geometry의 scalar 추론 family가 unsupported라는 이유로 검증된 GIST/SP-GiST/SPATIAL 컬럼 인덱스를 막던 문제가 실제 full-path fixture에서 드러나 수정했다. 임의 expression 결과가 이 direct column의 권한을 빌리지는 않는다.
- 준비 SQL77개를 PostgreSQL18/MySQL8.4/SQLite3.45.0에서 실행했다. 실제 isolated AppModule의83개(77 REST+MCP 경로 및6개 음성 조건)를 통과했고, 실제 내보낸154개 SQL을 manifest/document/SQL 해시 검사 후 같은3엔진에서 실행했다. source actual-rest-mcp, accepted77/blocked0/missing0이다. 정확한 manifest 경로와 재현은 연결된 feature 로그에 기록했다.
- catalog 전체 primitive의 실제 REST/MCP 경로도3개를 재검증했다. 이전 미활성 default 기대는 현재 유효한 default 허용과 세 DB 모두에서 금지하는 NOT NULL/NULL 기본값의 실제 거부로 구분했다. SQLite 일반 affinity가 큰 수를 저장할 수 있는 것을 PG/MySQL 정수 범위 규칙으로 오인하지 않는다.
- model/feature fixture892개 통과, server source/tools typecheck 통과. 중단 후 최신 소스 전체 unit2277개 통과/408개 조건부 통합 건너뜀과 웹 production build를 재확인했다. 조건부408개가 실제 통합 실행에 통과했다는 뜻은 아니다. 전체 최종 pnpm check/API·WS/브라우저 QA는 최종 로그로 별도 완료한다.
- 제한 parser는 타입별 의미 있는 검증된 입력 subset이며 임의 SQL/설치 환경 전체를 보장하지 않는다. registered charset/collation 및 SRID0/4326, 기본 opclass, deterministic 제한 AST를 공통 정책으로 검사한다. 이 결과는 전체 프로젝트의 최종 QA/정리 완료 선언이 아니다.
