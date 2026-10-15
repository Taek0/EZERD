# 모드 콜백을 반영한 테스트 드라이버 정리

- 전체 회귀 검사에서 앞선 모드 변경의 useCallback을 두 개의 수동 React 훅 테스트 드라이버가 처리하지 않아 invalid-hook-call이 발생했다.
- NativeProjectDraftRecovery와 NativeDomainEditor.pending 테스트의 드라이버에 의존성별 콜백 참조 보존을 추가했다. 제품 런타임 코드는 변경하지 않았다.
- 복구·공유 저장·비동기 응답 관련 두 파일 34개 테스트 통과. 이후 전체 검사 2,930개 통과.
