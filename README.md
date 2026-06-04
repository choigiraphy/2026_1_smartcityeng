# 실시간 수소충전소 최적 안내 대시보드

공공데이터포털/수소유통정보시스템 API를 병합해 현위치 기준 수소충전소를 추천하는 대시보드입니다.

## 실행

```bash
cp .env.example .env
# .env의 PUBLIC_DATA_SERVICE_KEY에 공공데이터포털 Encoding 인증키 입력
npm start
```

브라우저에서 `http://localhost:5173`을 엽니다. 인증키가 없으면 샘플 데이터 모드로 실행됩니다.

기본 진입 화면은 지휘 콘솔 UI입니다. 일반 대시보드는 `http://localhost:5173/?ui=standard`에서 확인할 수 있으며, 헤더 우측 전환 버튼으로 일반/콘솔 모드를 오갈 수 있습니다.

## 상시 호스팅(Render)

이 앱은 `server.js`가 공공데이터/카카오 API를 프록시하므로 GitHub Pages 같은 정적 호스팅이 아니라 Node.js Web Service로 배포해야 합니다. 기본 배포 설정은 `render.yaml`에 포함되어 있습니다.

1. GitHub 저장소에 이 프로젝트를 push합니다.
2. Render에서 **New > Blueprint** 또는 **New > Web Service**로 GitHub 저장소를 연결합니다.
3. Build Command는 `npm install`, Start Command는 `npm start`를 사용합니다.
4. Render 환경변수에 아래 값을 등록합니다.

| Key | 설명 |
| --- | --- |
| `PUBLIC_DATA_SERVICE_KEY` | 공공데이터포털 Encoding 인증키 |
| `KAKAO_MOBILITY_REST_API_KEY` | 카카오 REST API 키 |
| `KAKAO_MAPS_JAVASCRIPT_KEY` | 카카오 지도 JavaScript 키 |
| `SEOUL_TRAFFIC_API_KEY` | 서울 열린데이터광장 교통 API 키 |
| `H2_SNAPSHOT_COLLECTOR` | 자동 수집 사용 여부, 기본 `1` |
| `H2_SNAPSHOT_INTERVAL_MINUTES` | 자동 수집 주기, 기본 `10` |

배포 URL이 생성되면 Kakao Developers의 Web 플랫폼 도메인에 해당 Render 도메인을 추가해야 카카오 지도 JavaScript SDK가 정상 렌더링됩니다.

## 자동 수집

서버가 켜져 있고 `PUBLIC_DATA_SERVICE_KEY`가 있으면 실시간 대기/혼잡 스냅샷을 자동 수집합니다.

- 기본 주기: 10분
- 저장 위치: `data/h2_station_snapshots.jsonl`
- 상태 확인: `http://localhost:5173/api/collector`
- 주기 변경: `.env`의 `H2_SNAPSHOT_INTERVAL_MINUTES`
- 수집 중지: `.env`의 `H2_SNAPSHOT_COLLECTOR=0`

자동 수집은 서버 프로세스가 실행 중일 때만 동작합니다.

## 차량 상태 산정

대시보드는 차량 충전도를 사용자가 직접 입력하지 않고 `/api/vehicle/nexo`에서 차량 상태를 받아와 추천 로직에 반영합니다. 현재 기본값은 사용자가 제공한 NEXO 대시보드 사진의 100% 상태를 데모 기준으로 사용하고, 주행가능거리는 NEXO 공인 제원으로 계산합니다.

- 기본 제원: 공인 주행거리 609km, 수소탱크 6.33kg, 복합연비 96.2km/kg
- 계산식: `공인 주행거리 × 현재 충전도`, 안전권은 `주행가능거리 - 안전 여유`
- 표시값: 사진의 계기판 주행가능거리 668km/689km는 참조 정보로 표시하고, 추천 판단은 공인 609km 기준
- 환경변수 연동: `NEXO_SOC_PERCENT`, `NEXO_DASHBOARD_RANGE_KM`, `NEXO_ECO_RANGE_KM`, `NEXO_RESERVE_RANGE_KM`
- 실제 실차 연동: 현대 Bluelink/OBD 등에서 인증된 텔레메트리 값을 받을 수 있으면 `/api/vehicle/nexo` 내부만 교체하면 됩니다.

## 사용 API

- 운영정보: `https://apis.data.go.kr/B552532/h2nbiz_2/operationInfo`
- 실시간정보: `https://apis.data.go.kr/B552532/h2nbiz_3/currentInfo`
- 부대시설: `https://apis.data.go.kr/B552532/h2nbiz/adInfo`
- 월평균판매가격: `https://apis.data.go.kr/B552532/h2nbiz_4/avgPrcInfo`
- 서울시 실시간 도로 소통 정보: `http://openapi.seoul.go.kr:8088/{KEY}/xml/TrafficInfo/1/1/{LINK_ID}`
- 카카오내비 Directions: `https://apis-navi.kakaomobility.com/v1/directions`
- Kakao Maps Web API: `https://dapi.kakao.com/v2/maps/sdk.js`

한국석유관리원 API는 `serviceKey`를 쿼리 파라미터로 사용하고, 서울 열린데이터광장 API는 URL 경로에 인증키를 넣습니다. 카카오내비 Directions는 서버 프록시에서 `Authorization: KakaoAK {REST_API_KEY}` 헤더로 호출해 브라우저에 REST 키가 노출되지 않게 처리합니다. Kakao Maps Web API는 브라우저에서 JavaScript 키를 사용하는 공식 구조이므로, `KAKAO_MAPS_JAVASCRIPT_KEY`가 있으면 카카오 지도로 렌더링하고 없으면 Leaflet 지도로 fallback합니다.

## 추천 로직

- 가격: 운영정보 `ntsl_pc`, 값이 없으면 월평균판매가격 `chrstn_untpc`
- 추천 범위: 서울+경기 수도권 충전소를 기본 후보로 사용
- 예약제: `사전 예약`/`예약제` 표기 충전소는 기본 제외, UI에서 포함 가능
- 버스 전용: `vehicleKinds`가 버스 전용이거나 안내문에 `버스 전용`으로 표기된 충전소는 기본 제외, UI에서 포함 가능
- 운영시간: 운영정보의 요일별 시작/종료 시각을 오늘 기준으로 카드, 목록, 상세 패널에 표시
- 거리: 카카오내비 Directions 응답이 있으면 실제 도로거리, 없으면 현위치와 충전소 좌표(`let`, `lon`)의 haversine 거리
- 총시간: 카카오내비 실제 주행시간 또는 서울시 교통 기반 추정 주행시간 + 실시간정보 `wait_vhcle_alge` 기반 대기시간
- 대기시간 가정: 대기차량 1대당 7분
- 주행시간: `KAKAO_MOBILITY_REST_API_KEY`가 있으면 카카오내비 Directions `summary.duration`을 우선 반영하고, 없으면 `TrafficInfo` 실시간 링크 속도(`prcs_spd`)로 보정합니다. 두 API가 없으면 평균 42km/h fallback을 사용합니다.
- 경쟁 리스크: 대기차량, 혼잡 상태, 데이터 신뢰도, 과거 동일 시간대 패턴을 함께 반영해 `낮음`/`보통`/`높음`/`불확실`로 표시
- 데이터 신뢰도: 실시간 갱신 시각을 기준으로 `높음`/`보통`/`갱신 지연`/`불확실`로 표시
- 패턴 분석: 실시간 API 응답 중 서울+경기 충전소 스냅샷을 `data/h2_station_snapshots.jsonl`에 저장하고, 요일/시간대별 평균 대기차량과 혼잡률을 계산
- 예측형 추천: 동일 요일/시간대의 누적 기록이 충분하면 예상 리스크를 추천 카드와 상세 패널에 표시하고, 표본이 부족하면 `예측 불확실`로 표시
- 사용자가 선택한 가격/거리/총시간 간격, 예약제 포함 여부, 버스 전용 포함 여부를 먼저 적용한 뒤, 남은 후보에서 `가격 우선`, `거리 우선`, `최소 총시간` 추천을 각각 산출합니다.
- 콘솔 모드에서는 추천 3종을 명령 슬롯으로 재배치하고, 선택 충전소의 비용/거리/시간/대기/접근성을 레이더 그래프로 표시합니다. 차량 이동 모션은 선택 경로 polyline을 지도 화면 좌표로 재투영해 줌/이동 후에도 다시 정렬합니다.

## 확인한 공식 문서

- [한국석유관리원_수소충전소_운영정보](https://www.data.go.kr/data/15133332/openapi.do)
- [한국석유관리원_수소충전소_실시간정보](https://www.data.go.kr/data/15133338/openapi.do)
- [한국석유관리원_수소충전소_부대시설](https://www.data.go.kr/data/15133016/openapi.do)
- [한국석유관리원_충전소별_월평균_판매가격](https://www.data.go.kr/data/15145097/openapi.do)
- [카카오내비 Directions](https://developers.kakaomobility.com/guide/navi-api/directions)
- [Kakao 지도 Web API](https://apis.map.kakao.com/web/guide/)
