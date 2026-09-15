# 히스토리 동작 필터

작성일: 2026-09-15

계획: `docs/planning/2026-09-15-Editor-DirectEditing.md`.

기존 공통 TabButton으로 전체·추가·수정·이동·크기 변경·순서 변경·삭제 필터를 추가했다. 선택된 동작과 실제 값 변경 조건을 각 변경 항목에 적용한 뒤 빈 편집 기록을 제외한다. 표시 건수도 필터를 통과한 편집 기록 기준이다. 같은 이름을 가진 다른 컬럼 ID는 값이 다르므로 숨기지 않는다.

삭제와 다른 변경이 섞인 편집은 전체 보기에서 모두 설명한다. 삭제 복원은 기존 operationId 콜백을 유지하고 필터 보기에는 해당 편집에서 삭제된 객체 전체에 적용된다는 안내를 표시한다. 미반영 편집의 재적용·복사·폐기와 UUID 숨김은 유지했다.

검증: 회귀 테스트를 먼저 작성했다. pnpm exec는 설치된 vitest 실행 파일을 찾지 못해 실패했으므로 설치된 Node 모듈 경로로 직접 실행했다. 히스토리 패널·라벨 테스트 14개 통과, 모델 빌드 및 웹 TypeScript 검사 통과. 변경 파일은 루트 Prettier 설정으로 포맷하고 검사했다.

추가 브라우저 검증: Browser 스킬의 런타임 연결 및 복구 절차에서 사용 가능한 브라우저가 없음을 확인한 뒤 Playwright Chrome으로 검증했다. `scripts/browser-history-filters-smoke.mjs`는 Vite용 임시 화면을 생성하고 finally에서 제거한다. 이동과 동일한 키 값 변경이 섞인 기록은 전체·이동 1건, 수정 0건이다. 실제 타입·추가·삭제·동일 이름의 다른 컬럼 ID 변경을 추가하면 전체 5건, 수정 2건, 추가·삭제·이동 각 1건이다. 크기·순서 변경은 0건이며 삭제 미리보기와 원 operationId 복원 콜백도 통과했다. 브라우저 오류는 없고 `.cache/history-filters.png`를 확인했다.

재실행: Vite를 5173 포트에 실행하고 `node scripts/browser-history-filters-smoke.mjs`를 실행한다. 기본 playwright 모듈이 없다면 `EZERD_PLAYWRIGHT_MODULE`에 설치된 playwright의 index.mjs file URL을 지정한다. 다른 포트는 `EZERD_WEB_URL`로 지정한다.
