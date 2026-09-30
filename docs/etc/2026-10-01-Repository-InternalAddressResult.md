# 공개 문서 내부 주소 정리 결과

- [계획](./2026-10-01-Repository-InternalAddressPlan.md)에 따라 기존 문서 3개의 실제 사설 IPv4·허용 CIDR을 `<host-private-ip>`와 `<approved-private-cidr>`로 바꿨다.
- 대상은 [LAN 계획](../planning/2026-09-17-Hosting-LanCidr.md), [LAN 결과](../work-log/2026-09-17-Hosting-LanCidr.md), [워크스페이스 재개 기록](../work-log/2026-09-30-Workspace-ResumeCheckpoint.md)이다. 기록의 원래 파일명과 폴더는 유지했다.
- 실제 값은 로컬 `.env` 또는 비공개 운영 문서에서 관리하도록 명시했다. 이미 예시라고 명시된 `LAN_HOSTING.md`와 `.env.example`의 주소는 유지했다.
- 서버 실행 설정·DB·운영 이관 스크립트·폰트·과거 Git 기록·`docs/EZERD.txt`는 변경하지 않았다. 이 변경은 현재 문서 정리이며 과거 커밋의 값까지 제거하는 작업은 아니다.
- 검증: 보호된 사용자 문서를 제외한 공개 문서 검색에서 남은 사설 IPv4는 명시된 예시뿐이다. diff 공백 검사로 변경 내용을 확인한다. 문서만 변경하므로 제품 테스트는 수행하지 않는다.
