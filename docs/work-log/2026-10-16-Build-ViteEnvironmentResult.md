# Vite 빌드 환경 변수 격리 결과

- 작성일: 2026-10-16
- 계획: [Vite 빌드 환경 변수 격리 계획](../planning/2026-10-16-Build-ViteEnvironmentPlan.md)

## 변경

`apps/web/vite.config.ts`에서 저장소 루트 `.env`의 프록시 포트를 개발 서버 실행에만 읽는다. 서버 환경의 `NODE_ENV=development`가 `loadEnv`의 `VITE_USER_NODE_ENV` 부작용을 통해 제품 빌드를 개발 모드로 바꾸는 경로를 제거했다. 셸에서 명시한 `NODE_ENV=development`와 개발 서버 프록시 포트 우선순위는 유지한다.

## 검증

- 원래 설정을 복제한 임시 프로젝트에 루트 `NODE_ENV=development`를 지정하고 Vite CLI와 동일한 프로덕션 기본값으로 `resolveConfig`를 실행했다. 결과는 `production=false`, `DEV=true`, `NODE_ENV=development`로 문제를 재현했다.
- 실제 설정을 복사해 각각 새 Node 프로세스에서 확인하는 회귀 테스트 4개가 통과했다: 기본 제품 빌드는 `production=true`/`DEV=false`, 명시적 개발 빌드는 개발 모드 유지, 루트 프록시 포트 사용, 셸 포트 우선 사용.
- `pnpm exec vitest run apps/web/src/build/vite-environment.test.ts` 통과.
- 웹 디렉터리의 `pnpm exec tsc --noEmit` 통과.
- 실제 제품 빌드 검증은 상위 통합 작업에서 진행한다. 주 checkout의 `.env`, 패키지 스크립트와 서버 프로세스는 변경하지 않았다.
