# README 현행화 결과

- 작성일: 2026-10-07
- 계획: [README 현행화 계획](./2026-10-07-README-RefreshPlan.md)
- 대상: [README](../../README.md)

## 반영 내용

- Native 공유 캔버스의 저장 대기 중 이동·셀 편집·Tab 이동, 동기화 중 화면 위치·확대율 유지, 서버 승인 기준 저장 완료를 안내했습니다.
- 더 보기 메뉴의 설계 확인·입력 복구, 원본 보존과 복구 사본의 명시적 저장, ENUM 추가 폼, 전역 실행 취소·히스토리 삭제 복원 동선을 안내했습니다.
- 관련 작업 기록 네 개를 상세 문서에 연결했습니다.
- 사용자 추가 요청에 따라 기존 서술 문장도 ~입니다/~합니다 체로 통일했습니다.

## 검토 근거와 범위

- `6946960`, `e050c52`, `121fc98`, `d3b7a43`과 NativeERDCanvas, NativeCanvasInlineCell, native-ack-entry 구현을 대조했습니다.
- `4b106e8`, `4536b5c`의 NativeCanvasToolbar, NativeEnumDialog, NativeHistoryControls, NativeHistoryDialog, NativeDraftRecoveryPanel 구현과 작업 기록을 대조했습니다.
- `2ca058d`의 장면 측정 재사용은 순수 계산 비교이며 브라우저 성능 보장이 아니므로 README에 속도 수치나 체감 성능 주장을 추가하지 않았습니다.
- `6634d68`의 스크롤 수정과 `af07055`의 개인 화면 안내 DOM 제거를 확인했습니다. 안내 제거는 개인 화면 저장 지원 범위 변경이 아니므로 별도 기능으로 소개하지 않았습니다.
- Node/pnpm 요구 버전과 명령을 루트·서버 package.json, setup 스크립트, compose.yaml, .env.example, Vite 설정과 대조했습니다. 기존 실행 안내는 유지했습니다.

## 검증

- `pnpm format`, `pnpm format:check` 통과. 코드 포맷 변경은 없습니다. Markdown은 저장소의 `.prettierignore`에 따라 자동 포맷 대상에서 제외됩니다.
- README와 이번 계획·결과의 상대 링크 25개 및 README의 pnpm 명령 15개를 검사하여 통과했습니다. `git diff --check`도 통과했습니다.
- 문서 변경만 수행했으므로 앱 테스트·빌드·DB 실행·브라우저 실측은 재수행하지 않았습니다. 기존 기록의 테스트 결과를 이번 실행 결과로 표현하지 않았습니다.
- `docs/EZERD.txt`는 수정하지 않았으며 푸시하지 않습니다.
