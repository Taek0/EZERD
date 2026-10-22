# 성능 워크트리 main 반영 결과

- origin/main 0e901fd(한 페이지 벡터 PDF 내보내기)을 codex/performance-lab에 충돌 없이 병합했다. 병합 커밋: 023a9fb.
- PDF 내보내기와 의존성/폰트, 메모 배경·테두리, 도메인 색상, 관계선 저장 전 공유 배치 보정, MCP 명령 스키마·순차 배치 지침을 반영했다.
- main 미반영 커밋 수는 0이다. 제품 소스는 main과 같고 lab 전용 측정 도구·추가 상호작용 검사를 보존했다.
- pnpm install --frozen-lockfile 및 pnpm check 통과: 281개 파일, 3,127개 테스트 통과 / 환경 조건부 500개 건너뜀. 포맷·타입·서버/웹 제품 빌드 성공.
- 구성용 더미 로컬 DATABASE_URL을 사용했다. 실제 DB 통합 검사는 활성화하지 않았다. 기존 큰 main chunk 경고는 남아 있다.
- 로그: artifacts/performance/2026-10-22-main-sync-check.log (Git 제외).
- 로컬 main, 실제 문서, 실행 서버는 변경하지 않았다. 원격 push는 수행하지 않았다.
