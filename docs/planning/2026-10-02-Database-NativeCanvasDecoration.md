# Native domain relation·PNG·공통 스타일 계획

- 작성일: 2026-10-02
- 목표: native 원문으로 domain relation lifecycle, 공통 카드 스타일 및 PNG 내보내기를 실제 canvas/structured command에 연결한다.
- 범위: 새 native domain-relation/style/export UI·helper·tests 및 계약/candidate helper. 기존 NativeERDCanvas와 실제 MCP native renderer/metadata는 작은 연결 hunk만 추가한다. App/NativeProjectView, advanced expression tree/private/draft 복구, validation/typeflags/index-policy는 수정하지 않는다. 커밋과 전체 build/browser QA는 main 담당이다.

## 구현

1. domain relation 추가·엄격 부분 patch·삭제를 기존 shared model upsert/remove helper와 native ordinary claims/refs/retired/revision 정책으로 처리한다. model API의 v1 전용 선언은 main에 CanvasDocument generic 확장을 요청한다. 현재 구현은 CanvasDocument만 읽는 기존 함수의 호출 시그니처에 한정한 bridge를 사용하고 native 결과를 다시 검증한다. source document를 v1으로 투영하거나 physical 값을 재해석하지 않는다. model 파일은 수정하지 않는다.
2. 도메인 관계는 기존 공통 layoutDomainRelations로 overview card 사이 경로/방향/label을 표시하고 선택하여 편집한다. row 이동/geometry는 기존 native scene을 소비한다.
3. 공통 스타일은 table/domain/shared note의 색상 설정·초기화와 table의 nullable/comment 표시만 제공한다. 기존 모델 update helper와 ordinary structured commands를 사용하고 namespace/default/generation·legacy payload를 보존한다. 고급 스타일/DB 옵션과 섞지 않는다.
4. PNG는 같은 native scene 및 domain 관계 geometry, native label/style helper를 소비하는 SVG에서 browser image/canvas로 만든다. raw/native 값을 v1/SQL로 바꾸거나 camera/private 상태를 공유 저장하지 않는다. 이미지 크기 한도를 검증하며 다운로드 전에 actor/project/revision 문맥을 다시 확인한다. readonly도 내보내기를 할 수 있지만 저장 동작은 없다.
5. 새 UI는 기존 NativeEditorForm/draft/ACK/pending/readonly를 소비한다. schema/claims/source context와 failed storage/export guard는 유지한다. main/다른 agent의 NativeERDCanvas private 변경은 덮어쓰지 않는다.

## 검증

- source alias targeted 계약/candidate/UI/geometry/PNG tests: partial patch, missing endpoints/ID reuse, legacy 원문/physical 필드 불변, 공통 스타일 reset, XML escaping/크기/문맥 취소, readonly/pending 및 기존 scene 회귀.
- 가능한 disposable QA DB에서 실제 REST/MCP domain relation/style 저장과 retired ID/권한 보호 확인. PNG 실제 브라우저 pixel/download QA는 main이 수행한다.
- 변경 파일 Prettier/scoped typecheck만 수행하며 전체 check/build/format 및 git add/commit은 하지 않는다.
