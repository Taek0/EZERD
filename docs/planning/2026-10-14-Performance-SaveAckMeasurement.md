# 서버 저장 및 ACK 지연 계측 계획

- 원격 main push 이후 lab 제품 코드 기준으로 별도 Nest HTTP 서버를 loopback 임의 포트에서 실행한다.
- 로컬 개발 DB만 허용하며 고유 테스트 사용자/워크스페이스/프로젝트를 생성한다. 기존 사용자 문서는 수정하지 않고 종료 시 생성한 ID만 정리한다.
- 합성 10/50/100 테이블에서 단일 이름 patch를 반복한다. 사전 operation 조회, HTTP 명령 요청, 서버 command/sync 처리, SQL 누적 시간, 응답 JSON/스키마 검사, nativeEntryAfterAck를 구분한다.
- raw는 artifacts/performance에 보관한다. Node의 ACK 적용 계산은 브라우저 React commit/paint와 구분한다. 자동저장 750ms 대기는 별도 표기한다.
