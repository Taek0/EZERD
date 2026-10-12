# 로컬 main 패널 성능 개선 선별 반영 결과

- 기준 main 3092869의 관계선 draft 참조 저장 수정과 테스트는 변경 없이 보존했다. 시작 시 미커밋 변경은 없었다.
- 0830855 → 081fc42: 탐색/핀 패널의 rAF 폭 미리보기와 종료 시 상태 확정, 회귀 테스트.
- e1c48c0 → 031cdf2: 선택 컬럼을 해당 테이블 카드에만 전달하는 개선, 회귀 테스트.
- 충돌 없이 cherry-pick했다. lab 계측 도구·Vite 설정·원시 결과·전용 지침은 제외했다.
- pnpm format 및 pnpm check 성공. 2,877 tests passed / 499 skipped, 238 files passed / 26 skipped. 타입 검사와 제품 빌드 성공; 번들 크기 경고만 남았다.
- format 이후 native-inspector-audit.test.ts의 내용 해시가 HEAD와 같음을 확인했다. 별도 코드 변경은 포함하지 않았다.
- 브라우저 시간 개선율은 앞선 작업에서 미확정이며 이번 선별 반영으로 확정된 것은 아니다. 원격 push는 하지 않았다.

[반영 계획](2026-10-12-Git-PanelPerformanceMainPlan.md)
