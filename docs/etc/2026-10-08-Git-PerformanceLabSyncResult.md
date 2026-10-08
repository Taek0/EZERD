# 성능 lab 원격 main 동기화 결과

- origin/main 00f22c6을 codex/performance-lab에 병합했다. 관계선 inspector 개편, Native 원격 갱신·웹소켓/MCP 변경 등 최신 main 작업을 반영했다.
- 충돌은 lab의 hover 회귀 테스트와 제품 PR 검증 문서 추가분을 모두 유지해 해결했다.
- main에서 Legacy Canvas 렌더러가 제거되어 옛 main.tsx harness는 performance/archive/legacy-main.tsx.txt에 보존하고 Legacy 진입점은 사용 중단 안내로 바꿨다. compare는 Native를 기본으로 하고 Legacy 선택을 비활성화했다. 과거 원시/빌드는 보존한다. 현행 코드에서 Legacy 비교는 지원하지 않는다.
- relationGeometry 계측을 packages/model의 새 경로로 옮겼다. 기존 집계 스크립트와 호환되도록 span 이름 relation-routing.ts.relationGeometry는 유지한다.
- pnpm format / pnpm check 통과: 236개 파일 / 2,868개 테스트, 26개 파일 / 499개 환경 조건부 skip. 제품 타입 검사·빌드 통과.
- 계측 변경의 focused 테스트 2개 및 pnpm perf:build 통과. 최종 커밋 기준으로 성능 빌드를 재생성한다. 기존 bundle 경고 유지.
- 제품 features/shared hooks는 origin/main 대비 lab 전용 hover 회귀 테스트만 추가로 남는다. 계측 도구·원시 데이터는 유지했다. main에 이미 존재하는 artifacts 파일 2곳의 EOF 공백 경고는 임의 수정하지 않았다.
- 기본 checkout과 PR 워크트리, 원격 브랜치는 변경하지 않았다.

[계획](2026-10-08-Git-PerformanceLabSyncPlan.md)
