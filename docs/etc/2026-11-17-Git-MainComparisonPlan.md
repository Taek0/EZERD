# 로컬·원격 main 커밋 비교 계획

- `origin`의 실제 `main` SHA를 조회하고 로컬 `main`과 공통 조상, 양쪽 고유 커밋, 최종 파일 차이를 확인한다.
- squash 병합 등으로 커밋 SHA만 다른 변경과 아직 반영되지 않은 파일을 구분한다.
- 브랜치 통합이나 push 없이 비교하고 [결과](./2026-11-17-Git-MainComparisonResult.md)를 남긴다.
