# 로그인 오류 문구 변경 결과

- 로그인 시 HTTP 409 충돌 및 HTTP 401 인증 실패를 `이미 사용중인 이름이거나 올바르지 않은 PIN 입니다`로 안내하도록 변경했다.
- 영어 번역을 추가했다. 로그인 외의 저장 충돌 및 이름 변경 오류 처리는 유지했다.
- `pnpm format` 적용 후 `pnpm --filter @ezerd/web typecheck`, `pnpm format:check`, `git diff --check` 통과.
