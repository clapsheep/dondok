# 금융기관 표시 자산 출처

돈독은 계좌·적금을 빠르게 식별하기 위해 금융기관 코드를 저장하고 작은 원형 아이콘으로 표시한다. 기관 목록은 금융결제원 CMS 참가기관 명칭을 기준으로 정규화한다. 로고는 각 기관의 공식 웹사이트가 직접 제공하는 favicon·브랜드 리소스만 32px 앱 자산으로 축소해 번들에 포함하며, 공식 소형 리소스가 확인되지 않은 기관은 기관별 색상과 약칭을 사용한다. 실행 중 외부 은행 사이트로 이미지 요청을 보내지 않는다.

## 공식 이미지 URL

2026-08-15 확인 기준이다.

- KB국민은행: `https://www.kbstar.com/openimg/favi_iphone_n201512.png`
- 신한은행: `https://image.shinhan.com/favicon.ico`
- 하나은행: `https://www.kebhana.com/favicon.ico`
- 우리은행: `https://www.wooribank.com/favicon.ico`
- IBK기업은행: `https://www.ibk.co.kr/img/logo800.png`
- 카카오뱅크: `https://www.kakaobank.com/view/images/sub/symbol-logo.svg`
- 케이뱅크: `https://cdnisb.kbanknow.com/resource/images/web/favicon/favicon_VI_196px.png`
- 토스뱅크: `https://static.toss.im/tds/favicon/favicon-196x196.png`

이미지는 금융기관 식별 목적으로만 사용한다. 외부 이미지 요청 실패가 자산 탐색을 막지 않도록 항상 로컬 텍스트 fallback을 함께 렌더링한다.
