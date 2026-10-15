# 성능 워크트리 원격 main 병합 결과

- 대상 워크트리: C:/Users/nty43/.codex/worktrees/product-performance-pr/ERD, codex/performance-lab.
- 시작 HEAD 7d10d5a. origin/main 26b3610을 fdfeec3으로 병합한 뒤, 검증 중 추가된 원격 4ee2a3d까지 병합했다.
- DB 미지정/generic 지원, 개인 화면/API 제거, scoped WebSocket 갱신, 물리/논리 모드 전환 UI를 반영했다. 제품 구현 코드는 4ee2a3d와 동일하다.
- 개인 화면 제거에 맞춰 계측 entry/props와 모의 API 응답을 정리했다. 측정 도구·원시 결과와 lab의 저배율 손 도구 hover 회귀 테스트는 유지했다.
- 첫 병합에서 발견한 폐기 개인 키 테스트 기대값은 이후 원격 7a35c68에 동일 수정이 들어와 최종적으로 원격 테스트를 사용했다.
- 최신 모드 전환 코드의 useCallback을 테스트 실행기가 지원하도록 NativeDomainEditor.pending 및 NativeProjectDraftRecovery 테스트만 보완했다. 제품 동작을 변경하지 않았다.
- 최종 pnpm check: 2,928 passed / 495 skipped; 포맷·타입·제품 빌드 통과. 상세 패널 profiling을 켠 pnpm perf:build도 통과했다.
- 로그: artifacts/performance/2026-10-15-main-merge-final-check.log, 2026-10-15-main-merge-final-perf-build.log.
- 기본 main checkout의 파일/브랜치/실행 서버와 DB는 변경하지 않았다. migration 실행 및 원격 push는 하지 않았다. docs/EZERD.txt 직접 수정 없음.

계획: [병합 계획](2026-10-15-Git-PerformanceMainMergePlan.md)
