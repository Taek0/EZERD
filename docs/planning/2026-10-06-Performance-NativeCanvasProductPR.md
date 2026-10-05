# Native 캔버스 제품 반영 계획

2026-10-06. origin/main 8390e9e를 기준으로 성능 lab에서 검증한 제품 변경만 반영한다. 대상은 카메라/scene/보조 UI 렌더 경계, Native 카드·관계선 표현, 보존되는 직접 편집/관계선 조작, PNG 표현 일치와 회귀 테스트다. 측정 도구·메모리 어댑터·raw 자료·실험 Git 기록은 제외한다.

제품 패치를 논리 단위 순서대로 적용하고 최신 main과의 차이를 검사한다. clean 제품 checkout에서 frozen lockfile 설치와 pnpm check를 수행한 뒤 draft PR을 생성한다. main merge/운영 DB/배포는 하지 않는다. 실제 HTTP·DB 통합이 필요한 조건부 테스트의 미실행을 명시한다.
