# Native 클립보드 저장소 분리와 v1 구현 제거

- NativeERDCanvas가 사용하는 readLocalTableClipboard/rememberTableClipboard를 의존성 없는 메모리 저장소로 분리한다.
- Native가 읽지 않는 localOnly 플래그와 v1 copyTables/parseTableClipboard/pasteTables, fallback/ack helper 및 전용 테스트를 제거한다.
- Native의 실제 copy/paste 이벤트, 시스템 클립보드 실패 시 메모리 fallback, 스코프·권한·검토/저장 로직을 유지한다. 앱 의존성 그래프 테스트도 새 저장소 연결과 기존 모듈 비연결을 확인하도록 갱신한다.
- 기존 Native 계약과 clipboard reader 검증은 변경하지 않는다. 공통 selection 함수 정리는 별도 작업으로 남긴다.
- 타입·포맷·전체 테스트·빌드 후 결과를 기록하고 한 논리적 단위로 커밋한다. DB와 docs/EZERD.txt는 변경하지 않는다.
