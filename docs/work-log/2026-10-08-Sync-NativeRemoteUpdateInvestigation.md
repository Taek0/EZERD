# Native 원격 변경 미반영 원인

## 확인 결과

- 현재 웹 소스에 WebSocket 생성이나 /api/sync 구독 경로가 없다. App은 NativeBackgroundRefresh를 만들지만 원격 이벤트에 연결하지 않는다.
- NativeProjectView의 4초 타이머는 로컬 저장 의도 대기열을 처리하며, 작업이 없으면 즉시 종료한다. App의 15초 조회는 workspace 목록 갱신이다.
- 서버 NativeSyncService는 승인 트랜잭션 후 SyncGateway.publish를 호출한다. Gateway는 구독자에게 operation과 주기적인 head를 전송한다.
- 따라서 서버 발행 누락보다 Native 클라이언트의 수신 경로 부재가 직접적인 원인이다. 새로고침으로 최신 문서를 읽으면 보이는 증상과 일치한다.

## v1과 비교

- b880d19 이전 App의 ProjectSyncRuntime은 WebSocket 연결·프로젝트 구독·operation/head 처리와 polling fallback을 제공했다. e891b2a에서 해당 런타임이 삭제됐다.
- Native 최초 진입 경로에서도 이 런타임은 legacy opened 상태에만 연결되어 있었다. 정상 Native 수신 기능을 삭제했다기보다 v1의 수신 기능이 Native에 이식되지 않은 것이다.

## 권장 수정

- 활성 사용자·세션·프로젝트에 한정한 Native 전용 subscriber를 만들고 operation/subscribed/head의 최신 sequence 및 DB revision을 처리한다.
- 원격 변경은 기존 in-place NativeBackgroundRefresh 경로로 반영하고 open/replaceEntry로 화면을 다시 열지 않는다. 자신의 이미 처리한 ACK 및 이전 순서는 중복 적용하지 않는다.
- 연결 재시도·재연결 시 누락 확인·online/focus 및 주기적 catch-up·권한 회수 시 연결 정리를 포함한다.
- 미저장 입력과 전송 중 요청, 진행 중 드래그·경로 편집·카메라를 보존해야 한다. 삭제된 v1 런타임을 그대로 복원하지 않는다.
- 두 사용자 및 MCP 실제 변경, 순서 누락·재연결·이전 세션 응답·자기 ACK 중복·권한 회수 회귀 검증이 필요하다. 기존 서버 WebSocket 테스트만으로 웹 캔버스 반영을 입증할 수 없다.

## 범위

- 코드 및 Git 이력 조사만 수행했다. 이 조사에서는 실시간 수신 구현이나 운영 데이터 변경을 하지 않았다.
