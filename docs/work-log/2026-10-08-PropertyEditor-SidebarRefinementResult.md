# 속성 사이드바 UI 정리 결과

- [계획](../planning/2026-10-08-PropertyEditor-SidebarRefinementPlan.md)에 따라 NativePropertyEditor, native-editor-format, NativePrimaryKeyControl을 수정했다.
- 기존 SearchType을 재사용한다. 사용 불가 타입은 현재 선택을 제외하고 검색 목록에서 제외하며 선택 callback에서도 검증한다.
- 컬럼 이름 → 타입 및 파라미터 → 설명 → 기본 키(PK) 순으로 배치했다. 작은 편집 제목과 컬럼 현재 타입 요약은 제거했다.
- 기본값·생성 규칙 원문은 기본 접힘 옵션 내부에서 확인할 수 있다.
- MAIN의 useNativeLogicalMode에 연결했다. OFF이면 논리 이름·정의·추가 속성을 숨기며 데이터와 validator는 변경하지 않는다.
- 신규 native-property-editor.css에 PK 정렬, 빈 legend 숨김 및 hidden label 표시 규칙을 한정했다.
- 신규 native-property-layout.test.ts는 논리설계 ON/OFF, 데이터 보존, 배치 순서와 옵션 접힘을 검증한다. 기존 관련 테스트는 combobox와 context 호출에 맞췄다. NativeEditorForm.concurrent.test.ts는 MAIN의 자동 저장 지연 750ms에 맞췄다.
- 검증: 관련 테스트 10개 파일, 116개 테스트 통과. 웹 tsc --noEmit 통과. 샌드박스의 pnpm realpath/SSR 임시 캐시 오류로 설치된 Node CLI를 일반 실행 환경에서 직접 사용했다.
- 브라우저 시각 검증은 수행하지 않았다. 변경 파일만 Prettier 처리했다. 공용 native-editor-form, SearchType 원본, NativeProjectView, NativeERDCanvas는 수정하지 않았으며 Git add/commit은 실행하지 않았다.
