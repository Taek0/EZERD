# Fresh native 프로젝트 생성 결과

- 작성일: 2026-10-02
- 계획: [NativeProjectCreation](../planning/2026-10-02-Database-NativeProjectCreation.md).
- git add/commit·progress 수정 및 전체 format/check/build는 수행하지 않았다. main이 독립 커밋/브라우저 QA를 진행한다.

## 변경 파일과 동작

- `packages/contracts/src/workspace.ts`, `document.test.ts`: createProjectSchema의 optional `formatVersion: 1 | 2`를 추가했다. 생략한 parse 출력은 이전과 동일하며 unknown document/owner/revision/profile/native boolean 주입은 거부한다.
- `apps/server/src/workspace/workspace.service.ts`: 기존 workspace createProject 권한·row lock·자동 이름·audit transaction 안에서 format2만 DB 기본 context/profile과 `sharedDocument(createEmptyNativeDocument(context))`를 저장한다. 신규 revision/version/sequence는 0이다. legacy DB annotation은 수정하지 않고 native factory를 저장 경계에서 cast한다.
- native source에 domain/table/private view/camera/upgrade ledger를 합성하지 않는다. v1 생략/1은 이전 DB default document를 그대로 사용한다. output project metadata 계약도 유지한다.
- `apps/server/src/mcp/mcp-server.ts`, `test/mcp-server.test.ts`: create_project에 explicit format2·생략/1 v1 호환 및 native 조회/편집 도구 안내를 연결했다. 실제 SDK input schema는 같은 createProjectSchema를 소비한다.
- `apps/server/test/native-project-create.test.ts`, `native-project-create.integration.test.ts`: 서비스와 실제 REST/MCP 생성·권한·기본 상태 회귀 검증을 추가했다.
- `apps/web/src/features/projects/ProjectGallery.tsx`: 신규 생성은 native format2 기본 선택이고 explicit v1 선택도 제공한다. `onCreate(name,databaseKind,{formatVersion})`를 전달하며 기존 metadata 편집에는 형식을 전달하지 않는다.
- 신규 `project-create.ts/test`, `ProjectGalleryCreation.test.ts`: `GalleryProjectCreationOptions` 및 `galleryProjectCreationInput(workspaceId,name,databaseKind,options)`를 제공한다. 생략한 helper 옵션은 최신 gallery의 native2이며 REST 옵션 생략의 v1 정책과 구분된다. callback의 자동 flush/실패 입력·동시 요청 보호를 검증한다.
- App/NativeProjectView는 직접 수정하지 않았다. main이 App.createGalleryProject를 해당 options 및 helper 검증 POST로 연결했다고 확인했다. public index, model/typeflags/DB schema/다른 담당 파일은 수정하지 않았다.

## 검증

- source alias targeted 7파일 **35개 통과**: 생성 계약, native factory 서비스, MCP 등록/호환, gallery body helper·실제 callback 및 기존 갤러리/자동 이름 회귀.
- `ProjectGalleryCreation.test.ts`의 자기 typeof props 참조 TS2502는 명시 ComponentProps 타입으로 해소했다. 담당 web/server/계약과 transitive 최신 source의 scoped noEmit typecheck 통과.
- disposable `ezerd_qa_*` DB에서 migrations 후 최신 소스 AppModule의 실제 REST/MCP 테스트 **13개 통과**. 세 DB native factory/context/profile/revision/version/seq 저장, native versioned 조회와 v1 API 거부, omitted/explicit v1 생성 호환, usable false, implicit private row/upgrade ledger 없음, 사용자별 personal camera 분리, viewer/outsider/archived 거부·editor audit/owner 유지, native/v1 혼합 동시 자동 이름·gallery preview, strict 주입 거부를 확인했다.
- 실제 MCP create_project로 세 DB native 생성 후 get_project_document_state 조회 및 첫 add_domain 저장을 upgrade 없이 성공시켰다. MCP format 생략은 v1을 유지한다.
- 변경 파일만 Prettier 적용/확인 및 범위 diff whitespace 확인. 별도 공유 build나 전체 build/check는 실행하지 않았다.

## main 인계·한계

- main 실제 소비: App callback의 formatVersion/helper POST를 연결했다. targeted5파일27개, 실제 isolated AppModule 생성13개 및 web build 통과. 브라우저에서 전용 owner로 로그인해 Native 기본 format2 PostgreSQL 프로젝트를 생성하고 versioned native 화면을 열었다. 새 프로젝트의 물리 기능 gate는 아직 비활성이며 C5 성공 SQL로 계산하지 않는다. 추가 DB/legacy 선택 및 전체 QA는 BrowserPathQA에 기록한다.

- App callback은 main 연결 완료. helper 호출 순서는 `(workspaceId,name,databaseKind,options)`이며 options는 gallery onCreate 세 번째 인자다.
- 최신 갤러리/browser 실제 생성→열기/DB 선택/legacy 선택 및 actor/workspace 이동 중 응답 반영은 main 최종 browser QA가 필요하다. 이 단위는 DOM 없는 callback 검증과 실제 HTTP/MCP를 수행했으며 브라우저는 실행하지 않았다.
- native 생성은 빈 설계의 저장 경계만 연결한다. capabilities의 usable/coverage flags는 변경하지 않았으며 미검증 물리 기능·DDL 또는 전체 native 기능 완료를 주장하지 않는다. REST는 explicit formatVersion2를 보내지 않는 기존 클라이언트에 v1을 계속 제공한다.
