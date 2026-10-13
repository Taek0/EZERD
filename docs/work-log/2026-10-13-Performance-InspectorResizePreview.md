# 우측 속성 패널 폭 미리보기 구현 결과

- useInspectorResize hook으로 포인터 처리를 분리하고 기존 createPanelWidthPreview를 재사용했다.
- CSS Grid는 --native-inspector-width를 참조한다. pointermove는 rAF CSS/ARIA 미리보기만 예약하고 종료 시 한 번 폭 state를 확정한다. localStorage effect는 확정된 state에만 반응한다.
- pointerup의 마지막 좌표를 반영하며 cancel/lost capture는 마지막 미리보기를 확정한다. 다른 포인터는 무시하고 unmount 시 예약 frame을 취소한다. 기존 키보드/clamp/stacked 레이아웃과 열기·닫기 애니메이션을 유지했다.
- 추가 회귀 5개: 100회 move에 commit 0회와 rAF 1회, release 좌표 및 중복 종료, cancel/lost capture, 좁은 화면 clamp와 키보드, unmount 정리를 검증했다.
- pnpm format 및 pnpm check 성공: 포맷·타입·전체 테스트·제품 빌드 통과. 번들 크기 경고는 남아 있다.
- 브라우저 프레임 시간 및 체감 개선율은 이번 검증에 포함하지 않았다. 실제 레이아웃 비용은 남으며 모든 지연 제거를 의미하지 않는다.

[계획](../planning/2026-10-13-Performance-InspectorResizePreview.md)
