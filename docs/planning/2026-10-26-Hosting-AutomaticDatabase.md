# 호스팅 DB 자동 준비

- pnpm host와 기존 host:start에서 setup → DB 준비/health 대기 → build → migrate → host 순으로 실행한다.
- Compose postgres 서비스가 있으면 재생성하지 않고 재사용·시작하며 없으면 생성한다. 데이터 디렉터리와 기존 .env는 유지한다.
- Docker Engine/Compose 및 pnpm install은 사전 준비가 필요하다. host:serve는 기존 사전 빌드 실행 동작을 유지한다.
