# Native versioned JSON 웹 전송·명시 업그레이드 UI

- 기준: 루트 AGENTS, [기능 명세](2026-10-01-Database-CapabilitySpecification.md), [타입·기능 명세](2026-10-01-Database-TypeFeatureMatrix.md), [진행 상태](../work-log/2026-10-01-Database-ImplementationProgress.md), [서버 전송 결과](../work-log/2026-10-02-Database-NativeTransfer.md), [업그레이드 결과](../work-log/2026-10-02-Database-NativeUpgrade.md).
- 담당 범위: ProjectTransfer/project-transfer/project-versioned-export 및 전용 테스트, 필요 시 ProjectGallery/test, 새 NativeUpgradeButton/helper/tests, 이 계획/작업 기록. App/model/contracts/server/다른 병렬 native 저장 계층은 변경하지 않는다. git add/commit과 전체 check/build는 main 담당이다.
- format 1 기존 경로는 유지하고 format 2는 native-transfer REST를 사용한다. 전체 파일/문서 UTF-8 예산, DB/profile/context 및 source/preview 전체 graph를 검사한다. native 문서를 v1 어댑터로 다운캐스트하거나 원본을 normalize/수정하여 가져오지 않는다. native legacy 신규 쓰기 권한은 서버 정책에 남긴다.
- 이름 변경 시 원래 project DB metadata를 함께 보존한다. import 응답의 전체 Project와 native result 계약을 검사하고 target workspace 및 DB 문맥을 확인한다. 파일 읽기/전송 도중 workspace/user 변경·unmount가 발생하면 결과를 버린다.
- export는 서버 document-state에서 현재 source schema를 확인해 legacy/native 경로를 선택한다. 서버 반환 version/sequence/revision/profile과 source를 재조회 snapshot으로 확인하고 다운로드 직전에 async durable guard와 actor/project scope를 다시 검사한다. 실제 Blob/링크 생성은 검사 이후에만 실행한다.
- 새 NativeUpgradeButton은 v1 공유 메뉴용으로 준비한다. main App이 v1 autosave/prepareToLeave를 끝내는 callback과 현재 actor/project scope, 완료 시 재조회/전환 callback을 연결한다. 최신 서버 source와 진단을 먼저 보여 주고 사용자 명시 실행 후 좌표를 다시 확인하여 operationId/clientId/expectedVersion/sequence/revision으로 POST한다. unknown/MySQL/SQLite v1 PG 값은 legacy 원문 보존 및 미검증 쓰기/DDL 제한으로 설명한다.
- 업그레이드는 공통 IndexedDB queue의 upgrade kind와 actor/project 단일 키로 stage/load/send한다. 원래 body와 검토 snapshot을 보존하고 claim transaction 내부에서 scope/legacy/draft guard를 다시 검사한다. lease 및 heartbeat를 확보한 뒤 POST하며 정확한 accepted ACK(actor/op/group/sequence+1/revision+1/context/baseline)만 원자 consume한다. 유실 응답은 같은 operation/body로 재생하며 viewer/archive replay도 새 쓰기 권한 검사와 분리한다. HTTP 오류/ACK mismatch는 확정 실패로 취급하지 않는다. unknown cancel marker의 서버/UI 연결은 main 후속이다.
- 공통 captureNativeActorApi로 actor/userId/token/expiry를 첫 await 전 검증·고정하며 자격 증명은 durable payload에 저장하지 않는다. ACK consume 이후 재조회 실패는 전송 유실과 구분하고 완료 ACK를 다시 POST하지 않는다.
- browser 조작/배포 없이 helper·static UI 의미 테스트 및 담당 파일 targeted Prettier/TypeScript로 검증한다.
- 결과: [작업 기록](../work-log/2026-10-02-Database-NativeTransferUI.md).
