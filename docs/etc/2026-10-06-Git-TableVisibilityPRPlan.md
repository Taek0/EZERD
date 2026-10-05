# 테이블 카드 최적화 PR 생성 계획

- 최신 origin/main 1ac4d6d에서 codex/native-table-content-visibility를 생성한다. 기존 병합된 PR #2 제품 worktree를 재사용하며 main/lab은 변경하지 않는다.
- 제품 변경 8355d35(CSS 18줄)와 관련 계획·검증 문서만 선별한다. 계측 도구와 원시는 제외한다.
- 독립 제품 브랜치에서 pnpm check와 diff/문서 링크를 확인한 뒤 별도 원격 브랜치로 push하고 main 대상 PR을 생성한다.
