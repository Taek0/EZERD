# Native 클립보드 저장소 분리 완료

- [계획](../planning/2026-10-07-Legacy-ClipboardRetirementPlan.md)에 따라 Native가 사용하는 메모리 저장소를 shared/clipboard/table-clipboard-store.ts로 분리했다.
- readLocalTableClipboard/rememberTableClipboard는 같은 모듈 메모리에 원문 문자열을 저장·조회한다. 모델/계약이나 브라우저 API에 의존하지 않는다.
- Native가 읽지 않는 localOnly 플래그와 fallback 인자를 제거했다. NativeERDCanvas는 새 저장소를 사용하며 기존 copy/paste·권한·스코프·저장 로직은 유지했다.
- v1 copyTables/parseTableClipboard/pasteTables, localTablePasteFallback/acknowledgeSystemTableClipboard가 들어 있던 기존 모듈 288줄과 전용 테스트 261줄을 제거했다. 제거 함수의 운영·QA 참조는 남아 있지 않다.
- 앱 import 그래프 테스트는 새 저장소가 연결되고 기존 v1 클립보드 모듈은 연결되지 않음을 확인한다.

## 보존과 검증

- NativeERDCanvas의 실제 노드 선택 및 copy/keyboard paste/context-menu callback을 실행하는 테스트를 추가했다. 연속 복사에서 마지막 Native 원문 사용, source snapshot 불변, 입력란·읽기 전용 보호, 장치 클립보드 읽기 실패 시 메모리 fallback을 확인했다.
- 테스트마다 저장소를 초기화해 다른 캔버스 테스트에 영향을 주지 않는다. 테스트 하네스의 직접 상태 변경 대신 실제 선택 callback을 사용한다.
- NativeClipboardMenu의 수동 입력·비동기 스코프 검증, Native 클립보드 계약·새 ID·원문 보존·복구 관련 기존 테스트는 유지했다. packages의 미사용 호환 reader와 공통 selection 함수는 이번 범위에서 변경하지 않았다.
- pnpm format, pnpm format:check, pnpm typecheck, pnpm test, pnpm build, git diff --check 통과.
- 전체 테스트: 201개 파일/2,574개 테스트 통과, 25개 파일/491개 테스트 건너뜀.
- 웹 빌드: JS 1,753.67kB(gzip 497.35kB), CSS 130.32kB(gzip 25.50kB), 1,627모듈. 기존 500kB 청크 경고는 남는다.
- 브라우저 수동 QA와 DB 통합 테스트는 별도 실행하지 않았다. 서버·공유 패키지·DB·docs/EZERD.txt는 변경하지 않았고 재시작·배포도 수행하지 않았다.
