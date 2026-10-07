# Native 전용 App과 미사용 v1 UI 제거

- [계획](../planning/2026-10-07-Legacy-NativeOnlyEditorPlan.md)의 단위 2 완료. [진입 차단](2026-10-07-Legacy-NativeOnlyEntryResult.md)에 이어 도달 불가능해진 App 연결을 제거했다.
- App에서 v1 Canvas 렌더링, 기존 autosave/IME draft/rebase, ProjectSyncRuntime 생성·종료, 기존 history·undo/redo, v1 댓글 패널 상태를 제거했다. App은 갤러리와 NativeProjectView를 표시한다.
- Native 알림 이동은 nativeCurrent의 프로젝트 ID로 같은 프로젝트 여부를 판단하고 Native 리뷰로 전달한다. Native 새로고침·ACK·내보내기 경로, 워크스페이스·로그인 관리와 갤러리는 유지했다.
- 로그인에 쓰이는 SyncSession 타입을 shared/api/session.ts로 옮겼다. 기존 sync-client는 호환 re-export를 유지하지만 앱은 해당 모듈에 의존하지 않는다.
- 참조가 끊긴 NativeUpgradeButton.tsx(314줄), 전용 테스트(83줄), App v1 autosave 전용 테스트(37줄)를 제거했다. native-upgrade 서비스 로직·서버 변환 API·파일 호환 처리는 유지했다.

## 검증

- pnpm format, pnpm format:check, pnpm typecheck, pnpm build, git diff --check 통과.
- pnpm test: 227개 파일 통과, 27개 파일 건너뜀. 2,814개 테스트 통과, 506개 건너뜀. 별도 DB 통합 환경이나 브라우저 수동 QA는 실행하지 않았다.
- 진입 경계에서 active/archived v1 및 Native 미리보기가 있는 v1을 거부하고 원본을 변경하지 않는지 검사했다. 갤러리 v1 로딩이 복구 큐 접근·쓰기 전에 실패하는 회귀 테스트도 추가했다.
- main.tsx에서 시작하는 로컬 런타임 import 그래프의 회귀 테스트로 NativeProjectView·NativeERDCanvas 연결과 기존 Canvas·sync-client·sync-history-panel·NativeUpgradeButton 비연결을 확인했다. 정적 리터럴 경로 기준이며 계산된 동적 경로·외부 패키지 내부까지 분석하지 않는다.
- 직전 빌드 대비 출력: JS 1,978.41→1,753.51kB(gzip 556.39→497.30kB), CSS 153.88→130.35kB(gzip 29.73→25.51kB), 모듈 1,664→1,627개. 빌드 출력 비교이며 브라우저 성능 실측값은 아니다. Vite 500kB 청크 경고는 남는다.

## 남은 코드와 다음 제거 경계

- Canvas.tsx는 운영 앱에서 분리됐지만 browser-canvas-feedback, browser-delete-shortcut, browser-density-editor 등 기존 QA 스크립트가 직접 import한다. 관련 테스트·QA 스크립트를 함께 폐기하거나 Native 검증으로 대체하는 별도 단위가 필요하다.
- sync-history-panel은 browser-history-filters-smoke 스크립트와 테스트가 사용한다. sync-client는 해당 패널의 타입 참조와 combined-route-edit 등의 테스트가 사용한다. 앱에서 빠졌다는 이유로 이 소비자를 깨뜨리지는 않았다.
- relation-routing, domain-relations, 공유 모델·계약은 Native 재사용 여부를 계속 확인해야 한다.
- 서버 v1 API/MCP와 갤러리 메타데이터 관리·파일 import/export는 여전히 존재한다. 이번 완료 범위는 웹의 v1 편집기 진입 및 연결 제거이며, 서버 차원의 v1 쓰기 금지까지 완료했다는 의미는 아니다.
- 사용자 DB, 기존 저장 문서, docs/EZERD.txt는 변경하지 않았다.
