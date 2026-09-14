# Docker Desktop 소켓 오류 복구 계획

- 시작 중 dockerInference 소켓 접근 오류로 Linux 엔진이 실행되지 않는다.
- 기존 SETUP_VERIFICATION 기록과 동일한 소켓 오류가 재발했다.
- Docker 프로세스가 종료된 상태를 확인하고 LocalAppData의 Docker/run 및 docker-secrets-engine 런타임 폴더를 고유한 백업 이름으로 변경한다.
- Docker Desktop을 재시작하여 엔진 응답과 pnpm db:up의 PostgreSQL healthy 상태를 확인한다.
- 이미지, 컨테이너, 볼륨, 프로젝트 DB 데이터는 초기화하지 않는다.