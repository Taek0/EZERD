# ENUM 및 히스토리 UI 개선 결과

계획: [EnumHistoryUIPlan](../../docs/planning/2026-10-08-Editor-EnumHistoryUIPlan.md)

## 변경

- NativeEnumDialog.tsx / native-enum-dialog.css: 설명·목록 제목·생성/편집/삭제 확인 제목·대상 이름·편집 영역 닫기를 추가했다. 선택 ENUM 강조 및 편집 버튼 aria-pressed, 입력값 행의 이동/삭제 버튼 정렬, 목록과 값 편집 영역의 높이 제한·스크롤, 삭제 영역 경계를 적용했다.
- NativeHistoryDialog.tsx: 불러온 이력의 복사본만 sequence 내림차순으로 정렬한다. 원본 page.history, nextSince, 설명 생성용 이력, undo/redo 후보 순서는 유지한다. 최근 편집 순 안내와 키보드 포커스 가능한 이력 목록을 추가했다.
- NativeHistoryControls.tsx / native-history-dialog.css: 히스토리 팝오버 최대 높이 620px, viewport 기반 높이 제한, 이력·펼친 변경 목록의 내부 스크롤을 적용했다. 필터 Select는 기존 공통 컴포넌트의 256px 제한을 유지한다.
- NativeEnumDialog.test.ts / NativeHistoryDialog.test.ts / NativeHistoryControls.test.ts: ENUM 편집·삭제 전환 및 닫기, 표시 순서와 원본/cursor 비변경, undo 후보 최신 작업 우선 회귀를 추가했다.
- 공용 validation/구조 편집/삭제 폼을 재사용했다. NativeProjectView/advanced/property/canvas 공용 파일 및 docs/EZERD.txt는 이 작업에서 수정하지 않았다.

## 검증

- 담당 및 관련 6개 테스트 파일 36개 통과: NativeEnumDialog, NativeHistoryDialog, NativeHistoryControls, native-history, native-history-filters, native-label-draft.
- 추가 native-editor-ui.test.ts 포함 실행: 47개 중 43개 통과, 4개 실패. PostgreSQL/MySQL/SQLite 타입 입력의 INTEGER/INT 기대와 현재 TEXT 표시 불일치 3건, 논리모드 생성 안내 문구 기대 불일치 1건이다. 병행 작업 중인 공용 파일 관련이므로 수정하지 않았다.
- 웹 tsc --noEmit 최종 실행: 담당 파일 진단 없음. 범위 밖 native-property-layout.test.ts:13의 metadata 속성 참조 오류로 전체 검사는 통과하지 못했다.
- 담당 코드 8개 파일 Prettier 검사 및 git diff --check 통과. 문서는 저장소 .prettierignore 대상이다.
- pnpm은 sandbox realpath EPERM, sandbox Vitest는 임시 캐시 ENOENT가 발생했다. 설치된 Node 및 로컬 Prettier/Vitest/TypeScript를 직접 실행했으며 테스트·타입 검사는 sandbox 밖에서 재검증했다. 의존성을 설치하지 않았다.
- 브라우저 실제 화면 육안 검증은 수행하지 않았다. SSR 및 로직 회귀 검증 결과이며 UI 최종 통합 확인은 필요하다.
- 사용자 지시에 따라 Git add/commit은 실행하지 않았다. 워킹 트리의 다른 변경은 병행 작업 소유다.
