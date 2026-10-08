# 자동저장 회귀 테스트 갱신 결과

- 작성일: 2026-10-08
- 계획: [자동저장 회귀 테스트 갱신 계획](../planning/2026-10-08-Editor-AutosaveRegressionPlan.md)

## 변경

- NativeERDCanvas: 수동 제출 버튼 기대를 자동저장 UI와 clean/dirty export blocker 및 복구 초안 보관 검증으로 갱신했다. LAN UUID, 권한, 개인 화면, storage failure 검증은 유지했다.
- condition hints: 6가지 제한된 기본값에 실제 NativeFormatEditor/NativeEditorForm field callback, fake timer, 재렌더를 적용했다. mount와 입력 이후 및 unmount 시 저장되지 않고 원문·revision·dirty export 차단이 유지되는지 확인했다.
- clipboard: busy fieldset, readonly/archive, 내구성 및 ACK 보호 검증을 유지하고 수동 submit 버튼 기대만 자동저장 UI에 맞췄다.
- clipboard interaction: useLayoutEffect와 의존성 없는 effect를 mock driver에 지원했다. 검토 전 미전송, 검토 후 299ms 미전송/300ms 정확히 한 번 전송, 새로운 입력의 revision·값 보존과 ACK 후 baseline 갱신을 검증했다. busy 상태와 복구 mount에서 미전송, late Clipboard API read 보호도 검증했다.
- canvas decoration: busy fieldset 기대를 유지하고 submit 버튼 대신 미전송을 검증했다.
- auxiliary parity: 실제 palette callback으로 저장하고 ACK 전 dirty/export 차단, ACK 후 draft 정리와 차단 해제, 정확한 command·expected·revision을 검증했다. 기존 palette busy 및 readonly 검증은 유지했다.

## 검증

- 지정된 6개 파일 Vitest: 76개 테스트 통과.
- 외부 busy fieldset 소스 회귀는 담당 오너 수정 후 기존 기대 그대로 통과했다. 제품 소스는 수정하지 않았다.
- 지정 테스트 6개만 Prettier 적용 및 check 통과. 문서는 기존 .prettierignore에 따라 제외했다. 전체 format은 실행하지 않았다.
- mock driver의 optional deps에 명시적으로 undefined를 허용하여 exactOptionalPropertyTypes 오류를 수정했다. 웹 tsc --noEmit 재실행에서 담당 파일 오류는 없다. 전체 타입검사는 범위 밖 NativeERDCanvas.interaction.test.ts:303의 TS2339 (`{ x: string; y: string }`에 `id` 없음) 한 건으로 실패했다. 해당 파일은 다른 담당자가 작업 중이므로 수정하지 않았다.
- 최초 pnpm 실행은 sandbox realpath EPERM으로 실패하여 제공된 Node v24.18.1로 설치된 Vitest CLI를 직접 실행했다.

## 인계

- 공유 Git index 경합 관련 오너 조정에 따라 git add/commit은 실행하지 않았다. 단위 커밋은 오너가 처리한다.
- 변경 파일은 지정된 웹 테스트 6개와 이 결과/계획 문서 2개뿐이다.
- NativeEditorForm.concurrent.test.ts, native-continuous-editing.test.ts 및 제품 소스는 수정하지 않았다.

변경 파일:

- apps/web/src/features/projects/NativeERDCanvas.test.ts
- apps/web/src/features/projects/native-condition-hints-ui.test.ts
- apps/web/src/features/projects/native-clipboard.test.ts
- apps/web/src/features/projects/native-clipboard-interaction.test.ts
- apps/web/src/features/projects/native-canvas-decoration.test.ts
- apps/web/src/features/projects/native-auxiliary-component-parity.test.ts
- docs/planning/2026-10-08-Editor-AutosaveRegressionPlan.md
- docs/work-log/2026-10-08-Editor-AutosaveRegressionResult.md
