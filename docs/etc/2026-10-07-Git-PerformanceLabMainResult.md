# 성능 lab main 반영 결과

- codex/performance-lab에 origin/main 03725d7(PR #5 병합 포함)을 충돌 없이 병합했다.
- 동시 편집·queued draft 처리, 빈 캔버스 오류 수정, 최신 UI/히스토리와 영역 선택 개선을 반영했다. 제품 features/shared hooks는 origin/main과 동일하다.
- lab 전용 계측 도구·설정 및 원시 결과를 유지했다. 영역 선택 원시 JSON 4개의 SHA-256이 기존 manifest와 일치함을 확인했다.
- pnpm format 및 pnpm check 통과: 231개 파일 / 2,813개 테스트 통과, 27개 파일 / 506개 환경 조건부 skip. 전체 타입·제품 빌드 통과.
- pnpm perf:build 통과. 기존 bundle 크기 경고는 유지된다. 병합 커밋 이후 깨끗한 HEAD 기준으로 성능 빌드를 다시 생성한다.
- 기본 main checkout과 PR 워크트리는 변경하지 않았으며 원격 push는 수행하지 않았다.

[계획](2026-10-07-Git-PerformanceLabMainPlan.md)
