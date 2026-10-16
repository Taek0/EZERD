# 테이블 속성 패널 모드별 집계

- 키/관계 숫자가 소유자만 필터링하고 목록은 현재 모드도 필터링해 숫자와 실제 목록이 달랐다.
- 키와 incoming/outgoing 관계의 현재 모드 필터 결과를 숫자와 목록에서 재사용한다. 자기 참조는 중복 집계하지 않는다.
- 논리 전용·물리 전용·공통 항목과 다른 테이블 항목을 섞은 회귀로 모드 전환 후 숫자와 목록 일치를 확인했다. 전체 회귀 및 웹 타입 검사 통과.

계획: [HistoryAndSelectionFixes](../planning/2026-10-16-Canvas-HistoryAndSelectionFixes.md)
