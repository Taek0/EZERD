# 호스팅 DB 자동 준비 반영

- pnpm host 별칭을 추가하고 host:start를 setup → db:ensure → build → db:migrate → host-lan 순서로 변경했다.
- db:ensure는 docker compose up -d --no-recreate --wait --wait-timeout 90 postgres를 사용한다. 기존 Compose postgres는 재사용/시작하고 없으면 생성한다. 기존 db:up은 명시적 구성 변경 반영용으로 유지한다.
- 기존 .env를 보존하며 DB health가 준비돼야 빌드/마이그레이션을 진행한다. Docker 및 의존성 설치는 사전 준비가 필요하다. host:serve는 변경하지 않았다.
- 실제 실행 중인 ezerd-dev-postgres-1에서 pnpm setup 및 db:ensure 검증: 기존 .env 보존, 컨테이너 ID 동일, StartedAt 동일, healthy. DB 재생성·재시작 없음.
- 중지/미생성 상태는 Docker Compose 표준 동작을 이용한다. 실제 사용자 DB를 중지하거나 삭제하여 시험하지 않았다. 기존 호스팅 프로세스와 충돌하지 않도록 전체 host 실행은 하지 않았다.
- package.json Prettier 및 git diff 검사 통과. README와 LAN 호스팅 안내를 갱신했다.

근거: https://docs.docker.com/reference/cli/docker/compose/up/
