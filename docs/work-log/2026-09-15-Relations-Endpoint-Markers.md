# 관계 끝점 표시 변경 결과

- 끝점의 표시를 반지름 4 채운 점으로 변경하고 반지름 10 투명 포인터 영역을 유지했다.
- 키보드 조작과 접근성 이름을 그룹 요소에 유지했다.
- `node node_modules/vitest/vitest.mjs run apps/web/src/table-relations-sync.test.ts`: 9개 통과.
- pnpm exec vitest는 로컬 실행 파일 래퍼 누락으로 실패해 동일 설치본의 진입점을 직접 실행했다.
