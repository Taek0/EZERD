# 복구 연결 회귀 환경의 원본 UI 통합 대응

- 첫 전체 pnpm check에서 214개 파일이 통과했고 NativeProjectDraftRecovery.test.ts의 16개가 실패했다. 저장 상태 표시가 추가한 useNativeExportBlocked와 온라인/오프라인 EventTarget을 시험 환경에서 제공하지 않은 문제를 확인했다.
- 테스트가 일반 테이블 property를 첫 NativePropertyEditor로 찾던 가정을 제거하고 실제 복구 대상 column ID를 찾는다. ENUM 생성 진입은 원본 모달 manager가 열리는지 확인한다. 이전 table 생성 초안이 enum 초안으로 교체된다고 가정하지 않는다.
- 복구 중 API stage/send 없음, actor/project/unmount/지연 ACK·원문/expected 보존·private 권한과 입력을 숨긴 패널에 보존하는 기존 의미 검사는 유지했다.
- 대상 16개 테스트 통과. Node EventTarget은 단위 환경이며 브라우저/실제 모션으로 간주하지 않는다. 전체 검사 재실행은 최종 결과 기록에 포함한다.
