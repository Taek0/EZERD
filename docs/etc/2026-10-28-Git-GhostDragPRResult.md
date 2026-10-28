# 고스트 드래그 PR 결과

- 원격 main 42a6cb5 기준 제품 브랜치 codex/ghost-drag-worker를 생성하고 고스트 드래그 제품 변경만 선별했다.
- PR: https://github.com/Taek0/EZERD/pull/18 (base: main). lab fixture·측정 도구와 별도 관계선 자동 정렬 변경은 제외했다.
- 제품 브랜치 포맷·타입·3,192테스트·서버/웹 빌드 검증 완료. 환경 조건부500개 테스트는 건너뛰었다. 첫 폰트 캐시 timeout은 전체 재실행으로 통과했다.
- 테스트의 lab 의존성 제거와 문서 링크 수정은 performance-lab에도 21d06f8로 반영했다.
- performance-lab은 별도 원격 브랜치에 push한다. 로컬 main checkout과 기존 서버는 변경하지 않았고 PR은 병합하지 않았다.
