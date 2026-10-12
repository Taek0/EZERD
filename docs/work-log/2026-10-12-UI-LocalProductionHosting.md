# 로컬 프로덕션 호스팅 결과

- 날짜: 2026-10-12
- 디자인 구현 기준 커밋: 3ed3d3e (codex/apple-ui-review).
- pnpm build 전체 패키지 빌드 성공. Vite 대형 청크 경고는 기존과 동일하다.
- 접속 주소: http://127.0.0.1:3002/
- 프로덕션 Node 서버 PID: 8224. 127.0.0.1에만 바인딩한다.
- 워크트리의 apps/server/dist 및 apps/web/dist를 제공한다. 샘플 화면이 아닌 실제 제품이며 기존 로컬 DB에 연결한다.
- 기존 D:/Code/EZERD/.env를 프로세스에서 읽고 HOST, PORT, NODE_ENV를 덮어쓴다. 별도 서버 MCP는 비활성화한다. 환경 파일과 스키마는 변경하지 않았다.
- GET /api/health/ready: 200, database=connected, schema=ready.
- 루트 HTML, 참조된 JS 및 CSS: 모두 HTTP 200.
- 기존 3001 서버는 유지한다. 사용자 편집/저장은 연결된 기존 로컬 DB에 반영된다.
- 재실행은 워크트리 apps/server에서 dotenv로 기존 환경 파일을 읽은 후 NODE_ENV=production, HOST=127.0.0.1, PORT=3002, MCP_ENABLED=false 및 MCP_PUBLIC_URL 제거 상태로 dist/main.js를 실행한다.
- [계획](../planning/2026-10-12-UI-LocalProductionHostingPlan.md)
