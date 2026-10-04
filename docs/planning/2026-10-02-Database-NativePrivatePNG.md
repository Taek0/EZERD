# Native private view PNG 계획

- 작성일: 2026-10-02
- 범위: 신규 private PNG 준비/검증 helper와 tests, 기존 NativeCanvasPngExport·native-canvas-png·NativeERDCanvas의 작은 소비 연결. App/NativeProjectView, 서버/계약/model, 개인 저장·archive 정책은 수정하지 않는다. 커밋 및 browser decode/실제 PNG 파일 QA는 main 담당이다.

## 저장된 입력과 보호 경계

1. 현재 Canvas가 읽은 actor personal snapshot을 기준 버전으로 받고, actor 고정 API로 개인 저장 상태 및 shared document head를 no-store GET한다. project/shared version·sequence·DB kind/profile/revision·personal version/state가 모두 일치해야 한다.
2. sharedDocument(source)와 저장된 personal state만 기존 reconcile/merge helper로 병합하고 native schema 및 shared diff 불변을 검증한다. 다른 actor private view, source 원문에 섞인 개인 자료, 미저장 drag/form/camera는 입력으로 받지 않는다. 현재 private view가 저장된 개인 view에서 사라졌으면 실패한다.
3. IDB queue는 읽기만 한다. 활성 transmission lease 또는 unknown 상태에서는 실패하며, export 중 actor/project queue 내용이 바뀌면 취소한다. PNG를 위해 저장 claim/lease나 개인 PUT을 만들거나 소비하지 않는다. 미저장 form 값은 그대로 두고 저장된 snapshot만 출력한다.
4. 기존 native scene/SVG/2x encoder를 재사용한다. decode/blob 완료 후 다운로드 직전 shared/personal head와 queue를 다시 읽고 source/state 원문·버전 및 actor/session/UI 문맥을 재확인한다. 실패 시 파일/object URL을 만들지 않는다. local pan/zoom은 출력 bounds에 합치지 않는다.
5. 현재 공유 PNG 경로와 readonly 지원을 보존한다. private PNG는 personal snapshot을 읽은 후 사용 가능하며 조회 전용 사용자도 자기 저장된 view를 내보낼 수 있다. 메뉴에는 저장된 내용만 출력한다는 제품 안내를 표시한다.

## 검증

- saved private node/note/table/FK route·display와 source 원문 불변, local preview 배제, 실제 actor transport 고정 및 계정/session 전환 취소.
- shared version/sequence/revision/profile/document, personal version/state/view 삭제·queue lease/unknown 변경을 export 전/encoder await 중/다운로드 직전 거부.
- readonly/private UI static 및 기존 공유 PNG·Canvas targeted 회귀, scoped source typecheck, 변경 파일 Prettier. browser 이미지/실파일 QA는 main 인계하며 전체 check/build/commit은 하지 않는다.
