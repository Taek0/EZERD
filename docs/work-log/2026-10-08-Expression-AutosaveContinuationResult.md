# 고급 생성 자동저장 연속 편집 결과

- 날짜: 2026-10-08
- 계획: [고급 생성 자동저장 연속 편집 계획](../planning/2026-10-08-Expression-AutosaveContinuationPlan.md)

## 구현

- `NativeAdvancedEditor.tsx`: 기존 `advanced:index:…:new`, `advanced:expression:…:check:new` 복구 키를 유지한다. 보관된 초안의 ID를 최초 렌더에서 읽고 해당 ID가 현재 문서에 있으면 기존 인덱스·CHECK 대상으로 평가하여 `patch_index`/`patch_check`를 생성한다.
- 상위 마운트 키에서 version/sequence를 제거했다. 사용자·프로젝트·테이블·선택·DB revision·명시 복구 변경의 격리는 유지한다.
- ACK 성공 후 현재 sequence가 제출 기준을 넘기 전에는 저장만 차단한다. 필드 입력은 계속 가능하고 공통 폼이 후속 초안을 보관한다. 한 번 생성되었거나 보관 기록상 존재했던 대상이 없어지면 재생성하지 않는다.
- CHECK 생성 세션은 첫 ACK 이후에도 `replace` 모드를 유지하여 대기 중인 식 입력이 원문 보존 모드로 전환되어 사라지지 않게 했다.
- `native-draft-recovery-target.ts`: 사전 알림 후 수정했다. ACK 후 남은 신규 초안도 같은 테이블·같은 종류·같은 ID의 물리 대상에 한하여 기존 생성 세션으로 복구한다. 다른 테이블·종류·논리 대상 및 변조 ID는 거부한다. 복구 라우팅은 저장을 호출하지 않는다.
- AST 변환·고급 정책 파일·공통 폼·구조 편집·금지된 UI 파일은 수정하지 않았다.

## 검증

- 전용 자동저장 통합 테스트 15개 통과. 실제 NativeEditorForm, useNativeAutosave 타이머, 초안 저장 코드를 committed-hook 드라이버로 연결했다. 브라우저 DOM 테스트는 아니다.
- ACK-first 및 document-first, ACK 전에 입력한 후속 수정, ACK 후 문서 반영 전에 입력한 후속 수정, 연속 patch, 최초 마운트·보관 초안 복구 시 저장 없음, 보관 ID 유지, ACK 후 초안 복구, 거부 ACK, 미완성 토큰 보존, 삭제된 대상의 재생성 방지를 확인했다.
- 관련 회귀 7개 파일 138개 테스트 통과: 자동저장 통합, memo, 고급 UI, 고급 정책, 식 트리 정책, 복구 폼, 복구 대상 라우팅.
- 담당 코드·테스트 4개 파일만 Prettier 검사 및 diff whitespace 검사. 전체 format 미실행.
- 웹 타입 검사 최종 실패: 담당 범위 밖 `NativeERDCanvas.interaction.test.ts:303`에서 TS2339 (`{ x: string; y: string; }`에 `id` 없음). 해당 파일은 수정하지 않았다. 담당 파일의 타입 오류는 보고되지 않았다.
- 통합 의존성: 다른 담당자가 수정한 공통 폼의 ACK 반영 여부 판별(`reflected`)이 현재 initial에 제출 내용이 반영되면 제출 기준 sequence로 ACK를 처리한다. 이 변경과 함께 document-first 회귀가 통과한다. 고급 폼 자체의 저장 차단은 기존 `advanced:` 키의 ACK-before-document 간격을 보완한다.

## 오너 인계

공유 Git index 경합에 대한 오너 조정에 따라 이 추가 작업에서는 `git add`/`git commit`을 실행하지 않았다. 기존 계층화 커밋 `d7df5b3`은 유지한다. 아래 6개 파일을 오너가 검토 후 순차 커밋한다.

- `apps/web/src/features/projects/NativeAdvancedEditor.tsx`
- `apps/web/src/features/projects/NativeAdvancedEditor.autosave.test.ts`
- `apps/web/src/features/projects/native-draft-recovery-target.ts`
- `apps/web/src/features/projects/native-draft-recovery-target.test.ts`
- `docs/planning/2026-10-08-Expression-AutosaveContinuationPlan.md`
- `docs/work-log/2026-10-08-Expression-AutosaveContinuationResult.md`
