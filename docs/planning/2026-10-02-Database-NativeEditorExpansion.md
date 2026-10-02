# Native 편집 UI 확장 계획

- 작성일: 2026-10-02
- 기준 HEAD: `0edbd16`
- 기준: [승인 명세](2026-10-01-Database-CapabilitySpecification.md), [타입·기능 지원표](2026-10-01-Database-TypeFeatureMatrix.md), [진행 기록](../work-log/2026-10-01-Database-ImplementationProgress.md).
- 범위: 독립 C4 native structured forms, 편집 명령 계약, native MCP/REST 명령 소비. 사용자 지시에 따라 커밋은 메인 통합 담당자가 수행한다.

## 구현

1. strict 생성/부분 patch 계약을 웹 pending 및 MCP 명령에 공통 적용한다. 테이블/컬럼/키/index/check/ENUM/FK 및 삭제는 native 문서를 직접 소비한다.
2. 프로젝트 DB 카탈로그의 타입·파라미터·기능 합집합을 표시한다. 기존 값과 unsupported/미검증 사유를 유지하며 coverage/fixtures를 변경하거나 검증되지 않은 물리 기능을 일반 활성화하지 않는다.
3. 기본 속성 draft를 유지하고 추가 구조 입력도 user/project/object와 version/sequence/revision 기준으로 보관한다. 승인 ACK에 대응하는 입력만 제거하고 늦은 ACK·다른 탭의 새 입력을 보호한다.
4. 서버 replay-before-validate, expected version/sequence/revision, 최종 후보 검증, 신규 legacy 및 retired ID 보호를 유지한다. 기존 model helper를 소비하며 model 파일은 수정하지 않는다.

## 경계와 검증

- 담당 파일: `NativeProjectView.tsx`, `NativePropertyEditor.tsx`, `native-save.ts/test`, 새 `native-editor-*` 파일, contracts `native-edit.ts` 및 새 `native-editor-command*`, 서버 `mcp-native-document.service.ts` 및 native-command 전용 테스트.
- DDL/validation/model/index exports/App.tsx/다른 서버 transfer 및 progress 파일은 변경하지 않는다. v1 ERD 투영을 추가하지 않는다.
- 변경 파일만 Prettier 적용/확인, 관련 Vitest 및 package typecheck를 수행한다. 전체 format/check/build와 browser QA는 메인 통합 담당자가 수행한다.
- 결과는 `docs/work-log/2026-10-02-Database-NativeEditorExpansion.md`에 기록한다. 전체 DB 기능 완료를 주장하지 않는다.
