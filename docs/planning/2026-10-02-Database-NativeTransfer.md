# Versioned native 프로젝트 전송 구현 계획

- 기준 HEAD: `0edbd16`. [구현 명세](2026-10-01-Database-CapabilitySpecification.md), [지원표](2026-10-01-Database-TypeFeatureMatrix.md), [진행 상태](../work-log/2026-10-01-Database-ImplementationProgress.md)를 확인했다.
- 담당 범위: 새 native-transfer 서비스/컨트롤러/계약/개별 계약 테스트/격리 DB 통합 테스트. 기존 workspace, app.module, exports, MCP, web, model은 메인 통합 담당이다. 사용자 지시에 따라 git add/commit은 하지 않는다.
- export는 권한을 확인한 repeatable-read snapshot에서 프로젝트 DB/profile/revision/version/sequence와 공유 저장 원본을 함께 읽는다. formatVersion 2 envelope는 원본 설계와 native preview/진단을 구분한다. 개인 상태는 조회·병합하지 않는다. 전체 물리 객체와 공유 canvas를 보존한다.
- v1은 기존 구조 reader로 읽고 서버에서 migration한다. MySQL/SQLite 표시와 legacy 원문을 유지한다. 서버가 생성한 migration 결과에 한해서 previous를 만들고, 참조/ID remap 후 구조·1.5 MB 문서·2 MB 전송·graph·DB 정책을 다시 검사한다.
- v2 native 문서를 previous로 신뢰하지 않는다. source metadata는 출처 설명이며 인증 수단이 아니다. 검증된 서버 provenance가 없는 native legacy 신규 생성은 명시 진단으로 차단하고 원본 export는 허용한다. 미검증 native 타입도 현재 정책으로 차단한다.
- import는 createProject 권한과 활성 workspace를 트랜잭션 안에서 확인하고, 새 프로젝트/모든 문서 ID와 참조를 재발급한다. 원본 counters는 설명용이며 새 프로젝트 counters/status/개인 상태는 가져오지 않는다. 프로젝트와 감사 기록을 원자 저장한다.
- targeted Prettier, 계약 및 격리 REST/DB 테스트, 관련 TypeScript 검증만 수행한다. 전체 pnpm check/build는 실행하지 않는다. 등록 없이 검증할 독립 Nest 테스트 모듈을 사용한다.
- 결과 및 메인 통합 항목: [작업 로그](../work-log/2026-10-02-Database-NativeTransfer.md).
