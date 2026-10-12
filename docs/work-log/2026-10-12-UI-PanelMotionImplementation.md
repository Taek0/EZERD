# 패널 모션과 재입력 처리 보완

- 브랜치: codex/apple-ui-review, 날짜: 2026-10-12.
- [시각 디자인 적용](2026-10-12-UI-VisualDesignImplementation.md)에 이어 알림/MCP 패널의 전환 표현을 보완했다.
- 고정 keyframe 재시작 대신 현재 opacity/transform에서 역전 가능한 CSS transition을 사용한다. 진입은 starting-style로 정의하고 reduced-motion에서는 transition과 transform을 제거한다.
- usePanelDismiss에 닫기 타이머 취소를 추가했다. 알림을 닫는 중 다시 누르면 닫힘을 취소하고 열린 상태를 유지한다.
- 내부 컨트롤이 이미 처리한 Escape는 부모 패널이 다시 처리하지 않는다.
- 회귀 테스트: 50ms 뒤 닫기 취소와 재닫기, reduced-motion의 0ms 닫기, 최신 콜백 참조, 비활성/언마운트 정리, 내부 Escape 처리.
- 실제 Notifications 컴포넌트의 열기→닫기→50ms 뒤 재열기 시나리오에서 결과가 열림이며 data-closing=false인 것을 확인했다. 전환 시간은 160ms다.
- 최종 pnpm check: 235개 파일, 2,866개 테스트 통과. 26개 파일/499개 DB 통합 등 테스트는 제외. format, 타입 검사, 전체 빌드 통과.
- 검사 프로세스에만 비연결 테스트 DB URL과 EZERD_DB_TEST=0을 지정했다. 실제 DB를 변경하지 않았다.
- OS의 모션 설정을 직접 변경하지는 않았다. reduced-motion은 훅 테스트와 CSS 분기 검토로 검증했다.
- 브라우저 검증에서 타입 팝오버가 지나치게 높고 입력 폭보다 좁은 표현을 확인했으며, 별도 최종 메뉴 세부 조정 단위에서 보완한다.
