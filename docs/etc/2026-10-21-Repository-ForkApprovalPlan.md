# 외부 PR Actions 실행 승인 정책 변경 계획

- 작성일: 2026-10-21 (Asia/Seoul)
- 대상: [Taek0/EZERD Actions 설정](https://github.com/Taek0/EZERD/settings/actions)
- 사용자 요청: 혼자 개발하는 운영과 PR 승인 요구 0명을 유지하고, 모든 외부 기여자의 fork PR 워크플로 실행에 승인을 요구한다.
- 변경: Fork PR 실행 승인 대상을 first-time contributors에서 all external contributors로 변경하고 저장한다.
- 유지: main 보호 대상과 규칙, CI 구성, PR 승인 요구 수, Actions 기본 토큰 권한 등은 변경하지 않는다.
- 검증: 저장 후 화면을 다시 읽어 선택 상태를 확인하고 증거 화면을 저장한다. ruleset API에서 PR 승인 요구가 0명인지 확인한다.
- 기록: [결과 문서](./2026-10-21-Repository-ForkApprovalResult.md)에 실제 적용 결과를 기록하고 이번 문서만 로컬 커밋한다. 원격 push는 하지 않는다.
