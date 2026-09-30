# Docker Desktop 소켓 및 개발 DB 실행 복구

## 원인과 변경

- Docker Desktop 프로세스가 종료된 상태에서 dockerInference 소켓 접근 오류가 재발했다.
- 런타임 폴더를 삭제하지 않고 아래 경로로 백업한 뒤 Desktop을 재시작했다.
  - C:/Users/nty43/AppData/Local/Docker/run.ezerd-backup-20260914-181449
  - C:/Users/nty43/AppData/Local/docker-secrets-engine.ezerd-backup-20260914-181449
- Docker 엔진 복구 후 기존 DB 포트 55432가 Windows TCP 예약 범위 55390–55489에 포함되어 바인딩에 실패했다.
- 루프백 포트 15432의 바인딩 가능 여부를 확인하고 로컬 .env의 POSTGRES_PORT와 DATABASE_URL 포트를 함께 15432로 수정했다. .env는 커밋하지 않는다.
- Compose가 컨테이너를 재생성했고 기존 .data/postgres 데이터 경로를 유지했다. 이미지·볼륨·DB 데이터 초기화는 수행하지 않았다.

## 검증과 실행 안내

- docker info: 서버 버전 29.6.2 응답.
- pnpm db:up: PostgreSQL healthy.
- pnpm db:check: 연결, 마이그레이션, Drizzle INSERT/SELECT 및 롤백 검증 통과.
- 현재 개발 DB 주소: 127.0.0.1:15432. 저장소 기본 예제 포트는 55432로 유지한다.
- 프로젝트 루트에서 pnpm dev를 실행한다. 이미 실행 중인 개발 서버는 변경된 환경 변수를 읽도록 재시작한다.
- 재부팅 후 Docker 소켓 오류 재발 여부는 확인하지 않았다.
- 기존 문서 재분류 등 이번 복구와 무관한 작업 트리 변경은 커밋에 포함하지 않았다.