# 워크스페이스 없는 사용자 랜딩 안내

## 변경

- 워크스페이스 목록 조회 성공 후 소속 공간이 없으면 랜딩 페이지에 안내 카드와 `워크스페이스 만들기` 버튼을 표시한다.
- 프로젝트 생성에 워크스페이스가 필요함을 한국어·영어로 안내한다.
- 버튼은 기존 워크스페이스 생성 대화상자를 열며, 기존 생성·선택·목록 갱신 흐름을 재사용한다.
- 로그아웃 시 목록 조회 완료 상태를 초기화한다. 기존 공간의 뷰어·보관 상태 안내는 유지한다.

## 검증

- `pnpm --filter @ezerd/web typecheck`: 통과.
- `pnpm exec vitest run apps/web/src/features/projects/ProjectGallery.test.ts apps/web/src/features/workspaces/WorkspacePanel.test.ts`: 12개 테스트 통과.
- `pnpm --filter @ezerd/web build`: 통과. 번들 크기 경고 발생.
- `pnpm format`, `pnpm format:check`: 적용 및 확인.
- 실제 브라우저에서 로그인·생성 동작은 별도로 검증하지 않았다.
