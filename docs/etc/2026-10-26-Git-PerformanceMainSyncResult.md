# 성능 워크트리 main 반영 결과

- origin/main 42a6cb5를 codex/performance-lab에 병합했다. 병합 커밋 c3a6c37.
- 중단 후 남은 NativeProjectView.tsx import 충돌은 main의 native-save-error import와 기존 useNativePanelDerived를 모두 유지해 해결했다.
- 대형 ERD 저장·관계선 재생성·SVG 내보내기·호스팅 자동화 및 관련 수정이 반영됐다. main의 미포함 커밋은 0이며 제품 소스는 main과 같다. lab 전용 측정 도구와 추가 상호작용 검사는 유지했다.
- pnpm install --frozen-lockfile 및 pnpm check 통과: 288개 파일, 3,173개 테스트 통과 / 환경 조건부 500개 건너뜀. 포맷·전체 타입·서버/웹 빌드 성공.
- 구성 검사용 더미 로컬 DATABASE_URL을 사용했고 실제 DB 동시성 검사는 활성화하지 않았다. 기존 큰 main chunk 경고는 남아 있다.
- 로그: artifacts/performance/2026-10-26-main-sync-check.log (Git 제외).
- main checkout·실제 문서·실행 서버는 수정하지 않았고 원격 push는 수행하지 않았다.
