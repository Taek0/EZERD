# 성능 작업 격리 완료 기록

작성일: 2026-09-28

## 작업 위치

- 기본 checkout: D:/ChatGPT/ERD, main. origin/main과 HEAD edadb11이 일치하며 fast-forward로 반영했다.
- 성능 checkout: C:/Users/nty43/.codex/worktrees/product-performance-pr/ERD, codex/performance-lab. 기존 PR용 폴더를 재사용하므로 폴더명은 유지했다.
- lab은 병합된 main에서 시작하고 측정 도구·설정·기록만 추가했다. 제품 features·일반 test-utils·서버·모델은 main과 차이가 없음을 확인했다.
- 기존 feat/performance-measurement 3e2e5f0과 codex/canvas-performance-only 5ddf563 브랜치는 이력 확인용으로 보존했다. 원격 브랜치는 변경하지 않았다.
- lab은 로컬 브랜치이며 origin/main upstream 설정을 해제했다. 원격 push는 수행하지 않는다.

## 파일 이동 검증

- 원시 결과236개,97,451,901 bytes를 lab의 artifacts/performance로 이동했다.
- 기존 dist-performance606개/11,517,441 bytes와 dist-performance-immediate606개/11,517,229 bytes를 artifacts/performance/relocation-builds 아래에 보존했다. 기존 빌드를 현재 실험 빌드로 재사용하지 않는다.
- 총1,448개 파일을 복사한 뒤 각각의 상대 경로·크기·SHA-256을 대조했고, 복사 중 원본 변경이 없는지 다시 확인한 후 지정된 원본 폴더3개만 제거했다. reparse point와 루트 경계도 검사했다.
- manifest는 lab의 artifacts/performance/relocation-manifest.json에 보존한다. 원시 결과·manifest·빌드는 Git 제외 대상이다.
- 기본 checkout의 .env·.data·일반 dist·의존성·다른 워크트리는 이동하거나 삭제하지 않았다.

## 검증과 향후 실행

- lab에서 pnpm format 및 pnpm check 통과:392개 테스트 통과, DB 관련25개 skip, 타입·포맷·일반 빌드 통과. 기존 큰 청크 경고는 남는다.
- 이 브랜치의 AGENTS.md에 성능 작업 위치와 제품 PR 분리 원칙을 추가했다. 향후 성능 작업은 아래 폴더를 명시적인 cwd로 사용한다.

```powershell
Set-Location 'C:\Users\nty43\.codex\worktrees\product-performance-pr\ERD'
git status --short --branch
pnpm perf:build
pnpm perf:serve
```

이전 기록에 남은 D:/ChatGPT/ERD/artifacts/performance 절대 경로는 당시 위치다. 같은 상대 경로의 결과는 현재 lab 폴더 아래에 있으며 manifest에 이전/현재 위치가 기록되어 있다.

추가 확인: 도구 이전 커밋 c923b63의 깨끗한 상태에서 pnpm perf:build를 실행해 새 apps/web/dist-performance 생성에 성공했다. 보관된 relocation-builds와 원시 결과는 별도 위치로 유지한다.
