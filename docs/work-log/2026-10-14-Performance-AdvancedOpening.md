# 고급 편집기 첫 펼침 및 회귀 보완

- PanelSection의 선택적 onPrepareOpen을 추가했다. 자신의 닫힌 summary를 누를 때만 flushSync로 지연 콘텐츠를 준비하여 AnimatedDetails의 높이 측정 전에 폼을 생성한다. 다른 패널/중첩 summary에는 적용하지 않는다.
- 기존 정적 고급 UI 테스트는 initialSelection으로 열린 상태를 명시해 내용/권한/언어 검증을 유지하고, 구조 화면의 닫힌 폼은 미마운트를 기대하도록 수정했다.
- 관련 22개 회귀 통과. 앞선 전체 검사(정적 테스트 조정 후)는 타입/제품 빌드 포함 성공했다. 최종 main에서도 전체 검사를 실행한다.

[계획](../planning/2026-10-14-Performance-AdvancedAndAckBoundaries.md)
