# 고화질 PNG 테이블 타입 보존

- 원인: PNG 내보내기가 복제 DOM의 모든 버튼을 제거하면서 테이블 타입 편집 버튼 안의 표시 문자열도 삭제했다.
- 기존 타입 셀에 `data-export-text`로 저장된 모델의 전체 타입 표시를 전달하고, 계산된 스타일을 복사한 후 복제본의 해당 셀만 정적 텍스트로 변환한다. 화면의 입력 상태나 모델은 변경하지 않는다.
- 타입 편집 중에도 검색어·입력 컨트롤·선택 목록 대신 확정된 타입을 출력한다. 길이, 정밀도, 배열 및 사용자 정의 ENUM 이름을 보존한다.
- 폰트 서브셋 판정은 변환된 복제본의 텍스트를 사용하여 편집 중 화면에 없던 저장된 타입 이름도 포함한다.
- 검증: 타입 셀 SSR 및 DOM 대역 회귀 테스트를 포함한 2개 파일, 22개 테스트 통과. 웹 TypeScript 검사 통과. 변경 코드 Prettier 적용 완료.
- 도구 검증은 `node node_modules/vitest/vitest.mjs run apps/web/src/features/canvas/canvas-export.test.ts apps/web/src/features/tables/TableEditor.test.ts`, `node node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit`로 수행했다. 최초 `pnpm exec vitest` 호출은 실행 파일 연결 문제로 실패하여 같은 설치본의 진입점을 직접 실행했다.
- 전체 `pnpm format:check`의 최초 실행에서는 브라우저 검증용 임시 파일 `apps/web/__png-type-qa.html`만 포맷 경고가 발생했다. 최종 검증에서는 임시 파일 정리 후 다시 확인한다.
