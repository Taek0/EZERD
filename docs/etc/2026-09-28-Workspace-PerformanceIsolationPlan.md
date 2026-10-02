# 성능 작업 워크트리 격리

작성일: 2026-09-28

- 원격 main edadb11의 PR 병합을 확인했다. D:/ChatGPT/ERD는 main으로 전환하고 origin/main과 fast-forward로 일치시킨다.
- 깨끗한 기존 PR 워크트리 C:/Users/nty43/.codex/worktrees/product-performance-pr/ERD를 재사용한다. 폴더명은 유지하고 최신 main 기반 codex/performance-lab 브랜치에서 향후 성능 작업을 진행한다.
- 이전 feat/performance-measurement 3e2e5f0의 측정 도구·설정·기록만 옮긴다. main의 제품 코드와 일반 회귀 테스트는 유지한다. 원본 브랜치 이력은 삭제하거나 재작성하지 않는다.
- 원시 결과 artifacts/performance의236개 파일과 이전 성능 빌드 두 폴더를 복사하고 모든 파일의 상대 경로·크기·SHA-256을 비교한 뒤 원본을 제거한다. 이전 빌드는 결과 보관 폴더의 relocation-builds 아래 보존하고 새 실험 전 재빌드한다.
- 파일 제거 전 절대 경로가 지정된 측정 폴더인지 검사하고 reparse point가 없는지 확인한다. .env·.data·일반 dist·의존성·다른 워크트리는 이동하지 않는다.
- main은 추가 로컬 커밋 없이 origin/main과 일치시킨다. 이동·검증 문서는 lab 브랜치에만 커밋하며 원격 push는 요청 범위에 포함하지 않는다.
