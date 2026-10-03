# Native private CAS 복구 실제 UI QA 계획

- 작성일: 2026-10-03
- 범위: 전용 loopback 3143/3144, UUID 격리 QA DB, 자체 prefix/두 브라우저 탭, owner/PIN 명시 로그인. 생산 source/private helper 및 부모 서비스/탭/변수는 수정하지 않는다. Git 및 전체 build/check는 하지 않는다.
- QA harness는 일반 session/GET/PUT API로 다른 writer의 personal CAS 버전을 올린 뒤, 원래 PUT을 서버로 전달해 실제 409를 받고 응답 연결만 끊는다. 성공 ACK를 임의 조작하거나 DB row로 CAS 버전을 직접 바꾸지 않는다.
- unknown pending/입력 보존 → fresh GET의 증가 counter로 proof → 원요청/입력 archive → 사용자 명시 release UI를 검증한다. 같은 version/404는 positive가 아니다. 가능하면 두 탭의 별도 미저장 입력 및 active/unknown lease 보호도 실제 scope에서 확인한다.
- 브라우저 hidden storage/cookie/token은 읽지 않는다. harness의 자체 API 로그인 token은 메모리 내부에서만 사용하고 출력하지 않는다. 증거는 DOM의 보관 입력/상태와 sanitized API counter/status 및 스크린샷으로 남긴다.
- 종료 때 자체 탭·3143/3144 listener·자체 DB·임시 스크립트만 정리한다. 실패는 생산 코드를 고치지 않고 부모에게 재현과 영향으로 보고한다.
