# Native private view PNG 결과

- 작성일: 2026-10-02
- 계획: [NativePrivatePNG](../planning/2026-10-02-Database-NativePrivatePNG.md).
- 범위: 저장된 actor personal view의 PNG 소비. git add/commit, progress 수정, 전체 format/check/build 및 browser QA는 하지 않았다.

## 변경 파일과 동작

- 신규 `apps/web/src/features/projects/native-private-png.ts`: sharedDocument(source)와 서버에 저장된 personal snapshot만 기존 reconcile/merge helper로 합친다. 현재 private view, shared version/sequence/DB kind/profile/revision, personal version/state 및 source 원문을 검증한다. source에 섞여 있던 다른 private view 자료는 제거하며 native schema/shared diff 불변을 확인한다. 입력 API에 preview document나 active/local camera를 받지 않는다.
- export는 첫 await 전 기존 captureNativeActorApi로 actor 인증을 고정한다. queue를 읽고 최신 document-state/personal-state를 no-store GET한 뒤 기존 native scene/PNG encoder를 호출한다. 실제 브라우저 encode가 끝난 뒤 다운로드 직전 같은 두 저장 head와 queue를 다시 읽는다. 원문 fingerprint도 비교하므로 같은 counter에 다른 데이터가 반환돼도 실패한다.
- actor/session 교체·만료, UI actor/project/view/mode/doc/personal generation 변경, 활성 transmission lease/unknown queue, 다른 pending row, shared/personal version·DB/profile·원문 변경은 파일 URL/download 이전에 거부한다. 미전송 pending row가 그대로 남아 있고 저장 head가 같으면 저장된 내용만 내보낼 수 있다. queue의 claim/send/ACK/discard 및 personal PUT은 수행하지 않는다.
- `NativeCanvasPngExport.tsx`: 기존 버튼에서 개인 PNG 경로도 소비한다. 저장 personal snapshot과 writer 상태를 받아 준비 완료 후 활성화하고 저장 내용만 출력한다는 제품 안내를 표시한다. readonly도 자기 저장 화면을 내보낼 수 있다. shared PNG 경로는 personal state/camera/writer 변화와 독립적으로 유지한다.
- `NativeERDCanvas.tsx`: 이미 읽은 personal snapshot, personalBusy, privateQueueState를 PNG 버튼에 전달하는 세 prop만 추가했다. canPersonalEdit/private/recovery/기존 저장 정책을 변경하지 않았다.
- 최종 scope 확인 때 같은 Canvas 파일에 다른 담당의 NativePrivateCASRecovery import/render hunk도 추가돼 있었다. 해당 변경은 보존했고, 이 단위의 Canvas 변경은 PNG prop 세 줄뿐이므로 main이 스테이징 범위를 구분해야 한다.
- `native-canvas-png.ts`: 선택적 async beforeDownload 검증을 encoder 완료 후 object URL 생성 전에 호출하고 문맥을 다시 확인한다. 공유 PNG의 기존 호출은 그대로 유효하다.
- 신규 `native-private-png.test.ts`, 기존 `native-canvas-decoration.test.ts`의 개인 화면 미로드 안내 assertion을 갱신했다. App/NativeProjectView, server/contracts/model, 개인 저장/archive 담당 파일은 수정하지 않았다.

## 검증

- source alias targeted **56개 통과**: 신규 private PNG 22, 기존 PNG 5, domain/style UI 6, Canvas 23.
- 세 DB 문맥에서 저장된 private table 위치·note·FK route·raw type/default·스타일을 실제 scene/SVG/encoder 호출로 소비하는 것을 확인했다. source/personal 입력은 변경하지 않고 다른 source private note 및 미저장 preview를 제외했다. 저장 camera의 유무·값이 이미지 bounds/content를 바꾸지 않는다.
- shared project version/sequence/revision/kind/profile/id/source, personal version/state/view 삭제, encode 중 head 변경, pending fingerprint 교체, sending/unknown 전환, UI generation 변경을 거부했다. fake-indexeddb의 실제 active lease를 읽고 pending이 그대로 남는 것도 확인했다.
- 기본 request/fetch 경로에서 첫 GET의 Bearer 인증 고정을 검증했고 decode 중 다른 actor 또는 같은 actor의 session 교체 시 추가 GET/파일 생성을 중단했다. PNG encoder 플랫폼은 mock이므로 실제 PNG 픽셀/파일 생성 검증과 구분한다.
- 최신 source 별칭으로 담당 web와 tests의 transitive noEmit typecheck 통과. 변경 파일만 Prettier 적용/확인, scope diff whitespace 확인. 검증용 임시 source alias/tsconfig는 제거했다.

## main QA 인계와 한계

- main browser QA: private view의 저장 노드/메모/FK를 PNG decode·실파일로 확인하고 미저장 drag/form/local pan/zoom이 제외되는지 비교한다. 공유 PNG 및 readonly 개인 view도 함께 확인한다. 이 단위는 HTTP 서버 또는 실제 browser를 새로 실행하지 않았다.
- 이미지 범위는 기존 공유 PNG와 같은 저장된 전체 view scene이며 viewport screenshot이 아니다. 고급 wrapping/font/style 개선이나 PNG의 서버 생성은 추가하지 않았다.
- 이 경로는 읽기 전용 GET 결과와 로컬 writer 상태를 재검증한다. 서버 export lock/atomic paired snapshot 계약을 추가하지 않았으므로 마지막 검증 이후 타기기의 저장을 봉쇄하는 기능은 없다. physical coverage/DDL export/개인 저장 권한 및 전체 native 기능 완료를 주장하지 않는다.
