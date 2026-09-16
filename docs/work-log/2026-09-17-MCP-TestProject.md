# Test 프로젝트 생성 결과

- EZERD MCP로 `Test` 프로젝트를 생성했다.
- 프로젝트 ID: `263e223d-1929-4e85-bb81-6206944fd158`.
- 사용자 도메인: `users`, `user_addresses`.
- 결제 도메인: `payments`, `refunds`.
- 컬럼 17개, 기본 키 4개, 사용자 이메일 유일 키 1개를 생성했다.
- 외래 키는 `user_addresses.user_id → users.id`, `refunds.payment_id → payments.id`, `payments.user_id → users.id`로 구성했다. 모두 부모 1 : 자식 N 관계다.
- 사용자 주소는 부모 삭제 시 CASCADE, 결제 및 환불 참조는 RESTRICT로 설정했다. 참조 키 갱신은 CASCADE다.
- 도메인 관계 설명과 메모에 사용자 확인, 결제 결과, 환불 한도 검증을 기록했다. 상태·양수·누적 환불액 규칙은 애플리케이션 검증 설명이며 CHECK 제약을 생성하지 않았다.
- 최신 버전 0 / 동기화 순서 0에서 문서 변경을 원자적으로 적용했다. 재조회 결과 버전 1 / 동기화 순서 1, 도메인 2개, 도메인 관계 1개, 테이블 4개, 테이블 관계 3개, 메모 2개를 확인했다.
- `diagnose_project` 결과: 진단 항목 0개.
- 실제 데이터베이스 테이블 생성이나 서비스 코드 변경은 수행하지 않았다.
