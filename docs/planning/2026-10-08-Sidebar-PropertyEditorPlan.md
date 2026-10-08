# Sidebar 속성 편집 계획

- 날짜: 2026-10-08
- 범위: NativePropertyEditor.tsx, native-editor-format.tsx, native-editor-policy.ts 및 전용 테스트.
- 상시 출력되는 미검증 안내와 실제 정책 실패를 구분하고 검증 정책은 보존한다.
- 컬럼 이름 → 타입 → 설명, 기본 접힘 영역 NULL → 기본값 → 배열 차원 순서로 배치한다.
- 타입의 표시 이름에서 DB 접두어만 제거하고 저장 ID는 보존한다.
- 공용 폼 및 autosave hook API를 확인하여 적용하고 form 중첩을 피한다.
- 전용 테스트 및 타입 검사를 실행하고 담당 파일만 포맷·커밋한다.
- 오너 API 협의 전송은 조상 채팅 제한으로 거부됨. 공용 파일 변경 확인으로 연동한다.
