# Fresh native 프로젝트 생성 경로 계획

- 작성일: 2026-10-02
- 목표: 업그레이드 없이 새 native 프로젝트를 REST/gallery/MCP에서 생성하고 기존 v1 클라이언트 계약을 보존한다.
- 범위: contracts createProjectSchema/테스트, WorkspaceService 생성 분기/관련 테스트, create_project MCP 안내/계약 소비, ProjectGallery 생성 형식 선택과 callback helper/테스트, 이 계획과 결과. App/NativeProjectView, DB schema/모델/usable flags 및 다른 담당 변경은 수정하지 않는다. 커밋은 main 담당이다.

## 구현 정책

1. formatVersion optional 1|2를 추가한다. 생략/1은 기존 v1 생성이며 parse 출력/이름/DB 기본값은 기존 계약을 유지한다. 최신 갤러리는 2를 기본으로 명시하고 v1을 선택할 수 있다.
2. format2는 기존 DB context resolver/default profile과 createEmptyNativeDocument factory를 소비한다. DB revision/version/seq는 신규 0이다. 임의 입력 document/owner/권한/revision 주입을 허용하지 않는다.
3. native source는 sharedDocument로 camera/private state를 제거한다. 도메인/테이블/개인 combined view/ledger/upgrade 데이터를 새로 합성하지 않는다. 빈 설계의 사용자별 camera는 기존 PersonalStateService가 제공한다. v1 저장 기본 문서는 그대로 유지한다.
4. workspace createProject 권한·row lock·자동 이름 할당·audit·ownership과 모든 쓰기는 기존 transaction을 사용한다. native 생성으로 capabilities usable/physical coverage를 켜지 않는다.
5. create_project MCP에 format2/생략 v1의 차이와 native 조회/편집 도구를 안내한다. output project metadata 계약은 보존한다.
6. ProjectGallery onCreate 세 번째 options 인자로 formatVersion을 전달한다. main은 App.createGalleryProject에서 옵션을 POST body에 전달하고 actor/workspace 응답 문맥을 확인한다. 부모 소유 파일은 직접 편집하지 않는다.

## 검증

- targeted 계약/서비스/gallery/MCP 테스트: v1 생략 호환·엄격 입력, native 기본 옵션/explicit v1, 초기 factory/context와 기본 domain/private state, auto names/역할/보관 제한.
- disposable QA DB에서 실제 REST/MCP native 생성, 문서 저장·versioned 조회·legacy API 거부·usable false, 기존 v1 생성·자동 이름/워크스페이스/권한과 개인 camera 읽기 검증.
- changed-file Prettier와 scoped source typecheck만 수행한다. 전체 format/check/build·git add/commit·실제 browser QA는 main 담당이다.
