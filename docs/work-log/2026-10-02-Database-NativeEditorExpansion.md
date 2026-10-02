# Native 구조 편집 UI 확장 결과

- 작성일: 2026-10-02
- 계획: [Native 편집 확장](../planning/2026-10-02-Database-NativeEditorExpansion.md).
- 범위: 독립 C4 native 편집 소비. 사용자 지시대로 git add/commit, progress 갱신 및 브라우저 QA는 메인 통합 담당자에게 남긴다.

## 구현 범위

- `NativeProjectView.tsx`/`NativePropertyEditor.tsx`: native 구조 편집과 형식 편집 연결. user/project 변경 시 입력 컴포넌트를 분리하고 이전 요청의 늦은 응답이 다른 프로젝트 UI 상태를 바꾸지 않도록 보호한다. 기본 속성 form/draft는 계속 독립적으로 유지한다.
- `native-editor-command.ts`/`native-edit.ts`: 웹 pending과 실제 REST/MCP의 공통 strict 명령. 테이블/컬럼/키/index/check/ENUM/FK 생성, 객체별 부분 patch, 명시 삭제 및 기존 PK 파생 FK를 소비한다. ZodPipe의 `.in.shape`에서 저장 구조를 재사용하고 model 출력 타입을 명시한다. 별도 index export 변경은 하지 않았다.
- `mcp-native-document.service.ts`: native 후보를 원자적으로 구성하고 기존 locked sync 검증/retired ID 경로로 전달한다. replay-before-validate, version/sequence/revision 기대값과 최종 후보 검증은 유지한다. 신규 legacy 추가 및 같은 batch에서 삭제 후 ID 재사용도 거부한다.
- `native-editor-structure.tsx`: 구조화된 생성·기존 제약 이름/필드 patch 및 삭제 영향/차단 표시. 컬럼 순서, 참조 컬럼 순서와 generated-column 연쇄 삭제를 명시적으로 다룬다. CHECK/generated의 식 입력은 컬럼 ID + 연산자 + typed literal 비교식으로 구성한다. 수정하지 않은 복합 AST/index part/옵션은 보존한다.
- `native-editor-policy.ts`/`native-editor-format.tsx`/`native-editor-expression.tsx`: 프로젝트 DB 카탈로그를 소비한 타입 합집합과 타입별 파라미터, 배열, 기본값, generation, namespace/charset/collation/STRICT/WITHOUT ROWID 표시 및 native patch 구성. 현재 값과 unsupported/미구현·미검증 사유를 표시한다. 타입 변경 후 기본값/generation/ON UPDATE 제거는 명시 확인을 요구한다.
- `native-editor-draft.ts`/`native-editor-form.tsx`/`native-save.ts`: 추가 입력의 미완성 token까지 user/project/form별 보관한다. 변경 입력과 `before`를 분리하여 명시 비교 때만 최신 내용에 rebase하며 생성 ID는 보존한다. DB revision 변경은 자동 rebase하지 않는다. pending은 draft revision을 기억하고 accepted ACK는 해당 revision만 정리한다. 다른 탭의 새 입력과 별도 기본 속성 draft는 유지한다. ACK actor/operation/group/revision/sequence도 확인한다.

## 검증

- 대상 Vitest 7개 파일: **44개 통과**. 새 계약, 서버 candidate/replay/expectations, 세 DB 카탈로그 비활성·현재 값 표시, 구조 helper, 부분 patch 보존, 미완성 draft/rebase, pending/ACK/다른 탭 보호 및 기존 조회/기본 속성 회귀를 포함한다.
- contracts typecheck 통과. shared dist barrel의 실제 Node runtime import 및 `patch_key` 파싱 성공을 확인했다.
- 서버는 최신 contracts/model 소스를 paths로 직접 참조한 임시 설정으로 typecheck 통과했다. main shared build와 병렬 작업 중 오래된 dist 선언을 읽지 않도록 확인했다.
- 웹도 최신 contracts/model 소스를 직접 참조하여 typecheck 통과했다. 변경 코드 파일 17개에 한해 Prettier 적용/확인을 완료했고 기존 수정 파일의 `git diff --check`도 통과했다.
- 전체 format/check/build, 실제 DB/HTTP/MCP 통합 및 browser QA는 이 단위에서 실행하지 않았다. 이미 완료된 fixture/coverage 상태도 바꾸지 않았다.

## 남은 범위와 통합 안내

- **모든 coverage false를 유지한다.** 신규 물리 테이블/컬럼/키/index/check/ENUM/FK 사용은 UI와 helper에서 gate로 차단한다. 논리 테이블/컬럼 초안의 실제 native 저장, 기존 속성 patch 및 삭제는 연결했다. 물리 신규 명령의 계약/후보 구성은 준비됐지만 실제 활성화/실행 보장은 후속 수직 검증의 책임이다.
- full native ERD canvas, clipboard, history/undo, native export 공유 메뉴와 browser/실제 REST·MCP QA는 후속 단위다. v1 ERD 투영은 추가하지 않았다.
- 임의 SQLite declared/untyped 선택은 별도 카탈로그 coverage 항목/API가 없어 활성화 준비 지점에서 차단한다. 기본값 임의 SQL/builtin 함수 편집, MySQL ON UPDATE 신규 입력, identity sequence 세부 옵션, 복합 AST 편집 및 고급 index/key 옵션 입력은 완전 구현하지 않았다. 기존 데이터는 표시·보존한다. main에는 이들 객체별 option/default 지원 결정을 제공하는 model API가 후속 필요함을 알린다.
- model/validation/DDL/App.tsx/app.module/index exports/다른 transfer 파일 및 `docs/EZERD.txt`/progress는 이 담당자가 수정하지 않았다. 독립 커밋 대상은 위 구현·관련 테스트와 planning/work-log 문서다.

전체 DB native 기능 완료를 주장하지 않는다. 본 단위는 실제 native 편집 소비와 보호 흐름을 전진시킨 제한된 C4 확장이다.

## 메인 통합 확인

- 최신 shared emit과 실제 AppModule을 포함한 `pnpm check`가 포맷/타입/빌드 및 1041개 테스트 통과/89개 건너뜀으로 완료됐다. 이후 세 DB의 구조 명령 실제 생성/삭제 테스트 3개를 추가했다.
- 실제 HTTP에서 세 DB native 논리 테이블+컬럼을 batch 생성하고 기존 물리 legacy 원본을 보존했다. 같은 batch의 삭제 후 ID 재사용을 차단하고 명시 삭제는 저장했다. versioned/API/transfer 통합 61개 통과. 앞 전체 API/MCP/autosync/versioned/transfer/DDL 통합 72개도 통과했다.
- 브라우저에서 확장 형식/구조 UI의 최종 QA는 전체 활성화·ERD 후속 단위와 함께 수행한다. helper/통합 논리 생성 검증을 미검증 물리 기능의 사용 가능 증거로 계산하지 않는다.
