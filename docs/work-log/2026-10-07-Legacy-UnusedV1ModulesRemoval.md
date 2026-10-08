# 미사용 v1 모듈 제거

- [계획](../planning/2026-10-07-Legacy-UnusedV1RemovalPlan.md)의 단위 1 완료.
- document-history.ts, ddl-diagnostics.ts와 각각의 전용 테스트를 제거했다. 4개 파일, 344줄을 삭제했다.
- 앱·패키지·스크립트에서 제거된 모듈 경로와 export의 참조가 남지 않았음을 확인했다.
- pnpm typecheck, pnpm build, git diff --check 통과. Vite는 500kB 초과 청크 경고를 출력했지만 빌드는 성공했다.
- 검증에는 설치된 Node 24.18.1과 캐시된 pnpm 11.24.0을 사용했다. 초기 샌드박스 경로 접근 실패 이후 정상 로컬 권한으로 동일 검증을 완료했다.
- 실행 경로에 연결된 기존 v1 기능과 Native 공유 코드는 변경하지 않았다.
