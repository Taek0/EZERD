# C3 native sync 최종 후보 검증 준비

- 시작 `9d4277c`, 작업 트리 깨끗함. [명세](2026-10-01-Database-CapabilitySpecification.md)의 row-lock 안 최종 후보 정책을 먼저 서버 함수로 준비한다. live v1 endpoint/저장은 유지한다.
- 호출자가 row lock과 권한 확인을 끝낸 프로젝트/current, 사용자·클라이언트별 발급 baseline, 필드 버전을 전달한다. helper는 저장/ACK/idempotency 결과를 만들지 않으며 `prepared` 후보만 반환한다. replay는 새 검증보다 먼저 기존 서비스에서 처리해야 한다.
- raw v2 입력의 diff/claims를 검증하고 계약 파싱이 raw 문서/claims를 바꾸는 경우 차단한다. 프로젝트 DB/profile/revision과 baseline ID/사용자/client/sequence/발급 시각/수명/원문 문서를 확인한다. v1 current는 upgrade-required로 거부한다.
- 서버가 계산한 AST/FK/index/check 참조 read-set과 요청의 추가 의존 경로를 합쳐 concurrent 구조 변경을 보호한다. reconnect field conflict 및 과거 삭제 identity 재사용도 차단한다.
- 서버 current에 실제 변경만 적용하고 전체 merged 구조/크기 및 공통 native write 정책을 검사한다. legacy 비교의 previous는 client baseline이 아닌 current다. 미완성 draft는 현재 정책을 따르고 새 미검증 기능은 계속 차단한다.
- DB 물리 범위에 관계없이 domain/view/note/layout, 소유 테이블·key/FK/ENUM/AST/index/check 참조와 scope를 공통 모델에서 검사한다. 새 dangling 참조는 write에서 거부하고 기존 원인만 previous 기반으로 유지한다. SQL 생성 가능성 검증과 같은 단계로 혼동하지 않는다.
- 원본 immutability, 위조 claims/baseline, revision/DB/v1/만료, 서버 read-set(빈 client read-set 포함), 현재 legacy 원문과 신규 legacy 복제/미검증 기능, tombstone/merged 예산을 테스트한다.
- 최종 서비스 연결에는 공통 화면 배치 정규화, migration/import/history·프로토콜별 결과 소비와 실제 DB 트랜잭션 검증이 더 필요하다. 이번 준비 함수를 전체 C3 완료나 v2 저장 활성화로 보고하지 않는다.
