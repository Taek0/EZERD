# PK → FK 생성 대화상자 편집

- 자동 생성되는 FK 물리 컬럼 이름을 기본값 그대로 입력란에 표시한다. PK 선택별 초안을 유지하고, 외부 문서 변경이 입력 중인 이름을 덮어쓰지 않는다.
- 양쪽 대응관계를 선택한다. PK 쪽은 0..1 / 1, FK 쪽은 0..1 / 1 / 0..N / 1..N이며 기본은 1 / 0..N이다.
- PK 쪽 최소값은 새 FK 컬럼 NULL 허용에 반영한다. FK 쪽 최대 1은 FK 컬럼 묶음에 UNIQUE 키를 추가하며 대화상자에서 이를 안내한다. FK 최소 1은 모델 표기로 보존하며 FK 제약 자체로 강제되지 않는다는 안내를 제공한다.
- 이름 공백·중복·기존 컬럼명 충돌·NUL·120자 초과를 차단한다. 컬럼 추가, 이름 변경, 대응관계와 UNIQUE 키를 한 번의 onChange로 저장한다.
- 저장 방향은 기존 SQL FK 방향(자식 source → 부모 target)을 유지한다. UI의 PK 쪽은 targetCardinality, FK 쪽은 sourceCardinality에 대응한다.
- 검증: foreign-key-draft.test.ts 3개 통과, 웹 TypeScript 검사 통과, 변경 파일 Prettier 적용 및 확인. pnpm exec는 이 세션에서 실행 파일 탐색 실패하여 설치된 node_modules의 Prettier/Vitest 진입점을 node로 직접 실행했다.
