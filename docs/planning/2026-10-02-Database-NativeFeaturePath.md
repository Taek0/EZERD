# Native advanced feature full-path fixture 계획

- 기준은 core activation `c242db9` 이후 실제 33개 databaseFeatureIds와 default/ON UPDATE의 별도 coverage다. 사용자 승인 범위는 새 native-feature-path.integration.test.ts, 하나의 공통 fixture helper, 새 3-engine 실행 스크립트와 계획/동명 work-log다. 다른 agent의 C7 policy/UI와 main registry/validation/coverage는 수정하지 않으며 git add/commit하지 않는다.
- 공통 table/column/key/relation IDs와 동일 builder를 REST/MCP 및 SQL 준비/실행에 사용한다. 33개 feature의 DB별 지원 subset과 PG 6 index method, MySQL invisible index, literal/식 default, ON UPDATE를 case로 분리한다. incompatible generated/identity/default/key/STRICT/WITHOUT ROWID 조합은 서로 다른 프로젝트/실행 fixture에 둔다.
- 현재 허용된 기본 table/column을 실제 REST로 prepare하고, 실제 발급 baseline/current source에서 candidate를 만든다. native sync write → authenticated MCP patch/read → REST/MCP DDL export와 원문/좌표/replay/hash를 확인한다. DB seed, fake previous, gate injection을 쓰지 않는다.
- 미활성 dependency가 있는 case는 현재 201 rejected ACK와 문서/version 불변을 실제 검증한다. readiness가 활성화된 같은 case는 accepted 경로를 요구하며 실제 서버 export SQL을 기록한다. 지원하지 않는 DB/설치되지 않은 collation/예약 default 함수는 별도 음성 case로 유지한다. blanket false assertions로 새 기본 기능을 거부시키지 않는다.
- SQL 스크립트는 같은 builder의 prepared DDL과 실제 API 산출 SQL을 구분한다. 준비 SQL의 엔진 실행은 API write 성공의 근거로 계산하지 않는다. 실제 full-path SQL 모드에서는 case별 manifest/source hash/모든 기대 SQL을 확인한 후 PG rollback/격리 MySQL QA DB/고정 SQLite 하한 실행으로 검증한다.
- 담당 targeted format/unit/isolated actual integration/typecheck를 실행하고 부모 활성화 전 positive coverage 미완료와 환경/정책 차단을 정확히 인계한다. full check/build 및 모델/기존 service/helper 수정은 하지 않는다.
- 최종 fixture는 77개(PG 31/MySQL 26/SQLite 20)로 고정한다. PG INCLUDE는 BTREE 사례이며 GIST/SP-GiST INCLUDE 추가 2개는 최종 집합에 포함하지 않는다. 실제 API 테스트는 77개 경로와 collation/예약 default 부정 사례 6개로 총 83개다.
- `EZERD_NATIVE_FEATURE_REQUIRE_ALL=1`은 모든 case의 현재 정책상 accepted를 요구하는 테스트 옵션이며 coverage를 변경하지 않는다. 실제 manifest 실행은 기본적으로 전체 77개와 REST/MCP SQL 154개를 요구한다. `--partial` 결과는 전체 검증과 구분한다.
- 최종 준비 SQL/actual API/actual SQL의 서로 다른 증거와 실행 주체는 [작업 기록](../work-log/2026-10-02-Database-NativeFeaturePath.md)에 기록한다.
