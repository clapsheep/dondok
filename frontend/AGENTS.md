# 프론트엔드 작업 규칙

- TypeScript, React, TanStack Query, shadcn/ui 방식의 로컬 컴포넌트, Tailwind를 사용한다.
- 서버 상태는 TanStack Query에 두고 화면별로 중복 fetch하지 않는다.
- 모바일·iPad 세로/가로·데스크톱에서 하나의 의미와 기능을 유지하며 container query를 우선한다.
- viewport 변경으로 입력 draft, focus, filter, query cache가 초기화되지 않아야 한다.
- 접근 가능한 label, role, focus 표시와 44px 이상의 주요 터치 영역을 유지한다.
