# 제품 성능 최적화 PR 분리

작성일: 2026-09-28

- 기준 main: 293ff60, 원본 성능 브랜치: 3e2e5f0. 원본 작업 폴더·브랜치는 그대로 보존한다.
- main에서 시작한 codex/canvas-performance-only에 실제 제품8개 파일과 관련 회귀 테스트만 선별한다.
- 계측 어댑터, 측정 화면, Vite 성능 설정, scripts/performance, perf 명령, 원시 측정 결과는 포함하지 않는다.
- 테스트의 측정 fixture 의존성을 일반 test-utils로 옮기고 시간 계측·fingerprint 도구는 제거한다.
- 제품 diff가 원본8개 파일과 동일한지, 측정 경로 import가 없는지 확인한다. 분리된 checkout에서 포맷·타입·테스트·빌드 검증 후 작업 기록을 커밋한다.
- 원격 별도 브랜치로 push하고 main 대상 PR을 생성한다. main에 직접 push하거나 병합하지 않는다.
