import { createServer } from "node:http";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");
const dataDir = join(__dirname, "data");
const snapshotPath = join(dataDir, "h2_station_snapshots.jsonl");

loadDotEnv();

const port = Number(process.env.PORT || 5173);

const endpoints = {
  operation: "https://apis.data.go.kr/B552532/h2nbiz_2/operationInfo",
  current: "https://apis.data.go.kr/B552532/h2nbiz_3/currentInfo",
  facilities: "https://apis.data.go.kr/B552532/h2nbiz/adInfo",
  averagePrice: "https://apis.data.go.kr/B552532/h2nbiz_4/avgPrcInfo",
  seoulTraffic: "http://openapi.seoul.go.kr:8088",
  kakaoDirections: "https://apis-navi.kakaomobility.com/v1/directions",
  kakaoDestinations: "https://apis-navi.kakaomobility.com/v1/destinations/directions",
  kakaoOrigins: "https://apis-navi.kakaomobility.com/v1/origins/directions",
  kakaoWaypoints: "https://apis-navi.kakaomobility.com/v1/waypoints/directions",
  kakaoLocalKeyword: "https://dapi.kakao.com/v2/local/search/keyword.json",
  kakaoLocalAddress: "https://dapi.kakao.com/v2/local/search/address.json"
};

const nexoProfile = {
  model: "Hyundai NEXO",
  certifiedRangeKm: 609,
  fuelCapacityKg: 6.33,
  efficiencyKmPerKg: 96.2,
  reserveKm: 30,
  dashboardReferenceRangeKm: 668,
  ecoReferenceRangeKm: 689
};

const apiNames = {
  operation: "한국석유관리원_수소충전소_운영정보",
  current: "한국석유관리원_수소충전소_실시간정보",
  facilities: "한국석유관리원_수소충전소_부대시설",
  averagePrice: "한국석유관리원_충전소별_월평균_판매가격",
  seoulTraffic: "서울시 실시간 도로 소통 정보",
  kakaoDirections: "카카오내비 Directions",
  kakaoRoutePlan: "카카오내비 목적지 기반 경로계획",
  kakaoLocal: "카카오 Local API"
};

const trafficProbeLinks = [
  {
    id: "1220003800",
    name: "서울 대표 서비스링크",
    lat: 37.5665,
    lon: 126.978,
    note: "TrafficInfo API 검증용 대표 링크"
  }
];

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

let stationCache = null;
const cacheTtlMs = 45_000;
const maxHistoryRecords = 20_000;
const collectorIntervalMinutes = Math.max(1, Number(process.env.H2_SNAPSHOT_INTERVAL_MINUTES || 10));
const collectorIntervalMs = collectorIntervalMinutes * 60_000;
const collectorEnabled = !["0", "false", "off"].includes(String(process.env.H2_SNAPSHOT_COLLECTOR || "1").toLowerCase());
let liveRefreshPromise = null;
let collectorTimer = null;
let collectorRunning = false;
let collectorStartedAt = null;
let collectorLastRunAt = null;
let collectorNextRunAt = null;
let collectorLastError = null;
let collectorLastSavedRows = 0;
let lastSnapshotWrite = null;

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/api/health") {
      sendJson(res, 200, {
        ok: true,
        hasServiceKey: Boolean(getServiceKey()),
        hasKakaoMobilityKey: Boolean(getKakaoMobilityKey()),
        hasKakaoLocalKey: Boolean(getKakaoLocalKey()),
        hasKakaoMapsJavascriptKey: Boolean(getKakaoMapsJavascriptKey()),
        collector: getCollectorStatus(),
        endpoints
      });
      return;
    }

    if (url.pathname === "/api/client-config") {
      sendJson(res, 200, {
        kakaoMapsJavascriptKey: getKakaoMapsJavascriptKey(),
        hasKakaoMobilityKey: Boolean(getKakaoMobilityKey()),
        hasKakaoLocalKey: Boolean(getKakaoLocalKey())
      });
      return;
    }

    if (url.pathname === "/api/vehicle/nexo") {
      sendJson(res, 200, getNexoVehicleTelemetry());
      return;
    }

    if (url.pathname === "/api/stations") {
      const forceRefresh = url.searchParams.get("refresh") === "1";
      const forceMock = url.searchParams.get("mock") === "1";
      const payload = await getStationPayload({ forceRefresh, forceMock });
      sendJson(res, 200, payload);
      return;
    }

    if (url.pathname === "/api/history") {
      const history = await buildHistoryAnalysis(new Date().toISOString());
      sendJson(res, 200, {
        ...history.summary,
        collector: getCollectorStatus()
      });
      return;
    }

    if (url.pathname === "/api/collector") {
      sendJson(res, 200, getCollectorStatus());
      return;
    }

    if (url.pathname === "/api/kakao/routes") {
      if (req.method !== "POST") {
        sendJson(res, 405, { error: "METHOD_NOT_ALLOWED", message: "POST만 지원합니다." });
        return;
      }
      const payload = await readJsonBody(req);
      sendJson(res, 200, await getKakaoRouteSummaries(payload));
      return;
    }

    if (url.pathname === "/api/kakao/search-place") {
      if (req.method !== "GET") {
        sendJson(res, 405, { error: "METHOD_NOT_ALLOWED", message: "GET만 지원합니다." });
        return;
      }
      const lat = toNumber(url.searchParams.get("lat"));
      const lon = toNumber(url.searchParams.get("lon"));
      sendJson(res, 200, await searchKakaoPlaces({
        query: url.searchParams.get("q"),
        origin: Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null
      }));
      return;
    }

    if (url.pathname === "/api/kakao/route-plan") {
      if (req.method !== "POST") {
        sendJson(res, 405, { error: "METHOD_NOT_ALLOWED", message: "POST만 지원합니다." });
        return;
      }
      const payload = await readJsonBody(req);
      sendJson(res, 200, await getKakaoRoutePlan(payload));
      return;
    }

    if (url.pathname === "/api/kakao/route") {
      if (req.method !== "POST") {
        sendJson(res, 405, { error: "METHOD_NOT_ALLOWED", message: "POST만 지원합니다." });
        return;
      }
      const payload = await readJsonBody(req);
      sendJson(res, 200, await getKakaoRouteDetail(payload));
      return;
    }

    await serveStatic(url.pathname, res);
  } catch (error) {
    sendJson(res, 500, {
      error: "SERVER_ERROR",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

server.listen(port, () => {
  console.log(`Hydrogen dashboard: http://localhost:${port}`);
  startSnapshotCollector();
});

function getNexoVehicleTelemetry() {
  const envSoc = toNumber(process.env.NEXO_SOC_PERCENT);
  const envDashboardRange = toNumber(process.env.NEXO_DASHBOARD_RANGE_KM);
  const envEcoRange = toNumber(process.env.NEXO_ECO_RANGE_KM);
  const certifiedRangeKm = clampNumber(toNumber(process.env.NEXO_CERTIFIED_RANGE_KM), 100, 1000, nexoProfile.certifiedRangeKm);
  const fuelCapacityKg = clampNumber(toNumber(process.env.NEXO_FUEL_CAPACITY_KG), 1, 10, nexoProfile.fuelCapacityKg);
  const efficiencyKmPerKg = clampNumber(toNumber(process.env.NEXO_EFFICIENCY_KM_PER_KG), 30, 180, nexoProfile.efficiencyKmPerKg);
  const reserveKm = clampNumber(toNumber(process.env.NEXO_RESERVE_RANGE_KM), 0, 200, nexoProfile.reserveKm);
  const socPercent = clampNumber(envSoc, 0, 100, 100);
  const source = Number.isFinite(envSoc) ? "env-telemetry" : "demo-input";

  return {
    available: true,
    source,
    sourceName: "Hyundai NEXO vehicle profile",
    reason: Number.isFinite(envSoc)
      ? "서버 환경변수의 차량 상태를 반영했습니다."
      : "NEXO 제원 기반 100% 상태를 시연 기본값으로 사용합니다.",
    observedAt: process.env.NEXO_OBSERVED_AT || new Date().toISOString(),
    vehicle: {
      model: nexoProfile.model,
      socPercent,
      fullRangeKm: certifiedRangeKm,
      certifiedRangeKm,
      reserveKm,
      fuelCapacityKg,
      efficiencyKmPerKg,
      dashboardRangeKm: Number.isFinite(envDashboardRange) ? envDashboardRange : nexoProfile.dashboardReferenceRangeKm,
      ecoRangeKm: Number.isFinite(envEcoRange) ? envEcoRange : nexoProfile.ecoReferenceRangeKm,
      source,
      sourceLabel: Number.isFinite(envSoc) ? "차량 상태 연동" : "시연 입력",
      observedAt: process.env.NEXO_OBSERVED_AT || new Date().toISOString()
    }
  };
}

async function getStationPayload({ forceRefresh, forceMock, writeSource = "api-request" }) {
  const serviceKey = getServiceKey();
  const useMock = forceMock || !serviceKey;

  if (!useMock && stationCache && !forceRefresh && Date.now() - stationCache.cachedAt < cacheTtlMs) {
    return {
      ...stationCache.payload,
      collector: getCollectorStatus(),
      cache: {
        hit: true,
        cachedAt: stationCache.cachedAt,
        ttlMs: cacheTtlMs
      }
    };
  }

  if (!useMock && liveRefreshPromise) {
    return liveRefreshPromise;
  }

  if (!useMock) {
    liveRefreshPromise = buildStationPayload({ useMock, serviceKey, writeSource });
    try {
      return await liveRefreshPromise;
    } finally {
      liveRefreshPromise = null;
    }
  }

  return buildStationPayload({ useMock, serviceKey, writeSource });
}

async function buildStationPayload({ useMock, serviceKey, writeSource }) {
  const sources = useMock ? await loadMockSources() : await fetchLiveSources(serviceKey);
  const traffic = useMock ? mockTrafficSummary() : await fetchSeoulTrafficSummary();
  const receivedAt = new Date().toISOString();
  const stations = normalizeStations(
    sources.operation,
    sources.current,
    sources.facilities,
    sources.averagePrice
  );
  applyTrafficFeatures(stations, traffic);
  const history = useMock
    ? { ...emptyHistoryAnalysis(receivedAt), savedRows: 0 }
    : await updateHistoryAndAnalyze(stations, receivedAt, writeSource);
  applyPredictionFeatures(stations, history.predictionsById);

  const payload = {
    source: useMock ? "mock" : "live",
    sourceReason: useMock
      ? "PUBLIC_DATA_SERVICE_KEY가 없어 샘플 데이터로 실행 중입니다."
      : "공공데이터포털 API 응답을 병합했습니다.",
    receivedAt,
    apiNames,
    endpoints,
    counts: {
      operation: sources.operation.length,
      current: sources.current.length,
      facilities: sources.facilities.length,
      averagePrice: sources.averagePrice.length,
      trafficProbes: traffic.probes?.length ?? 0,
      stations: stations.length
    },
    traffic,
    insights: history.summary,
    collector: getCollectorStatus(),
    collection: {
      writeSource,
      savedRows: history.savedRows ?? 0,
      snapshotPath
    },
    stations
  };

  if (!useMock) {
    stationCache = {
      cachedAt: Date.now(),
      payload
    };
  }

  return {
    ...payload,
    collector: getCollectorStatus(),
    cache: {
      hit: false,
      cachedAt: stationCache?.cachedAt ?? null,
      ttlMs: useMock ? 0 : cacheTtlMs
    }
  };
}

async function fetchSeoulTrafficSummary() {
  const key = getSeoulTrafficKey();
  if (!key) {
    return {
      available: false,
      source: "fallback",
      sourceName: apiNames.seoulTraffic,
      reason: "SEOUL_TRAFFIC_API_KEY가 없어 평균속도 fallback 사용",
      observedAt: new Date().toISOString(),
      avgSpeedKph: null,
      probes: []
    };
  }

  const results = await Promise.allSettled(
    trafficProbeLinks.map(async (probe) => {
      const traffic = await fetchTrafficInfo(probe.id, key);
      return {
        ...probe,
        ...traffic
      };
    })
  );

  const probes = results
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value)
    .filter((probe) => Number.isFinite(probe.speedKph));

  if (probes.length === 0) {
    return {
      available: false,
      source: "fallback",
      sourceName: apiNames.seoulTraffic,
      reason: "TrafficInfo 응답 없음",
      observedAt: new Date().toISOString(),
      avgSpeedKph: null,
      probes: []
    };
  }

  return {
    available: true,
    source: "seoul-openapi",
    sourceName: apiNames.seoulTraffic,
    reason: "TrafficInfo 실시간 링크 속도 반영",
    observedAt: new Date().toISOString(),
    avgSpeedKph: round(avg(probes.map((probe) => probe.speedKph)), 1),
    avgTravelSeconds: round(avg(probes.map((probe) => probe.travelSeconds).filter(Number.isFinite)), 0),
    probes
  };
}

async function fetchTrafficInfo(linkId, key) {
  const url = `${endpoints.seoulTraffic}/${encodeURIComponent(key)}/xml/TrafficInfo/1/1/${encodeURIComponent(linkId)}`;
  const response = await fetch(url, {
    headers: {
      accept: "application/xml,text/xml"
    }
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${apiNames.seoulTraffic} 호출 실패: HTTP ${response.status}`);
  }

  const code = xmlText(text, "CODE");
  if (code && code !== "INFO-000") {
    throw new Error(`${apiNames.seoulTraffic} 오류: ${xmlText(text, "MESSAGE") || code}`);
  }

  return {
    linkId: xmlText(text, "link_id") || linkId,
    speedKph: toNumber(xmlText(text, "prcs_spd")),
    travelSeconds: toNumber(xmlText(text, "prcs_trv_time")),
    rawCode: code || ""
  };
}

function applyTrafficFeatures(stations, traffic) {
  for (const station of stations) {
    station.traffic = buildStationTraffic(station, traffic);
  }
}

function buildStationTraffic(station, traffic) {
  const fallbackSpeedKph = 42;
  const probes = traffic.probes ?? [];
  const nearest = probes.length > 0
    ? probes
        .map((probe) => ({
          ...probe,
          distanceKm: Number.isFinite(station.lat) && Number.isFinite(station.lon)
            ? haversineKm(station.lat, station.lon, probe.lat, probe.lon)
            : null
        }))
        .sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity))[0]
    : null;
  const speedKph = nearest?.speedKph ?? traffic.avgSpeedKph ?? fallbackSpeedKph;
  const safeSpeedKph = Math.min(55, Math.max(12, speedKph));

  return {
    source: traffic.available ? "seoul-openapi" : "fallback",
    sourceName: traffic.sourceName,
    observedAt: traffic.observedAt,
    speedKph: safeSpeedKph,
    rawSpeedKph: Number.isFinite(speedKph) ? speedKph : null,
    probeLinkId: nearest?.linkId ?? null,
    probeName: nearest?.name ?? null,
    probeDistanceKm: nearest?.distanceKm ?? null,
    reliability: traffic.available ? "교통 API 반영" : "평균속도 추정",
    note: traffic.reason
  };
}

function mockTrafficSummary() {
  return {
    available: false,
    source: "mock",
    sourceName: apiNames.seoulTraffic,
    reason: "샘플 모드 평균속도 사용",
    observedAt: new Date().toISOString(),
    avgSpeedKph: 42,
    probes: []
  };
}

async function searchKakaoPlaces({ query, origin }) {
  const observedAt = new Date().toISOString();
  const key = getKakaoLocalKey();
  const normalizedQuery = clean(query).slice(0, 80);

  if (normalizedQuery.length < 2) {
    return {
      available: false,
      source: "invalid",
      sourceName: apiNames.kakaoLocal,
      reason: "검색어는 두 글자 이상 입력해야 합니다.",
      observedAt,
      query: normalizedQuery,
      places: []
    };
  }

  if (!key) {
    return {
      available: false,
      source: "fallback",
      sourceName: apiNames.kakaoLocal,
      reason: "KAKAO_REST_API_KEY가 없어 목적지 검색을 사용할 수 없습니다.",
      observedAt,
      query: normalizedQuery,
      places: []
    };
  }

  const keywordParams = {
    query: normalizedQuery,
    size: "10",
    sort: "accuracy"
  };
  if (origin) {
    keywordParams.x = String(origin.lon);
    keywordParams.y = String(origin.lat);
  }

  const [keywordResult, addressResult] = await Promise.allSettled([
    fetchKakaoLocal(endpoints.kakaoLocalKeyword, key, keywordParams),
    fetchKakaoLocal(endpoints.kakaoLocalAddress, key, {
      query: normalizedQuery,
      size: "5"
    })
  ]);

  const errors = [];
  const places = [];
  if (keywordResult.status === "fulfilled") {
    places.push(...normalizeKakaoPlaceDocuments(keywordResult.value.documents, "keyword", normalizedQuery, origin));
  } else {
    errors.push(keywordResult.reason instanceof Error ? keywordResult.reason.message : String(keywordResult.reason));
  }

  if (addressResult.status === "fulfilled") {
    places.push(...normalizeKakaoPlaceDocuments(addressResult.value.documents, "address", normalizedQuery, origin));
  } else {
    errors.push(addressResult.reason instanceof Error ? addressResult.reason.message : String(addressResult.reason));
  }

  const dedupedPlaces = dedupeKakaoPlaces(places).slice(0, 10);
  const localServiceDisabled = errors.some((message) => /OPEN_MAP_AND_LOCAL|disabled/i.test(message));
  return {
    available: dedupedPlaces.length > 0,
    source: dedupedPlaces.length > 0 ? "kakao-local" : "empty",
    sourceName: apiNames.kakaoLocal,
    reason: dedupedPlaces.length > 0
      ? "카카오 Local 키워드/주소 검색 결과"
      : localServiceDisabled
        ? "카카오 Developers 앱에서 지도/로컬(OPEN_MAP_AND_LOCAL) 제품을 활성화해야 목적지 검색을 사용할 수 있습니다."
        : errors.join(" · ") || "검색 결과가 없습니다.",
    observedAt,
    query: normalizedQuery,
    places: dedupedPlaces
  };
}

async function fetchKakaoLocal(endpoint, key, params) {
  const requestUrl = new URL(endpoint);
  for (const [name, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") {
      requestUrl.searchParams.set(name, value);
    }
  }

  const response = await fetchWithTimeout(requestUrl, {
    headers: {
      accept: "application/json",
      authorization: `KakaoAK ${key}`
    }
  }, 7000);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${apiNames.kakaoLocal} 호출 실패: HTTP ${response.status}${kakaoErrorText(text)}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${apiNames.kakaoLocal} JSON 파싱 실패`);
  }
}

function normalizeKakaoPlaceDocuments(documents, source, query, origin) {
  if (!Array.isArray(documents)) return [];
  return documents
    .map((document, index) => normalizeKakaoPlaceDocument(document, source, query, origin, index))
    .filter(Boolean);
}

function normalizeKakaoPlaceDocument(document, source, query, origin, index) {
  const lat = toNumber(document?.y ?? document?.address?.y ?? document?.road_address?.y);
  const lon = toNumber(document?.x ?? document?.address?.x ?? document?.road_address?.x);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const roadAddress = clean(document?.road_address_name ?? document?.road_address?.address_name);
  const address = clean(document?.address_name ?? document?.address?.address_name);
  const name = clean(document?.place_name) || roadAddress || address || query;
  const responseDistanceMeters = toNumber(document?.distance);
  const distanceKm = Number.isFinite(responseDistanceMeters)
    ? round(responseDistanceMeters / 1000, 1)
    : origin
      ? round(haversineKm(origin.lat, origin.lon, lat, lon), 1)
      : null;

  return {
    id: clean(document?.id) || `${source}-${index}-${lat.toFixed(6)}-${lon.toFixed(6)}`,
    name,
    label: name,
    lat,
    lon,
    roadAddress,
    address,
    category: clean(document?.category_name),
    phone: clean(document?.phone),
    url: clean(document?.place_url),
    distanceKm,
    relevanceScore: kakaoPlaceRelevanceScore({ name, category: clean(document?.category_name), address, roadAddress }, query, source),
    source
  };
}

function dedupeKakaoPlaces(places) {
  const output = new Map();
  for (const place of places) {
    const key = `${place.lat.toFixed(5)},${place.lon.toFixed(5)}|${place.name}|${place.roadAddress || place.address}`.toLowerCase();
    const previous = output.get(key);
    if (!previous || place.source === "keyword") {
      output.set(key, {
        ...previous,
        ...place,
        address: place.address || previous?.address || "",
        roadAddress: place.roadAddress || previous?.roadAddress || ""
      });
    }
  }

  return [...output.values()]
    .sort((a, b) => {
      const relevanceScore = (a.relevanceScore ?? 50) - (b.relevanceScore ?? 50);
      if (relevanceScore !== 0) return relevanceScore;
      const sourceScore = (a.source === "keyword" ? 0 : 1) - (b.source === "keyword" ? 0 : 1);
      if (sourceScore !== 0) return sourceScore;
      return (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity);
    })
    .map(({ relevanceScore, ...place }) => place);
}

function kakaoPlaceRelevanceScore(place, query, source) {
  const normalizedQuery = normalizeSearchText(query);
  const normalizedName = normalizeSearchText(place.name);
  const category = clean(place.category);
  let score = source === "keyword" ? 10 : 16;

  if (normalizedName === normalizedQuery) score -= 40;
  else if (normalizedName.startsWith(normalizedQuery)) score -= 18;
  else if (normalizedName.includes(normalizedQuery)) score -= 8;

  if (/기차역|KTX|지하철|전철|수도권\d*호선|수인분당선|터미널|환승센터|버스정류장|공항/.test(category)) {
    score -= 18;
  }
  if (/교통,수송/.test(category)) score -= 5;
  if (/입출구|주차장|주유소|충전소|아파트|부동산|음식점|카페|패션|은행|병원|약국/.test(category)) {
    score += 22;
  }
  if (/입출구/.test(category) && normalizedName !== normalizedQuery) score += 18;

  return score;
}

function normalizeSearchText(value) {
  return clean(value).replace(/\s+/g, "").toLowerCase();
}

async function getKakaoRouteSummaries(payload) {
  const observedAt = new Date().toISOString();
  const key = getKakaoMobilityKey();
  const origin = normalizePoint(payload?.origin);
  const destinations = normalizeDestinations(payload?.destinations).slice(0, 80);
  const priority = normalizeKakaoPriority(payload?.priority, "TIME");

  if (!origin) {
    return {
      available: false,
      source: "invalid",
      sourceName: apiNames.kakaoDirections,
      reason: "출발 좌표가 없어 카카오 경로를 계산하지 않았습니다.",
      observedAt,
      priority,
      routes: []
    };
  }

  if (destinations.length === 0) {
    return {
      available: false,
      source: "invalid",
      sourceName: apiNames.kakaoDirections,
      reason: "목적지 좌표가 없어 카카오 경로를 계산하지 않았습니다.",
      observedAt,
      priority,
      routes: []
    };
  }

  if (!key) {
    return {
      available: false,
      source: "fallback",
      sourceName: apiNames.kakaoDirections,
      reason: "KAKAO_MOBILITY_REST_API_KEY가 없어 기존 주행시간 추정값을 사용합니다.",
      observedAt,
      priority,
      routes: []
    };
  }

  const routes = await mapWithConcurrency(destinations, 4, async (destination) => {
    try {
      return await fetchKakaoDirection({
        key,
        origin,
        destination,
        priority,
        summaryOnly: true,
        observedAt
      });
    } catch (error) {
      return failedKakaoRoute(destination, error, observedAt, priority);
    }
  });

  const routeCount = routes.filter((route) => route.available).length;
  return {
    available: routeCount > 0,
    source: routeCount > 0 ? "kakao-navi" : "fallback",
    sourceName: apiNames.kakaoDirections,
    reason: routeCount > 0
      ? "카카오내비 Directions 도로거리/주행시간 반영"
      : "카카오내비 Directions 성공 응답 없음",
    observedAt,
    priority,
    requestCount: destinations.length,
    routeCount,
    routes
  };
}

async function getKakaoRoutePlan(payload) {
  const observedAt = new Date().toISOString();
  const key = getKakaoMobilityKey();
  const origin = normalizePoint(payload?.origin);
  const destination = normalizePoint(payload?.destination);
  const stations = normalizeDestinations(payload?.stations ?? payload?.destinations).slice(0, 90);
  const priority = normalizeKakaoPriority(payload?.priority, "TIME");

  if (!origin || !destination) {
    return {
      available: false,
      source: "invalid",
      sourceName: apiNames.kakaoRoutePlan,
      reason: "출발지 또는 목적지 좌표가 없어 목적지 기반 경로계획을 계산하지 않았습니다.",
      observedAt,
      priority,
      routes: []
    };
  }

  if (stations.length === 0) {
    return {
      available: false,
      source: "invalid",
      sourceName: apiNames.kakaoRoutePlan,
      reason: "후보 충전소 좌표가 없어 목적지 기반 경로계획을 계산하지 않았습니다.",
      observedAt,
      priority,
      routes: []
    };
  }

  if (!key) {
    return {
      available: false,
      source: "fallback",
      sourceName: apiNames.kakaoRoutePlan,
      reason: "KAKAO_MOBILITY_REST_API_KEY가 없어 목적지 기반 경로계획을 계산하지 않았습니다.",
      observedAt,
      priority,
      routes: []
    };
  }

  try {
    const baseRoute = await fetchKakaoDirection({
      key,
      origin,
      destination,
      priority,
      summaryOnly: true,
      observedAt
    });
    const [toStation, stationToDestination] = await Promise.all([
      fetchKakaoDestinations({ key, origin, destinations: stations, priority, observedAt }),
      fetchKakaoOrigins({ key, origins: stations, destination, priority, observedAt })
    ]);

    const routes = stations.map((station) => {
      const outbound = toStation.get(station.id);
      const inbound = stationToDestination.get(station.id);
      return composeRoutePlanRoute(station, outbound, inbound, baseRoute, observedAt, priority);
    });

    let routeCount = routes.filter((route) => route.available).length;
    let finalRoutes = routes;
    let fallbackUsed = false;
    if (routeCount === 0) {
      fallbackUsed = true;
      finalRoutes = await buildRoutePlanWithDirections({
        key,
        origin,
        destination,
        stations: stations.slice(0, 24),
        baseRoute,
        priority,
        observedAt
      });
      routeCount = finalRoutes.filter((route) => route.available).length;
    }

    return {
      available: routeCount > 0,
      source: routeCount > 0 ? "kakao-route-plan" : "fallback",
      sourceName: apiNames.kakaoRoutePlan,
      reason: routeCount > 0 && fallbackUsed
        ? "카카오내비 Directions 보정으로 목적지 경유 경로이탈 계산"
        : routeCount > 0
          ? "카카오내비 다중 목적지/출발지 기반 경로이탈 계산"
          : "목적지 기반 경유 경로 성공 응답 없음",
      observedAt,
      priority,
      requestCount: fallbackUsed ? Math.min(stations.length, 24) : stations.length,
      routeCount,
      baseRoute,
      routes: finalRoutes
    };
  } catch (error) {
    return {
      available: false,
      source: "fallback",
      sourceName: apiNames.kakaoRoutePlan,
      reason: error instanceof Error ? error.message : String(error),
      observedAt,
      priority,
      routes: []
    };
  }
}

async function getKakaoRouteDetail(payload) {
  const observedAt = new Date().toISOString();
  const key = getKakaoMobilityKey();
  const origin = normalizePoint(payload?.origin);
  const destination = normalizePoint(payload?.destination);
  const waypoints = normalizeDestinations(payload?.waypoints).slice(0, 5);
  const priority = normalizeKakaoPriority(payload?.priority, "TIME");

  if (!origin || !destination) {
    return {
      available: false,
      source: "invalid",
      sourceName: apiNames.kakaoDirections,
      reason: "출발지 또는 목적지 좌표가 없어 상세 경로를 계산하지 않았습니다.",
      observedAt,
      priority,
      route: null
    };
  }

  if (!key) {
    return {
      available: false,
      source: "fallback",
      sourceName: apiNames.kakaoDirections,
      reason: "KAKAO_MOBILITY_REST_API_KEY가 없어 직선 경로를 표시합니다.",
      observedAt,
      priority,
      route: null
    };
  }

  try {
    const route = waypoints.length
      ? await fetchKakaoWaypointDirection({
          key,
          origin,
          destination,
          waypoints,
          priority,
          summaryOnly: false,
          observedAt
        })
      : await fetchKakaoDirection({
          key,
          origin,
          destination,
          priority,
          summaryOnly: false,
          observedAt
        });

    return {
      available: true,
      source: "kakao-navi",
      sourceName: apiNames.kakaoDirections,
      reason: "카카오내비 Directions 상세 경로 반영",
      observedAt,
      priority,
      route
    };
  } catch (error) {
    return {
      available: false,
      source: "fallback",
      sourceName: apiNames.kakaoDirections,
      reason: error instanceof Error ? error.message : String(error),
      observedAt,
      priority,
      route: failedKakaoRoute(destination, error, observedAt, priority)
    };
  }
}

async function fetchKakaoDirection({ key, origin, destination, priority, summaryOnly, observedAt }) {
  const requestUrl = new URL(endpoints.kakaoDirections);
  requestUrl.searchParams.set("origin", kakaoCoordinate(origin));
  requestUrl.searchParams.set("destination", kakaoCoordinate(destination));
  requestUrl.searchParams.set("priority", priority);
  requestUrl.searchParams.set("car_fuel", "GASOLINE");
  requestUrl.searchParams.set("car_hipass", "false");
  requestUrl.searchParams.set("alternatives", "false");
  requestUrl.searchParams.set("road_details", "false");
  requestUrl.searchParams.set("summary", summaryOnly ? "true" : "false");

  const response = await fetchWithTimeout(requestUrl, {
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `KakaoAK ${key}`
    }
  }, 9000);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${apiNames.kakaoDirections} 호출 실패: HTTP ${response.status}${kakaoErrorText(text)}`);
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`${apiNames.kakaoDirections} JSON 파싱 실패`);
  }

  const route = Array.isArray(payload.routes)
    ? payload.routes.find((item) => item?.result_code === 0) ?? payload.routes[0]
    : null;

  if (!route || route.result_code !== 0) {
    const message = route?.result_msg || payload?.msg || payload?.message || "경로 없음";
    throw new Error(`${apiNames.kakaoDirections} 오류: ${message}`);
  }

  const summary = route.summary ?? {};
  const sections = Array.isArray(route.sections) ? route.sections : [];
  const roads = sections.flatMap((section) => Array.isArray(section.roads) ? section.roads : []);
  const guides = sections.flatMap((section) => Array.isArray(section.guides) ? section.guides : []);
  const distanceMeters = toNumber(summary.distance);
  const durationSeconds = toNumber(summary.duration);
  const points = summaryOnly ? [] : thinRoutePoints(extractKakaoRoutePoints(roads), 700);

  return {
    available: true,
    provider: "kakao-navi",
    source: "kakao-navi",
    sourceName: apiNames.kakaoDirections,
    stationId: destination.id,
    stationName: destination.name,
    observedAt,
    priority: clean(summary.priority) || priority,
    distanceMeters,
    distanceKm: Number.isFinite(distanceMeters) ? round(distanceMeters / 1000, 2) : null,
    durationSeconds,
    driveMinutes: Number.isFinite(durationSeconds) ? round(durationSeconds / 60, 1) : null,
    taxiFare: toNumber(summary.fare?.taxi),
    tollFare: toNumber(summary.fare?.toll),
    roadCount: roads.length,
    guideCount: guides.length,
    bound: normalizeKakaoBound(summary.bound),
    traffic: summarizeKakaoTraffic(roads),
    points
  };
}

function composeRoutePlanRoute(station, outbound, inbound, baseRoute, observedAt, priority) {
  if (!outbound?.available || !inbound?.available) {
    return failedKakaoRoute(station, new Error(outbound?.reason || inbound?.reason || "경유 경로 없음"), observedAt, priority);
  }

  const viaDistanceMeters = outbound.distanceMeters + inbound.distanceMeters;
  const viaDurationSeconds = outbound.durationSeconds + inbound.durationSeconds;
  const detourDistanceMeters = Math.max(0, viaDistanceMeters - baseRoute.distanceMeters);
  const detourSeconds = Math.max(0, viaDurationSeconds - baseRoute.durationSeconds);

  return {
    available: true,
    provider: "kakao-navi",
    source: "kakao-route-plan",
    sourceName: apiNames.kakaoRoutePlan,
    stationId: station.id,
    stationName: station.name,
    observedAt,
    priority,
    baseDistanceKm: baseRoute.distanceKm,
    baseDriveMinutes: baseRoute.driveMinutes,
    toStationDistanceKm: outbound.distanceKm,
    toStationDriveMinutes: outbound.driveMinutes,
    stationToDestinationDistanceKm: inbound.distanceKm,
    stationToDestinationDriveMinutes: inbound.driveMinutes,
    viaDistanceKm: round(viaDistanceMeters / 1000, 2),
    viaDriveMinutes: round(viaDurationSeconds / 60, 1),
    detourDistanceKm: round(detourDistanceMeters / 1000, 2),
    detourMinutes: round(detourSeconds / 60, 1),
    distanceMeters: viaDistanceMeters,
    distanceKm: round(detourDistanceMeters / 1000, 2),
    durationSeconds: viaDurationSeconds,
    driveMinutes: round(viaDurationSeconds / 60, 1),
    routePlan: true,
    legs: {
      originToStation: outbound,
      stationToDestination: inbound
    }
  };
}

async function buildRoutePlanWithDirections({ key, origin, destination, stations, baseRoute, priority, observedAt }) {
  return await mapWithConcurrency(stations, 4, async (station) => {
    try {
      const [outbound, inbound] = await Promise.all([
        fetchKakaoDirection({
          key,
          origin,
          destination: station,
          priority,
          summaryOnly: true,
          observedAt
        }),
        fetchKakaoDirection({
          key,
          origin: station,
          destination,
          priority,
          summaryOnly: true,
          observedAt
        })
      ]);
      return composeRoutePlanRoute(station, outbound, inbound, baseRoute, observedAt, priority);
    } catch (error) {
      return failedKakaoRoute(station, error, observedAt, priority);
    }
  });
}

async function fetchKakaoDestinations({ key, origin, destinations, priority, observedAt }) {
  const output = new Map();
  const chunks = chunkItems(destinations, 30);

  for (const chunk of chunks) {
    const keyToStation = new Map(chunk.map((station, index) => [String(index), station]));
    const payload = {
      origin: kakaoBodyPoint(origin),
      destinations: chunk.map((station, index) => ({
        ...kakaoBodyPoint(station),
        key: String(index)
      })),
      radius: 10000,
      priority,
      car_fuel: "GASOLINE",
      car_hipass: false
    };
    const routes = await fetchKakaoBatchRoutes(endpoints.kakaoDestinations, key, payload, keyToStation, observedAt, priority);
    for (const [stationId, route] of routes) output.set(stationId, route);
  }

  return output;
}

async function fetchKakaoOrigins({ key, origins, destination, priority, observedAt }) {
  const output = new Map();
  const chunks = chunkItems(origins, 30);

  for (const chunk of chunks) {
    const keyToStation = new Map(chunk.map((station, index) => [String(index), station]));
    const payload = {
      origins: chunk.map((station, index) => ({
        ...kakaoBodyPoint(station),
        key: String(index)
      })),
      destination: kakaoBodyPoint(destination),
      radius: 10000,
      priority,
      car_fuel: "GASOLINE",
      car_hipass: false
    };
    const routes = await fetchKakaoBatchRoutes(endpoints.kakaoOrigins, key, payload, keyToStation, observedAt, priority);
    for (const [stationId, route] of routes) output.set(stationId, route);
  }

  return output;
}

async function fetchKakaoBatchRoutes(url, key, payload, keyToStation, observedAt, priority) {
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `KakaoAK ${key}`
    },
    body: JSON.stringify(payload)
  }, 9000);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${apiNames.kakaoRoutePlan} 호출 실패: HTTP ${response.status}${kakaoErrorText(text)}`);
  }

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${apiNames.kakaoRoutePlan} JSON 파싱 실패`);
  }

  const output = new Map();
  const routes = Array.isArray(body.routes) ? body.routes : [];
  for (const route of routes) {
    const station = keyToStation.get(String(route?.key));
    if (!station) continue;
    output.set(station.id, normalizeKakaoBatchRoute(route, station, observedAt, priority));
  }

  for (const station of keyToStation.values()) {
    if (!output.has(station.id)) {
      output.set(station.id, failedKakaoRoute(station, new Error("경로 응답 없음"), observedAt, priority));
    }
  }

  return output;
}

function normalizeKakaoBatchRoute(route, station, observedAt, priority) {
  if (route?.result_code !== 0) {
    return failedKakaoRoute(station, new Error(route?.result_msg || "경로 없음"), observedAt, priority);
  }

  const summary = route.summary ?? {};
  const distanceMeters = toNumber(summary.distance);
  const durationSeconds = toNumber(summary.duration);
  if (!Number.isFinite(distanceMeters) || !Number.isFinite(durationSeconds)) {
    return failedKakaoRoute(station, new Error("거리/시간 응답 없음"), observedAt, priority);
  }

  return {
    available: true,
    provider: "kakao-navi",
    source: "kakao-navi",
    sourceName: apiNames.kakaoRoutePlan,
    stationId: station.id,
    stationName: station.name,
    observedAt,
    priority: clean(summary.priority) || priority,
    distanceMeters,
    distanceKm: round(distanceMeters / 1000, 2),
    durationSeconds,
    driveMinutes: round(durationSeconds / 60, 1),
    taxiFare: toNumber(summary.fare?.taxi),
    tollFare: toNumber(summary.fare?.toll)
  };
}

async function fetchKakaoWaypointDirection({ key, origin, destination, waypoints, priority, summaryOnly, observedAt }) {
  const payload = {
    origin: kakaoBodyPoint(origin),
    destination: kakaoBodyPoint(destination),
    waypoints: waypoints.map(kakaoBodyPoint),
    priority,
    car_fuel: "GASOLINE",
    car_hipass: false,
    alternatives: false,
    road_details: false,
    summary: summaryOnly
  };

  const response = await fetchWithTimeout(endpoints.kakaoWaypoints, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `KakaoAK ${key}`
    },
    body: JSON.stringify(payload)
  }, 9000);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${apiNames.kakaoDirections} 경유지 호출 실패: HTTP ${response.status}${kakaoErrorText(text)}`);
  }

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${apiNames.kakaoDirections} 경유지 JSON 파싱 실패`);
  }

  const route = Array.isArray(body.routes)
    ? body.routes.find((item) => item?.result_code === 0) ?? body.routes[0]
    : null;

  if (!route || route.result_code !== 0) {
    const message = route?.result_msg || body?.msg || body?.message || "경유지 경로 없음";
    throw new Error(`${apiNames.kakaoDirections} 경유지 오류: ${message}`);
  }

  const summary = route.summary ?? {};
  const sections = Array.isArray(route.sections) ? route.sections : [];
  const roads = sections.flatMap((section) => Array.isArray(section.roads) ? section.roads : []);
  const guides = sections.flatMap((section) => Array.isArray(section.guides) ? section.guides : []);
  const distanceMeters = toNumber(summary.distance);
  const durationSeconds = toNumber(summary.duration);
  const points = summaryOnly ? [] : thinRoutePoints(extractKakaoRoutePoints(roads), 900);

  return {
    available: true,
    provider: "kakao-navi",
    source: "kakao-waypoint",
    sourceName: apiNames.kakaoDirections,
    stationId: waypoints[0]?.id || destination.id,
    stationName: waypoints[0]?.name || destination.name,
    destinationId: destination.id,
    destinationName: destination.name,
    observedAt,
    priority: clean(summary.priority) || priority,
    distanceMeters,
    distanceKm: Number.isFinite(distanceMeters) ? round(distanceMeters / 1000, 2) : null,
    durationSeconds,
    driveMinutes: Number.isFinite(durationSeconds) ? round(durationSeconds / 60, 1) : null,
    taxiFare: toNumber(summary.fare?.taxi),
    tollFare: toNumber(summary.fare?.toll),
    roadCount: roads.length,
    guideCount: guides.length,
    bound: normalizeKakaoBound(summary.bound),
    traffic: summarizeKakaoTraffic(roads),
    points
  };
}

function normalizePoint(value) {
  const lat = Number(value?.lat);
  const lon = Number(value?.lon ?? value?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    id: clean(value?.id),
    name: clean(value?.name),
    lat,
    lon
  };
}

function normalizeDestinations(destinations) {
  if (!Array.isArray(destinations)) return [];
  return destinations
    .map(normalizePoint)
    .filter(Boolean)
    .filter((destination, index, list) => {
      const key = destination.id || `${destination.lat},${destination.lon}`;
      return list.findIndex((item) => (item.id || `${item.lat},${item.lon}`) === key) === index;
    });
}

function normalizeKakaoPriority(value, fallback) {
  const priority = clean(value).toUpperCase();
  return ["RECOMMEND", "TIME", "DISTANCE"].includes(priority) ? priority : fallback;
}

function kakaoCoordinate(point) {
  return `${point.lon},${point.lat}`;
}

function kakaoBodyPoint(point) {
  return {
    x: String(point.lon),
    y: String(point.lat),
    name: clean(point.name) || clean(point.id) || "위치"
  };
}

function extractKakaoRoutePoints(roads) {
  const points = [];
  for (const road of roads) {
    const vertexes = Array.isArray(road.vertexes) ? road.vertexes : [];
    for (let index = 0; index < vertexes.length - 1; index += 2) {
      const lon = Number(vertexes[index]);
      const lat = Number(vertexes[index + 1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const previous = points.at(-1);
      if (previous && previous[0] === lat && previous[1] === lon) continue;
      points.push([lat, lon]);
    }
  }
  return points;
}

function thinRoutePoints(points, limit) {
  if (points.length <= limit) return points;
  const thinned = [];
  const step = (points.length - 1) / (limit - 1);
  for (let index = 0; index < limit; index += 1) {
    thinned.push(points[Math.round(index * step)]);
  }
  return thinned;
}

function normalizeKakaoBound(bound) {
  if (!bound) return null;
  return {
    minX: toNumber(bound.min_x),
    minY: toNumber(bound.min_y),
    maxX: toNumber(bound.max_x),
    maxY: toNumber(bound.max_y)
  };
}

function summarizeKakaoTraffic(roads) {
  const speeds = roads.map((road) => toNumber(road.traffic_speed)).filter(Number.isFinite);
  const states = roads.map((road) => toNumber(road.traffic_state)).filter(Number.isFinite);
  return {
    avgSpeedKph: speeds.length ? round(avg(speeds), 1) : null,
    slowRoadCount: states.filter((state) => state >= 3).length,
    blockedRoadCount: states.filter((state) => state >= 5).length
  };
}

function failedKakaoRoute(destination, error, observedAt, priority) {
  return {
    available: false,
    provider: "kakao-navi",
    source: "fallback",
    sourceName: apiNames.kakaoDirections,
    stationId: destination.id,
    stationName: destination.name,
    observedAt,
    priority,
    reason: error instanceof Error ? error.message : String(error)
  };
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

function kakaoErrorText(text) {
  if (!text) return "";
  try {
    const payload = JSON.parse(text);
    const message = payload?.msg || payload?.message || payload?.error || "";
    return message ? ` (${message})` : "";
  } catch {
    return "";
  }
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  });
  await Promise.all(workers);
  return results;
}

function chunkItems(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function startSnapshotCollector() {
  if (!collectorEnabled) {
    collectorLastError = "H2_SNAPSHOT_COLLECTOR=0으로 자동 수집이 꺼져 있습니다.";
    return;
  }

  if (!getServiceKey()) {
    collectorLastError = "PUBLIC_DATA_SERVICE_KEY가 없어 자동 수집을 시작하지 않았습니다.";
    return;
  }

  collectorStartedAt = new Date().toISOString();
  collectorNextRunAt = new Date(Date.now() + collectorIntervalMs).toISOString();
  void runSnapshotCollection("startup");
  collectorTimer = setInterval(() => {
    void runSnapshotCollection("interval");
  }, collectorIntervalMs);
}

async function runSnapshotCollection(reason) {
  if (collectorRunning) return;
  collectorRunning = true;
  try {
    const payload = await getStationPayload({
      forceRefresh: true,
      forceMock: false,
      writeSource: "auto-collector"
    });
    collectorLastRunAt = payload.receivedAt;
    collectorLastSavedRows = payload.collection?.savedRows ?? 0;
    collectorLastError = null;
    console.log(`[collector] ${reason}: saved ${collectorLastSavedRows} nationwide realtime rows at ${collectorLastRunAt}`);
  } catch (error) {
    collectorLastRunAt = new Date().toISOString();
    collectorLastError = error instanceof Error ? error.message : String(error);
    console.error(`[collector] ${reason}: ${collectorLastError}`);
  } finally {
    collectorRunning = false;
    collectorNextRunAt = new Date(Date.now() + collectorIntervalMs).toISOString();
  }
}

function getCollectorStatus() {
  return {
    enabled: collectorEnabled && Boolean(getServiceKey()),
    running: collectorRunning,
    intervalMinutes: collectorIntervalMinutes,
    startedAt: collectorStartedAt,
    lastRunAt: collectorLastRunAt,
    nextRunAt: collectorNextRunAt,
    lastSavedRows: collectorLastSavedRows,
    lastError: collectorLastError,
    lastSnapshotWrite,
    snapshotPath
  };
}

async function updateHistoryAndAnalyze(stations, observedAt, writeSource) {
  const savedRows = await appendStationSnapshots(stations, observedAt, writeSource);
  const analysis = await buildHistoryAnalysis(observedAt);
  return {
    ...analysis,
    savedRows
  };
}

async function appendStationSnapshots(stations, observedAt, writeSource) {
  const observedDate = new Date(observedAt);
  const lines = stations
    .filter((station) => station.realtime)
    .map((station) => JSON.stringify({
      observedAt,
      day: observedDate.getDay(),
      hour: observedDate.getHours(),
      stationId: station.id,
      stationName: station.name,
      address: station.address,
      waitCars: station.realtime?.waitCars ?? null,
      fillableCars: station.realtime?.fillableCars ?? null,
      congestion: station.realtime?.congestion ?? "",
      operationStatus: station.realtime?.operationStatus ?? "",
      posStatus: station.realtime?.posStatus ?? "",
      ttPressure: station.realtime?.ttPressure ?? null,
      realtimeUpdatedAt: station.realtime?.lastUpdated ?? "",
      reservationOnly: isReservationOnlyStation(station),
      collectionSource: writeSource
    }));

  if (lines.length === 0) return 0;

  await mkdir(dataDir, { recursive: true });
  await appendFile(snapshotPath, `${lines.join("\n")}\n`, "utf8");
  lastSnapshotWrite = {
    observedAt,
    savedRows: lines.length,
    writeSource,
    snapshotPath
  };
  return lines.length;
}

async function buildHistoryAnalysis(observedAt) {
  const records = await readSnapshotRecords();
  if (records.length === 0) return emptyHistoryAnalysis(observedAt);

  const current = new Date(observedAt);
  const currentDay = current.getDay();
  const currentHour = current.getHours();
  const predictionsById = new Map();
  const recordsByStation = groupBy(records, (record) => record.stationId);

  for (const [stationId, stationRecords] of recordsByStation) {
    const sameDayHour = stationRecords.filter((record) => record.day === currentDay && record.hour === currentHour);
    const sameHour = stationRecords.filter((record) => record.hour === currentHour);
    const basis = sameDayHour.length >= 3 ? sameDayHour : sameHour.length >= 3 ? sameHour : stationRecords;
    predictionsById.set(stationId, buildPrediction(stationId, basis, sameDayHour.length >= 3 ? "same-day-hour" : sameHour.length >= 3 ? "same-hour" : "station-history"));
  }

  const hourly = [...groupBy(records, (record) => String(record.hour)).entries()]
    .map(([hour, hourRecords]) => ({
      hour: Number(hour),
      sampleCount: hourRecords.length,
      avgWaitCars: round(avg(hourRecords.map((record) => record.waitCars).filter(Number.isFinite)), 1),
      avgFillableCars: averageMetric(hourRecords.map((record) => record.fillableCars), 1),
      busyRate: round(rate(hourRecords, isBusySnapshot), 2)
    }))
    .filter((bucket) => bucket.sampleCount > 0)
    .sort((a, b) => b.avgWaitCars - a.avgWaitCars || b.busyRate - a.busyRate)
    .slice(0, 4);

  const heatmap = [...groupBy(records, (record) => `${record.day}-${record.hour}`).entries()]
    .map(([key, bucketRecords]) => {
      const [day, hour] = key.split("-").map(Number);
      return {
        day,
        hour,
        sampleCount: bucketRecords.length,
        avgWaitCars: round(avg(bucketRecords.map((record) => record.waitCars).filter(Number.isFinite)), 1),
        avgFillableCars: averageMetric(bucketRecords.map((record) => record.fillableCars), 1),
        busyRate: round(rate(bucketRecords, isBusySnapshot), 2)
      };
    })
    .sort((a, b) => a.day - b.day || a.hour - b.hour);

  const lastObservedAt = records
    .map((record) => record.observedAt)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;

  return {
    predictionsById,
    summary: {
      status: "ready",
      snapshotPath,
      recordCount: records.length,
      stationCount: recordsByStation.size,
      lastObservedAt,
      currentBucket: {
        day: currentDay,
        hour: currentHour,
        label: `${weekdayName(currentDay)} ${String(currentHour).padStart(2, "0")}시`
      },
      busiestHours: hourly,
      heatmap,
      minimumSamplesForStablePattern: 3
    }
  };
}

async function readSnapshotRecords() {
  if (!existsSync(snapshotPath)) return [];
  const text = await readFile(snapshotPath, "utf8");
  const lines = text.split(/\r?\n/).filter(Boolean).slice(-maxHistoryRecords);
  const records = [];

  for (const line of lines) {
    try {
      const record = JSON.parse(line);
      if (record.stationId && record.observedAt) records.push(record);
    } catch {
      // Ignore malformed runtime records; the next API snapshot remains usable.
    }
  }

  return records;
}

function buildPrediction(stationId, records, source) {
  const sampleCount = records.length;
  const waitValues = records.map((record) => record.waitCars).filter(Number.isFinite);
  const fillableValues = records.map((record) => record.fillableCars).filter(Number.isFinite);
  const avgWaitCars = round(avg(waitValues), 1);
  const avgFillableCars = averageMetric(fillableValues, 1);
  const busyRate = round(rate(records, isBusySnapshot), 2);
  const lowSupplyRate = round(rate(records, isLowSupplySnapshot), 2);
  const risk = patternRisk(sampleCount, avgWaitCars, busyRate);

  return {
    stationId,
    source,
    sampleCount,
    avgWaitCars,
    avgFillableCars,
    busyRate,
    lowSupplyRate,
    risk,
    label: predictionRiskLabel(risk),
    reason: sampleCount < 3
      ? `기록 ${sampleCount}건으로 예측 불확실`
      : `평균 대기 ${avgWaitCars}대, 평균 공급 ${Number.isFinite(avgFillableCars) ? `${avgFillableCars}대` : "미확인"}, 혼잡률 ${Math.round(busyRate * 100)}%`
  };
}

function applyPredictionFeatures(stations, predictionsById) {
  for (const station of stations) {
    station.prediction = predictionsById.get(station.id) ?? {
      stationId: station.id,
      source: "no-history",
      sampleCount: 0,
      avgWaitCars: null,
      avgFillableCars: null,
      busyRate: null,
      lowSupplyRate: null,
      risk: "unknown",
      label: "예측 불확실",
      reason: "아직 누적 기록 없음"
    };
  }
}

function emptyHistoryAnalysis(observedAt) {
  const current = new Date(observedAt);
  return {
    predictionsById: new Map(),
    summary: {
      status: "collecting",
      snapshotPath,
      recordCount: 0,
      stationCount: 0,
      lastObservedAt: null,
      currentBucket: {
        day: current.getDay(),
        hour: current.getHours(),
        label: `${weekdayName(current.getDay())} ${String(current.getHours()).padStart(2, "0")}시`
      },
      busiestHours: [],
      heatmap: [],
      minimumSamplesForStablePattern: 3
    }
  };
}

function isBusySnapshot(record) {
  return (
    (Number.isFinite(record.waitCars) && record.waitCars >= 3) ||
    /혼잡|대기|지연/.test(record.congestion ?? "")
  );
}

function isLowSupplySnapshot(record) {
  return Number.isFinite(record.fillableCars) && record.fillableCars < 4;
}

function patternRisk(sampleCount, avgWaitCars, busyRate) {
  if (sampleCount < 3) return "unknown";
  if (avgWaitCars >= 3 || busyRate >= 0.6) return "high";
  if (avgWaitCars >= 1 || busyRate >= 0.25) return "medium";
  return "low";
}

function predictionRiskLabel(risk) {
  if (risk === "high") return "예상 높음";
  if (risk === "medium") return "예상 보통";
  if (risk === "low") return "예상 낮음";
  return "예측 불확실";
}

async function fetchLiveSources(serviceKey) {
  const [operation, current, facilities, averagePrice] = await Promise.all([
    fetchPublicData("operation", endpoints.operation, serviceKey),
    fetchPublicData("current", endpoints.current, serviceKey),
    fetchPublicData("facilities", endpoints.facilities, serviceKey),
    fetchPublicData("averagePrice", endpoints.averagePrice, serviceKey)
  ]);

  return {
    operation: extractItems(operation),
    current: extractItems(current),
    facilities: extractItems(facilities),
    averagePrice: extractItems(averagePrice)
  };
}

async function fetchPublicData(name, endpoint, serviceKey) {
  const response = await fetch(appendServiceKey(endpoint, serviceKey), {
    headers: {
      accept: "application/json"
    }
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${apiNames[name]} 호출 실패: HTTP ${response.status}`);
  }

  if (/^\s*</.test(text)) {
    throw new Error(`${apiNames[name]}가 JSON 대신 XML/HTML을 반환했습니다. 인증키와 활용신청 상태를 확인하세요.`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${apiNames[name]} JSON 파싱 실패`);
  }
}

async function loadMockSources() {
  const [operation, current, facilities, averagePrice] = await Promise.all([
    readJson(join(publicDir, "sample-data", "operation.json")),
    readJson(join(publicDir, "sample-data", "current.json")),
    readJson(join(publicDir, "sample-data", "facilities.json")),
    readJson(join(publicDir, "sample-data", "average-price.json"))
  ]);
  return { operation, current, facilities, averagePrice };
}

async function readJson(pathname) {
  return JSON.parse(await readFile(pathname, "utf8"));
}

function normalizeStations(operationItems, currentItems, facilityItems, averagePriceItems) {
  const realtimeById = new Map();
  for (const item of currentItems) {
    const id = clean(item.chrstn_mno);
    if (!id) continue;
    realtimeById.set(id, {
      lastUpdated: clean(item.last_mdfcn_dt),
      ttPressure: toNumber(item.tt_pressr),
      fillableCars: toNumber(item.prfect_elctc_posbl_alge),
      waitCars: toNumber(item.wait_vhcle_alge),
      congestionCode: clean(item.cnf_sttus_cd),
      congestion: clean(item.cnf_sttus_nm),
      operationCode: clean(item.oper_sttus_cd),
      operationStatus: clean(item.oper_sttus_nm),
      posCode: clean(item.pos_sttus_cd),
      posStatus: clean(item.pos_sttus_nm)
    });
  }

  const facilitiesById = new Map();
  for (const item of facilityItems) {
    if (isDeleted(item.del_at)) continue;
    const id = clean(item.chrstn_mno);
    const name = clean(item.adi_info_se_nm);
    if (!id || !name) continue;
    const list = facilitiesById.get(id) ?? [];
    list.push({
      code: clean(item.adi_info_se_cd),
      name,
      lastUpdated: clean(item.last_mdfcn_dt)
    });
    facilitiesById.set(id, list);
  }

  const averagePriceById = new Map();
  for (const item of averagePriceItems) {
    const id = clean(item.chrstn_mno);
    const price = toNumber(item.chrstn_untpc);
    if (!id || price === null) continue;

    const previous = averagePriceById.get(id);
    const next = {
      value: price,
      stationName: clean(item.chrstn_nm),
      area: clean(item.area_nm),
      baseMonth: clean(item.sm_date)
    };

    if (!previous || next.baseMonth.localeCompare(previous.baseMonth) >= 0) {
      averagePriceById.set(id, next);
    }
  }

  const stationsById = new Map();
  for (const item of operationItems) {
    if (isDeleted(item.del_at)) continue;
    const id = clean(item.chrstn_mno);
    if (!id) continue;

    const existing = stationsById.get(id);
    const price = parsePrice(item.ntsl_pc);
    const next = existing ?? {
      id,
      name: clean(item.chrstn_nm),
      phone: clean(item.chrstn_cttpc),
      roadAddress: clean(item.road_nm_addr),
      lotAddress: clean(item.lotno_addr),
      computerized: clean(item.cmpt_yn),
      stationType: clean(item.chrstn_ty_nm),
      equipmentType: clean(item.echrgeqp_ty_nm),
      chargerTypes: [],
      chargerNote: clean(item.chrstn_ty_rm),
      supplyMethod: clean(item.spldmd_mn_mthd_nm),
      event: clean(item.event_cn),
      vehicleKinds: [],
      paymentMethods: [],
      availableDays: clean(item.use_posbl_dotw),
      hours: buildHours(item),
      breakTime: {
        start: clean(item.rest_bgng_hr),
        end: clean(item.rest_end_hr)
      },
      reservationAvailable: clean(item.rsvt_posbl_yn),
      lon: toNumber(item.lon),
      lat: toNumber(item.let),
      operating: clean(item.oper_yn),
      realTimeAvailable: clean(item.rltm_info_yn),
      lastUpdated: clean(item.last_mdfcn_dt),
      timestamp: clean(item.timestamp),
      prices: [],
      price: null,
      priceSource: "",
      averagePrice: null,
      realtime: null,
      facilities: []
    };

    addUnique(next.chargerTypes, clean(item.chrgr_ty_nm));
    addUnique(next.vehicleKinds, clean(item.vhcle_knd_nm));
    addUnique(next.paymentMethods, clean(item.setle_mthd_nm));

    if (price !== null) {
      next.prices.push({
        value: price,
        raw: clean(item.ntsl_pc),
        vehicleKind: clean(item.vhcle_knd_nm)
      });
      next.price = next.price === null ? price : Math.min(next.price, price);
      next.priceSource = "운영정보 판매가격";
    }

    if (!next.name) next.name = clean(item.chrstn_nm);
    if (!next.roadAddress) next.roadAddress = clean(item.road_nm_addr);
    if (!next.lotAddress) next.lotAddress = clean(item.lotno_addr);
    if (!Number.isFinite(next.lon)) next.lon = toNumber(item.lon);
    if (!Number.isFinite(next.lat)) next.lat = toNumber(item.let);

    stationsById.set(id, next);
  }

  for (const station of stationsById.values()) {
    const averagePrice = averagePriceById.get(station.id) ?? null;
    station.averagePrice = averagePrice;
    if (station.price === null && averagePrice) {
      station.price = averagePrice.value;
      station.priceSource = `월평균판매가격 ${averagePrice.baseMonth}`;
    }
    station.realtime = realtimeById.get(station.id) ?? null;
    station.facilities = facilitiesById.get(station.id) ?? [];
    station.address = station.roadAddress || station.lotAddress;
    station.dataQuality = {
      hasCoordinates: Number.isFinite(station.lat) && Number.isFinite(station.lon),
      hasPrice: station.price !== null,
      hasRealtime: Boolean(station.realtime),
      hasFacilities: station.facilities.length > 0
    };
  }

  return [...stationsById.values()].sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

function buildHours(item) {
  return {
    mon: { start: clean(item.usebhr_hr_mon), end: clean(item.useehr_hr_mon) },
    tue: { start: clean(item.usebhr_hr_tues), end: clean(item.useehr_hr_tues) },
    wed: { start: clean(item.usebhr_hr_wed), end: clean(item.useehr_hr_wed) },
    thu: { start: clean(item.usebhr_hr_thur), end: clean(item.useehr_hr_thur) },
    fri: { start: clean(item.usebhr_hr_fri), end: clean(item.useehr_hr_fri) },
    sat: { start: clean(item.usebhr_hr_sat), end: clean(item.useehr_hr_sat) },
    sun: { start: clean(item.usebhr_hr_sun), end: clean(item.useehr_hr_sun) },
    holiday: { start: clean(item.usebhr_hr_hldy), end: clean(item.useehr_hr_hldy) }
  };
}

function extractItems(payload) {
  if (Array.isArray(payload)) return payload;
  const body = payload?.response?.body ?? payload?.body ?? payload;
  const items = body?.items?.item ?? body?.items ?? payload?.items?.item ?? payload?.items ?? [];
  if (Array.isArray(items)) return items;
  if (items && typeof items === "object") return [items];
  return [];
}

function appendServiceKey(endpoint, serviceKey) {
  const hasEncodedBytes = /%[0-9A-Fa-f]{2}/.test(serviceKey);
  const encodedKey = hasEncodedBytes ? serviceKey : encodeURIComponent(serviceKey);
  return `${endpoint}${endpoint.includes("?") ? "&" : "?"}serviceKey=${encodedKey}`;
}

function getServiceKey() {
  return (
    process.env.PUBLIC_DATA_SERVICE_KEY ||
    process.env.DATA_GO_KR_SERVICE_KEY ||
    process.env.H2_API_SERVICE_KEY ||
    ""
  ).trim();
}

function getSeoulTrafficKey() {
  return (
    process.env.SEOUL_TRAFFIC_API_KEY ||
    process.env.SEOUL_OPEN_DATA_KEY ||
    process.env.SEOUL_TRAFFIC_SERVICE_KEY ||
    ""
  ).trim();
}

function getKakaoMobilityKey() {
  return (
    process.env.KAKAO_MOBILITY_REST_API_KEY ||
    process.env.KAKAO_REST_API_KEY ||
    process.env.KAKAO_NAVI_API_KEY ||
    ""
  ).trim();
}

function getKakaoLocalKey() {
  return (
    process.env.KAKAO_REST_API_KEY ||
    process.env.KAKAO_MOBILITY_REST_API_KEY ||
    process.env.KAKAO_NAVI_API_KEY ||
    ""
  ).trim();
}

function getKakaoMapsJavascriptKey() {
  return (
    process.env.KAKAO_MAPS_JAVASCRIPT_KEY ||
    process.env.KAKAO_JAVASCRIPT_KEY ||
    ""
  ).trim();
}

function loadDotEnv() {
  const path = join(__dirname, ".env");
  if (!existsSync(path)) return;

  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function clean(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function xmlText(text, tagName) {
  const pattern = new RegExp(`<${tagName}>(.*?)<\\/${tagName}>`, "s");
  const match = text.match(pattern);
  return match ? decodeXml(match[1].trim()) : "";
}

function decodeXml(value) {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

function toNumber(value) {
  const text = clean(value).replace(/,/g, "");
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function parsePrice(value) {
  const text = clean(value);
  if (!text) return null;
  const match = text.replace(/,/g, "").match(/\d+(\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function isDeleted(value) {
  return ["Y", "1", "true", "TRUE"].includes(clean(value));
}

function addUnique(list, value) {
  if (value && !list.includes(value)) list.push(value);
}

function isCapitalRegionAddressStation(station) {
  return isSeoulAddressStation(station) || isGyeonggiAddressStation(station);
}

function isSeoulAddressStation(station) {
  return [station.address, station.roadAddress, station.lotAddress]
    .filter(Boolean)
    .some((address) => {
      const value = String(address).trim();
      return value.startsWith("서울 ") || value.startsWith("서울특별시") || value.startsWith("서울시 ");
    });
}

function isGyeonggiAddressStation(station) {
  return [station.address, station.roadAddress, station.lotAddress]
    .filter(Boolean)
    .some((address) => {
      const value = String(address).trim();
      return value.startsWith("경기 ") || value.startsWith("경기도");
    });
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const radius = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(value) {
  return (value * Math.PI) / 180;
}

function isReservationOnlyStation(station) {
  const searchable = `${station.name} ${station.event} ${station.chargerNote}`;
  return /사전\s*예약|예약제/.test(searchable);
}

function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }
  return map;
}

function avg(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function averageMetric(values, digits = 0) {
  const numeric = values.filter(Number.isFinite);
  return numeric.length ? round(avg(numeric), digits) : null;
}

function rate(records, predicate) {
  if (records.length === 0) return 0;
  return records.filter(predicate).length / records.length;
}

function round(value, digits = 0) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function weekdayName(day) {
  return ["일", "월", "화", "수", "목", "금", "토"][day] ?? "";
}

async function serveStatic(pathname, res) {
  const safePath = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  const requestedPath = safePath === "/" ? "/index.html" : safePath;
  const filePath = join(publicDir, requestedPath);

  if (!filePath.startsWith(publicDir) || !existsSync(filePath)) {
    sendJson(res, 404, { error: "NOT_FOUND" });
    return;
  }

  res.writeHead(200, {
    "content-type": mimeTypes[extname(filePath)] ?? "application/octet-stream",
    "cache-control": "no-store"
  });
  createReadStream(filePath).pipe(res);
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) {
      throw new Error("요청 본문이 너무 큽니다.");
    }
    chunks.push(chunk);
  }

  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("JSON 요청 본문을 파싱할 수 없습니다.");
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(payload, null, 2));
}
