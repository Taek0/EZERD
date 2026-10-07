# Sidebar 속성 편집 결과

- 날짜: 2026-10-08
- 계획: [PropertyEditorPlan](../planning/2026-10-08-Sidebar-PropertyEditorPlan.md)

## 변경과 원인

- format 하단의 미검증 문구는 정상 초기 상태에도 무조건 표시되었다. 공용 form은 disabled 판정의 일반 입력 오류까지 같은 미검증 문구로 표시했다. format 상시 문구를 제거하고 구체 진단은 보존했으며 공용 오너에게 중립 문구 수정을 요청하여 반영되었다.
- 정책 사용 가능 여부는 우회하지 않았다. PostgreSQL 새 컬럼 initial/nullable/문자열 default/varchar 변경은 허용되고 txid_snapshot 신규 사용은 차단된다. 기존 SQLite untyped의 NULL만 수정할 때 타입은 보존된다.
- 컬럼 이름 → 타입 → 설명 배치, 기본 접힘 옵션 NULL → 기본값 → 배열 차원 순서. 표시 라벨의 DB 접두어만 제거하고 option value는 유지한다.
- 외부 property form은 div로 바꾸고 format의 afterType 슬롯에 설명을 배치하여 form 중첩을 방지했다.
- 수동 저장/초기화를 제거하고 공용 useNativeAutosave를 적용했다. 빈 이름은 기존 patch schema로 검증한다. 외부 busy의 권한/read-only fieldset guard는 보존한다. ACK 대기는 내부 outstanding으로 처리한다.
- 사용자 입력만 예약하며 currentDraft로 최신 입력을 전송한다. 성공 ACK에만 before를 전진하고 전송 당시 sequence를 기준으로 최신 snapshot rebase를 허용한다. getBlocked/draining으로 선택 전환과 ACK 대기 중 후속 입력을 처리한다.
- NativeLabelFields의 제거된 초기화 기능 안내를 한국어/영어 모두 수정했다.

## 검증

- 전용 및 관련 5 파일, 71 테스트 통과: native-sidebar, native-property-autosave, native-editor-ui, native-editor-format-diagnostic, native-editor-option-policy.
- 실제 hook/컴포넌트 로직의 Node hook driver로 같은 프레임 입력 후 unmount, ACK 중 추가 입력 후 unmount drain, 이미 도착한 ACK snapshot rebase 후 다음 sequence 저장을 검증했다. 브라우저 DOM/E2E 검증은 아니다.
- web TypeScript 검사 수행. 담당 파일의 TS2367 수정 포함.
- 담당 파일만 Prettier 적용. 공용 form/hook 및 다른 워커 파일은 수정/커밋하지 않았다.

## 추가 동시성 검증

- ACK 직전 unrelated snapshot에서 원복 입력이 사라지지 않도록 저장한 변경 필드가 observed snapshot에 반영되었는지 구분하여 rebase 기준을 선택한다.
- 실제 ACK snapshot과 unrelated snapshot 양쪽을 검증했다. 최종 전용 2 파일 9 테스트 통과, web 타입 검사 통과.
- 외부 busy fieldset guard 복원 커밋: bfbbea3. 최초 b0b7153은 공유 index 동시 staging으로 Canvas/SearchType 변경이 함께 포함되었다. 자동 승인 검토가 main 이력 재작성 방식의 분리를 거부하여 기존 이력은 보존했다.
