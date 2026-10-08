# Native WebSocket 알림 전송

- Native 전용 /api/sync 구독 클라이언트를 추가했다. accepted operation과 subscribed/head의 sequence·DB revision만 변경 알림으로 사용한다.
- 연속 알림을 합치고 과거·중복·다른 프로젝트 이벤트를 무시한다. 자기 작업 ID는 짧은 유예 후 HTTP ACK의 반영 여부를 확인하므로 동일 계정의 다른 탭/MCP 변경은 무시하지 않는다.
- 연결 재시도는 최대 30초 backoff, online/focus 복귀와 무응답 연결 감지를 지원한다. 정상 head 알림이 계속되면 주기적 전체 조회를 하지 않는다.
- 서버의 notificationsOnly 구독 옵션은 Native 이벤트의 순서 메타데이터만 보낸다. 기본 구독의 기존 전체 이벤트 응답은 유지한다.
- stop·권한 변경·정책 종료 시 타이머와 연결을 정리한다. payload는 문서에 직접 적용하지 않는다.
- 구독·어댑터·중복·유예·복구 단위 테스트 14개와 서버 알림 projection 테스트를 통과했다.
