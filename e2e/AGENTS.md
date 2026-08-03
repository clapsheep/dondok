# E2E 작업 규칙

- 사용자 흐름은 role과 label 기반으로 작성하고 DOM 순서나 긴 CSS selector에 의존하지 않는다.
- 실패 시 trace, screenshot, video, console, network, request ID를 보존한다.
- 모바일·iPad·데스크톱 모두 데이터 의미와 기능이 같은지 검증한다.
- 테스트 데이터는 실행마다 고유하게 만들고 운영 DB나 실제 개인정보를 사용하지 않는다.
