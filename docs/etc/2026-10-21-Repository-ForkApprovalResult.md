# 외부 PR Actions 실행 승인 정책 변경 결과

- 적용일: 2026-10-21 (Asia/Seoul)
- [계획](./2026-10-21-Repository-ForkApprovalPlan.md)에 따라 [Taek0/EZERD Actions 설정](https://github.com/Taek0/EZERD/settings/actions)을 변경했다.
- 이전: Require approval for first-time contributors.
- 적용: **Require approval for all external contributors**.
- GitHub의 `Save fork pull request workflows setting`을 실행하고 저장 성공 메시지와 all external contributors 선택 상태를 확인했다.
- 이제 저장소의 member 또는 owner가 아닌 외부 사용자의 fork PR 워크플로 실행에는 쓰기 권한자의 승인이 필요하다. PR 병합 승인 수와 별개의 설정이다.
- 기존 ruleset API를 다시 조회하여 `required_approving_review_count: 0`을 확인했다. main 보호 규칙의 대상 목록과 규칙, CI 파일은 변경하지 않았다. main 보호·CI 적용은 사용자가 다음 작업으로 미뤘다.
- Actions 기본 토큰 contents/packages 읽기 전용, Actions의 PR 생성·승인 비활성도 유지했다.
- 저장 성공 및 선택 상태 스크린샷은 저장소 밖의 Codex 시각화 폴더에 보관하고 사용자 응답에 표시했다. Git에는 포함하지 않는다.
- 이번 변경은 GitHub 설정 1개와 작업 기록이다. 제품 코드 변경이 없어 제품 테스트는 수행하지 않았다. 문서는 `.prettierignore` 대상이므로 포맷하지 않았다. 문서 상대 링크와 커밋 대상·diff 공백을 확인했다.
- 작업 문서만 로컬 커밋하고 원격 push는 수행하지 않는다.
