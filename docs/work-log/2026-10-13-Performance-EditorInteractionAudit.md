# 편집기 공통 입력 지연 코드 조사

- 조회 기준 main 1fa6b08. 작업 폴더 clean. 이번 조사는 제품 코드 변경 없이 진행했다.
- NativeProjectView:961 이후 outline, selectedRows, navigatorColumns, 검색/관계 필터를 렌더 본문에서 다시 계산한다. 무관한 상위 UI state 갱신에도 실행되는 경로다. 실제 비용 비중은 미측정이다.
- NativeERDCanvas 및 NativeCanvasWorkspace는 일반 함수 컴포넌트다. 상위 갱신의 전파 경로가 있으며 내부 useMemo 및 하위 memo는 있으므로 모든 DOM이 매번 다시 그려진다는 뜻은 아니다.
- native-save-intents의 nativeSaveIntents는 localStorage 키를 순회하고 프로젝트 intent를 JSON.parse/schema.parse한다. enqueueNativeSave는 동기 직렬화/저장을 수행하며 이후 save에서도 intent를 다시 조회한다. 데이터량별 비용은 실측해야 한다.
- NativeProjectView.save는 completion/ACK를 기다린다. flushSaves는 큐를 순차 처리하고 ACK의 로컬 반영이 되지 않으면 onReload를 호출한다. includeDocument:true 요청도 확인했다. 응답 크기·네트워크·서버·응답 적용 시간은 아직 측정하지 않았다.
- 테이블/컬럼 추가 등에 일부 낙관적 미리보기가 있으므로 모든 수정이 ACK 뒤에만 보인다고 일반화할 수 없다.
- 앞선 패널 개선은 빈번한 drag width state 갱신을 줄인 국소 개선이다. 편집기 전체 버튼 응답성의 정량 검증을 완료한 것이 아니다.
- 다음 계측: (1) 저장 없는 열기/닫기·선택의 입력→첫 paint와 React commit (2) 이름 수정/컬럼 추가의 동기 준비→요청 시작→응답→ACK 적용→paint (3) 같은 문서에서 파생 데이터 캐시와 렌더 경계 개선 전후 비교. 큐 내구성이나 충돌 검사를 무작정 제거하지 않는다.

[계획](../planning/2026-10-13-Performance-EditorInteractionAudit.md)
