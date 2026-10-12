# 성능 lab main 동기화 결과

- origin/main 978befc를 codex/performance-lab에 충돌 없이 병합했다.
- 제품 features/shared hooks는 main과 동일하며 lab 전용 hover 회귀 테스트 1개를 유지했다. 계측 도구·전용 지침·원시 결과를 보존했다.
- pnpm format / pnpm check 통과: 240개 파일·2,881개 테스트 통과, 26개 파일·499개 환경 조건부 skip. 타입·제품 빌드 통과.
- pnpm perf:build 통과. 기존 bundle 크기 경고는 유지된다. 커밋 이후 최종 HEAD 기준 성능 빌드를 재생성한다.
- 기존 marquee 원시 JSON의 SHA-256이 manifest와 일치함을 확인했다.
- 기본 checkout/PR 워크트리는 변경하지 않았으며 원격 push는 수행하지 않았다.

[계획](2026-10-12-Git-PerformanceLabSyncPlan.md)
