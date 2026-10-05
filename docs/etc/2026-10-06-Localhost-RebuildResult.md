# 로컬 서버 재빌드·재시작 결과

- [계획](2026-10-06-Localhost-RebuildPlan.md)에 따라 현재 코드를 `pnpm build`로 다시 빌드했다. 전체 패키지 빌드가 성공했다.
- 새 API 프로세스 PID 29508이 `127.0.0.1:3001`에서 실행 중이다. 숨김 백그라운드로 `apps/server/dist/main.js`를 실행했다.
- 새 서버 readiness에서 `native_request_cancellations` 테이블 누락을 확인했다. 기존 마이그레이션 0015는 테이블·외래키·인덱스 추가이며 `pnpm db:migrate`로 정상 적용했다.
- 최종 `/api/health/ready`는 `ready`, `database: connected`, `schema: ready`다.
- http://localhost:3001 응답은 HTTP 200이며 HTML은 재빌드한 파일과 일치한다. JS·CSS 응답의 SHA-256도 새 빌드 파일과 일치한다.
- 코드가 동일하므로 재빌드 후 자산명은 `index-BHorHz3R.js`, `index-COatfdYB.css`로 유지됐다. 앞선 자산명 확인만으로 기존 API의 최신 상태까지 판단했던 기록을 이 결과로 보완한다.
- 실행 로그: `.cache/localhost-20261006-051612.stdout.log`, `.cache/localhost-20261006-051612.stderr.log`.
- 기존 사용자 데이터를 초기화하지 않았으며 브라우저 화면 검증은 수행하지 않았다.
