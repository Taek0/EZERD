# 닫힌 탐색 컬럼 목록 렌더 분리

- NativeNavigatorTable에서 useNavigatorPresence로 목록 마운트를 제어한다. 닫힌 초기 상태에는 컬럼 Button을 생성하지 않으며 열기/검색 결과 노출 시 마운트한다.
- 닫힘 중에는 기존 grid-template-rows/opacity CSS 전환을 유지한다. grid 전환 종료 시 해제하고 transitionend 누락 시 계산된 전환 시간 + 50ms로 정리한다. 재열기/unmount는 예약 작업과 listener를 취소한다.
- reduced motion(전환 시간 0)은 즉시 해제한다. 닫히는 영역에 포커스가 있으면 해당 테이블의 펼침 버튼으로 복귀시킨다.
- SSR의 닫힘/열림/검색 마운트 여부와 종료 이벤트/다른 요소 이벤트 무시/재열기 취소/타이머 대체/모션 감소/포커스 회귀 검증을 추가했다.
- pnpm format 및 pnpm check 통과: 2,902 passed / 499 skipped, 타입/제품 빌드 성공. 기존 번들 크기 경고는 남아 있다.

[계획](../planning/2026-10-14-Performance-ButtonRenderBoundaries.md)
