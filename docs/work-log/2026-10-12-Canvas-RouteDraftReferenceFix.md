# 관계선 저장 초안 참조 수정

- NativeCanvasInputForm이 onSave의 editorDraft 인자에 초안 전체를 전달하여 strict 계약의 unrecognized_keys 오류가 발생했다.
- 전송 인자를 key/revision 참조로 제한했다. 로컬 저장과 승인 후 초안 정리에는 기존 전체 초안을 계속 사용한다.
- 드래그 종료 제출 인자를 실제 nativeEditorDraftRefSchema로 검증하는 회귀 테스트로 수정 전 실패를 확인했다. 이전에 전체 초안을 기대하던 두 테스트도 올바른 계약으로 수정했다.
- 폼·저장·대기열·경로 관련 테스트 69개와 웹 타입 검사 통과. 수정 파일 Prettier 및 diff 공백 검사 통과.
