const DEFAULT_LOCATION = {
  lat: 37.5547,
  lon: 126.9707,
  label: "서울역"
};

const DEFAULT_DESTINATION = {
  lat: 35.1151,
  lon: 129.0415,
  label: "부산역"
};

const DEFAULT_VEHICLE = {
  socPercent: 70,
  fullRangeKm: 600,
  reserveKm: 30
};

const AVG_DRIVE_SPEED_KPH = 42;
const ROUTE_DISTANCE_FACTOR = 1.22;
const WAIT_MINUTES_PER_CAR = 7;
const KAKAO_ROUTE_PRIORITY = "TIME";
const ROUTE_SUMMARY_LIMIT = 80;
const ROUTE_PLAN_LIMIT = 90;
const INITIAL_LEAFLET_ZOOM = 11;
const INITIAL_KAKAO_LEVEL = 7;
const LOW_SUPPLY_CAR_THRESHOLD = 4;
const MODERATE_SUPPLY_CAR_THRESHOLD = 10;
const H2_RESERVATION_URL = "https://www.h2nbiz.or.kr";
const H2CARE_APP_URL = "https://apps.apple.com/kr/app/id1501674353";
const scoreProfiles = {
  balanced: { price: 0.34, distance: 0.33, time: 0.33 },
  price: { price: 0.72, distance: 0.16, time: 0.12 },
  distance: { price: 0.12, distance: 0.72, time: 0.16 },
  time: { price: 0.12, distance: 0.22, time: 0.66 }
};

const state = {
  uiMode: "rts-console",
  stations: [],
  rankedStations: [],
  insights: null,
  collector: null,
  traffic: null,
  selectedId: null,
  location: { ...DEFAULT_LOCATION },
  destination: { ...DEFAULT_DESTINATION },
  vehicle: { ...DEFAULT_VEHICLE },
  filters: {
    price: "all",
    distance: "50",
    time: "90",
    routePolicy: "detour",
    onRouteKm: "5",
    onRouteMinutes: "10",
    maxDetourKm: "25",
    maxExtraMinutes: "30",
    reservation: "exclude",
    busOnly: "exclude"
  },
  map: null,
  stationLayer: null,
  routeLayer: null,
  userMarker: null,
  markers: new Map(),
  mapProvider: "leaflet",
  mapConfig: null,
  kakao: {
    stationOverlays: [],
    routeOverlays: [],
    popupOverlay: null
  },
  routeSummaries: new Map(),
  routeSummaryKey: "",
  routeSummaryLoading: false,
  routeSummaryStatus: null,
  routeAbortController: null,
  selectedRoute: null,
  selectedRouteKey: "",
  selectedRouteLoading: false,
  selectedRouteStatus: null,
  selectedRouteAbortController: null,
  destinationMarker: null,
  destinationSearchLoading: false,
  destinationSearchResults: [],
  destinationSearchStatus: null,
  destinationSearchAbortController: null,
  overlayWidgets: {
    compare: { minimized: true, x: 0, y: 0 },
    heatmap: { minimized: true, x: 0, y: 0 },
    legend: { minimized: true, x: 0, y: 0 },
    detail: { minimized: false, x: 0, y: 0 },
    rtsMinimap: { minimized: false, x: 0, y: 0 },
    rtsTelemetry: { minimized: false, x: 0, y: 0 },
    rtsCommandDock: { minimized: false, x: 0, y: 0 }
  },
  activeWidgetDrag: null,
  rtsAnimationFrame: 0
};

const elements = {};

document.addEventListener("DOMContentLoaded", async () => {
  initUiMode();
  bindElements();
  await initMap();
  bindEvents();
  updateFilterButtons();
  loadStations();
});

function bindElements() {
  Object.assign(elements, {
    sourceBadge: document.querySelector("#sourceBadge"),
    modeToggleBtn: document.querySelector("#modeToggleBtn"),
    refreshBtn: document.querySelector("#refreshBtn"),
    locateBtn: document.querySelector("#locateBtn"),
    latInput: document.querySelector("#latInput"),
    lonInput: document.querySelector("#lonInput"),
    locationStatus: document.querySelector("#locationStatus"),
    socInput: document.querySelector("#socInput"),
    fullRangeInput: document.querySelector("#fullRangeInput"),
    reserveRangeInput: document.querySelector("#reserveRangeInput"),
    vehicleStatus: document.querySelector("#vehicleStatus"),
    scenarioPanel: document.querySelector("#scenarioPanel"),
    destLabelInput: document.querySelector("#destLabelInput"),
    destLatInput: document.querySelector("#destLatInput"),
    destLonInput: document.querySelector("#destLonInput"),
    destinationSearchInput: document.querySelector("#destinationSearchInput"),
    destinationSearchBtn: document.querySelector("#destinationSearchBtn"),
    destinationSearchResults: document.querySelector("#destinationSearchResults"),
    destinationStatus: document.querySelector("#destinationStatus"),
    destinationPresetButtons: document.querySelectorAll("[data-destination-preset]"),
    routePolicySummary: document.querySelector("#routePolicySummary"),
    kpiStrip: document.querySelector("#kpiStrip"),
    filterSummary: document.querySelector("#filterSummary"),
    insightPanel: document.querySelector("#insightPanel"),
    recommendCompare: document.querySelector("#recommendCompare"),
    heatmapPanel: document.querySelector("#heatmapPanel"),
    mapLegend: document.querySelector("#mapLegend"),
    rtsHud: document.querySelector("#rtsHud"),
    rtsUnitTrack: document.querySelector("#rtsUnitTrack"),
    rtsMinimap: document.querySelector("#rtsMinimap"),
    rtsTelemetry: document.querySelector("#rtsTelemetry"),
    rtsCommandDock: document.querySelector("#rtsCommandDock"),
    intervalButtons: document.querySelectorAll(".interval-button"),
    priceRecommendation: document.querySelector("#priceRecommendation"),
    distanceRecommendation: document.querySelector("#distanceRecommendation"),
    timeRecommendation: document.querySelector("#timeRecommendation"),
    stationCount: document.querySelector("#stationCount"),
    stationTotal: document.querySelector("#stationTotal"),
    stationList: document.querySelector("#stationList"),
    detailPanel: document.querySelector("#detailPanel")
  });
  syncModeToggle();
}

function initUiMode() {
  const mode = new URLSearchParams(window.location.search).get("ui");
  state.uiMode = mode === "standard" ? "default" : "rts-console";
  document.body.classList.toggle("ui-rts-console", state.uiMode === "rts-console");
}

function syncModeToggle() {
  if (!elements.modeToggleBtn) return;
  const url = new URL(window.location.href);
  if (state.uiMode === "rts-console") {
    url.searchParams.set("ui", "standard");
    elements.modeToggleBtn.textContent = "STANDARD";
    elements.modeToggleBtn.setAttribute("aria-label", "일반 모드로 전환");
    elements.modeToggleBtn.href = `${url.pathname}${url.search}`;
    return;
  }

  url.searchParams.delete("ui");
  elements.modeToggleBtn.textContent = "CONSOLE";
  elements.modeToggleBtn.setAttribute("aria-label", "콘솔 모드로 전환");
  elements.modeToggleBtn.href = `${url.pathname}${url.search}`;
}

async function initMap() {
  state.mapConfig = await loadClientConfig();
  if (state.mapConfig?.kakaoMapsJavascriptKey) {
    try {
      await loadKakaoMapsSdk(state.mapConfig.kakaoMapsJavascriptKey);
      initKakaoMap();
      return;
    } catch (error) {
      console.warn("Kakao Maps SDK load failed, falling back to Leaflet.", error);
    }
  }

  initLeafletMap();
}

async function loadClientConfig() {
  try {
    const response = await fetch("/api/client-config", {
      headers: { accept: "application/json" }
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function loadKakaoMapsSdk(appKey) {
  if (window.kakao?.maps) {
    return new Promise((resolve) => window.kakao.maps.load(resolve));
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(appKey)}&autoload=false`;
    script.async = true;
    script.onload = () => {
      if (!window.kakao?.maps) {
        reject(new Error("Kakao Maps SDK 객체를 찾을 수 없습니다."));
        return;
      }
      window.kakao.maps.load(resolve);
    };
    script.onerror = () => reject(new Error("Kakao Maps SDK 로드 실패"));
    document.head.appendChild(script);
  });
}

function initKakaoMap() {
  state.mapProvider = "kakao";
  const container = document.querySelector("#map");
  state.map = new kakao.maps.Map(container, {
    center: new kakao.maps.LatLng(state.location.lat, state.location.lon),
    level: INITIAL_KAKAO_LEVEL
  });

  state.map.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);
  renderUserMarker();
  renderDestinationMarker();
  centerMapOnLocation();
  bindMapViewEvents();
  window.addEventListener("resize", handleViewportResize);
  handleViewportResize();
}

function initLeafletMap() {
  state.mapProvider = "leaflet";
  state.map = L.map("map", {
    zoomControl: false,
    minZoom: 7
  }).setView([state.location.lat, state.location.lon], INITIAL_LEAFLET_ZOOM);

  L.control.zoom({ position: "topright" }).addTo(state.map);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(state.map);

  state.routeLayer = L.layerGroup().addTo(state.map);
  state.stationLayer = L.layerGroup().addTo(state.map);
  renderUserMarker();
  renderDestinationMarker();
  centerMapOnLocation();
  bindMapViewEvents();
  window.addEventListener("resize", handleViewportResize);
  handleViewportResize();
}

function bindEvents() {
  elements.refreshBtn.addEventListener("click", () => loadStations({ refresh: true }));
  elements.locateBtn.addEventListener("click", requestCurrentLocation);
  setupFloatingWidgets();

  for (const input of [elements.latInput, elements.lonInput]) {
    input.addEventListener("change", () => {
      const lat = Number(elements.latInput.value);
      const lon = Number(elements.lonInput.value);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      setLocation({ lat, lon, label: "수동 입력" });
    });
  }

  for (const input of [elements.socInput, elements.fullRangeInput, elements.reserveRangeInput]) {
    input?.addEventListener("change", () => {
      setVehicleState({
        socPercent: Number(elements.socInput.value),
        fullRangeKm: Number(elements.fullRangeInput.value),
        reserveKm: Number(elements.reserveRangeInput.value)
      });
    });
  }

  for (const input of [elements.destLabelInput, elements.destLatInput, elements.destLonInput]) {
    input?.addEventListener("change", () => {
      const lat = Number(elements.destLatInput.value);
      const lon = Number(elements.destLonInput.value);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      setDestination({
        lat,
        lon,
        label: elements.destLabelInput.value.trim() || "목적지"
      });
    });
  }

  elements.destinationSearchBtn?.addEventListener("click", searchDestination);
  elements.destinationSearchInput?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void searchDestination();
  });
  elements.destinationSearchResults?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-destination-result]");
    if (!button) return;
    selectDestinationSearchResult(button.dataset.destinationResult);
  });

  elements.destinationPresetButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const lat = Number(button.dataset.lat);
      const lon = Number(button.dataset.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      setDestination({
        lat,
        lon,
        label: button.dataset.label || button.textContent.trim() || "목적지"
      });
    });
  });

  elements.intervalButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const group = button.closest("[data-filter]");
      if (!group) return;
      const filterName = group.dataset.filter;
      state.filters[filterName] = button.dataset.value;
      if (filterName === "routePolicy") applyRoutePolicyDefaults(button.dataset.value);
      updateFilterButtons();
      renderDashboard();
    });
  });

  document.addEventListener("pointermove", dragFloatingWidget);
  document.addEventListener("pointerup", stopFloatingWidgetDrag);

  elements.rtsHud?.addEventListener("click", (event) => {
    const stationButton = event.target.closest("[data-rts-station]");
    if (stationButton) {
      selectStation(stationButton.dataset.rtsStation);
      flashRtsLock();
      return;
    }

    const action = event.target.closest("[data-rts-action]");
    if (action?.dataset.rtsAction === "focus-selected" && state.selectedId) {
      selectStation(state.selectedId);
    }
  });
}

function bindMapViewEvents() {
  if (!state.map) return;

  if (state.mapProvider === "leaflet" && state.map.on) {
    state.map.on("moveend zoomend", refreshRtsUnitTrack);
    return;
  }

  if (state.mapProvider === "kakao" && window.kakao?.maps?.event) {
    kakao.maps.event.addListener(state.map, "idle", refreshRtsUnitTrack);
  }
}

function handleViewportResize() {
  refreshMapSize();
  refreshRtsUnitTrack();
}

function flashRtsLock() {
  if (state.uiMode !== "rts-console" || !elements.rtsHud) return;
  elements.rtsHud.classList.remove("rts-lock-flash");
  void elements.rtsHud.offsetWidth;
  elements.rtsHud.classList.add("rts-lock-flash");
}

function refreshRtsUnitTrack() {
  if (state.uiMode !== "rts-console") return;
  cancelAnimationFrame(state.rtsAnimationFrame);
  state.rtsAnimationFrame = requestAnimationFrame(() => {
    const station = state.rankedStations.find((item) => item.id === state.selectedId) ?? state.rankedStations[0];
    renderRtsUnitTrack(station);
  });
}

function setupFloatingWidgets() {
  const widgets = [
    ["compare", elements.recommendCompare],
    ["heatmap", elements.heatmapPanel],
    ["legend", elements.mapLegend],
    ["detail", elements.detailPanel],
    ["rtsMinimap", elements.rtsMinimap],
    ["rtsTelemetry", elements.rtsTelemetry],
    ["rtsCommandDock", elements.rtsCommandDock]
  ];

  for (const [id, element] of widgets) {
    if (!element) continue;
    element.classList.add("floating-widget");
    element.dataset.widgetId = id;
    applyWidgetState(id);
    ["mousedown", "touchstart", "wheel", "dblclick"].forEach((eventName) => {
      element.addEventListener(eventName, (event) => event.stopPropagation(), { passive: true });
    });
  }

  document.querySelector(".map-panel")?.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-widget-toggle]");
    if (!toggle) return;
    event.preventDefault();
    event.stopPropagation();
    toggleFloatingWidget(toggle.dataset.widgetToggle);
  });

  document.querySelector(".map-panel")?.addEventListener("pointerdown", (event) => {
    const handle = event.target.closest("[data-widget-handle]");
    if (!handle || event.target.closest("button, a, input, select, textarea")) return;
    const widget = handle.closest("[data-widget-id]");
    if (!widget) return;
    event.preventDefault();
    event.stopPropagation();
    startFloatingWidgetDrag(widget.dataset.widgetId, widget, event);
  });
}

function toggleFloatingWidget(id) {
  const widget = state.overlayWidgets[id];
  if (!widget) return;
  widget.minimized = !widget.minimized;
  applyWidgetState(id);
  if (window.lucide) window.lucide.createIcons();
}

function startFloatingWidgetDrag(id, element, event) {
  const widget = state.overlayWidgets[id];
  if (!widget) return;

  state.activeWidgetDrag = {
    id,
    element,
    startX: event.clientX,
    startY: event.clientY,
    originX: widget.x,
    originY: widget.y
  };
  element.classList.add("widget-dragging");
  element.setPointerCapture?.(event.pointerId);
}

function dragFloatingWidget(event) {
  const drag = state.activeWidgetDrag;
  if (!drag) return;
  const widget = state.overlayWidgets[drag.id];
  if (!widget) return;

  widget.x = drag.originX + event.clientX - drag.startX;
  widget.y = drag.originY + event.clientY - drag.startY;
  applyWidgetState(drag.id);
}

function stopFloatingWidgetDrag() {
  const drag = state.activeWidgetDrag;
  if (!drag) return;
  drag.element.classList.remove("widget-dragging");
  state.activeWidgetDrag = null;
}

function applyWidgetState(id) {
  const element = document.querySelector(`[data-widget-id="${id}"]`);
  const widget = state.overlayWidgets[id];
  if (!element || !widget) return;

  element.classList.toggle("widget-minimized", widget.minimized);
  element.style.setProperty("--widget-x", `${widget.x}px`);
  element.style.setProperty("--widget-y", `${widget.y}px`);
  element.querySelectorAll("[data-widget-toggle]").forEach((button) => {
    button.setAttribute("aria-expanded", widget.minimized ? "false" : "true");
    button.setAttribute("title", widget.minimized ? "펼치기" : "최소화");
    button.innerHTML = `<i data-lucide="${widget.minimized ? "chevron-down" : "chevron-up"}"></i>`;
  });
}

function widgetToggleButton(id) {
  const minimized = state.overlayWidgets[id]?.minimized ?? false;
  return `
    <button class="widget-toggle" type="button" data-widget-toggle="${id}" title="${minimized ? "펼치기" : "최소화"}" aria-label="${minimized ? "펼치기" : "최소화"}" aria-expanded="${minimized ? "false" : "true"}">
      <i data-lucide="${minimized ? "chevron-down" : "chevron-up"}"></i>
    </button>
  `;
}

async function loadStations({ refresh = false } = {}) {
  setBadge("muted", "데이터 수신 중");
  try {
    const response = await fetch(`/api/stations${refresh ? "?refresh=1" : ""}`, {
      headers: { accept: "application/json" }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    state.stations = Array.isArray(payload.stations) ? payload.stations : [];
    state.insights = payload.insights ?? null;
    state.collector = payload.collector ?? null;
    state.traffic = payload.traffic ?? null;
    setBadge(payload.source === "live" ? "live" : "mock", payload.source === "live" ? "실시간 API" : "샘플 모드");
    renderDashboard(payload);
  } catch (error) {
    setBadge("mock", "수신 오류");
    elements.stationList.innerHTML = `<div class="error-block">${escapeHtml(error.message)}</div>`;
    elements.detailPanel.classList.remove("visible");
  }
}

function requestCurrentLocation() {
  if (!navigator.geolocation) {
    elements.locationStatus.textContent = "브라우저가 위치 권한을 지원하지 않습니다.";
    return;
  }

  elements.locationStatus.textContent = "위치 확인 중";
  navigator.geolocation.getCurrentPosition(
    (position) => {
      setLocation({
        lat: position.coords.latitude,
        lon: position.coords.longitude,
        label: "브라우저 현위치"
      });
    },
    (error) => {
      elements.locationStatus.textContent = `위치 확인 실패: ${error.message}`;
    },
    {
      enableHighAccuracy: true,
      timeout: 10_000,
      maximumAge: 60_000
    }
  );
}

function setLocation(location) {
  state.location = location;
  resetRouteState();
  elements.latInput.value = location.lat.toFixed(6);
  elements.lonInput.value = location.lon.toFixed(6);
  elements.locationStatus.textContent = locationText();
  centerMapOnLocation();
  renderUserMarker();
  renderDashboard();
}

function setDestination(destination) {
  state.destination = destination;
  resetRouteState();
  state.destinationSearchAbortController?.abort();
  state.destinationSearchLoading = false;
  state.destinationSearchResults = [];
  state.destinationSearchStatus = {
    kind: "selected",
    text: `${destination.label} 선택됨`
  };
  if (elements.destLabelInput) elements.destLabelInput.value = destination.label;
  if (elements.destLatInput) elements.destLatInput.value = destination.lat.toFixed(6);
  if (elements.destLonInput) elements.destLonInput.value = destination.lon.toFixed(6);
  if (elements.destinationSearchInput) elements.destinationSearchInput.value = destination.label;
  if (elements.destinationStatus) elements.destinationStatus.textContent = destinationText();
  renderDestinationSearchResults();
  renderDestinationMarker();
  renderDashboard();
}

function setVehicleState(vehicle) {
  state.vehicle = {
    socPercent: clamp(Number.isFinite(vehicle.socPercent) ? vehicle.socPercent : state.vehicle.socPercent, 0, 100),
    fullRangeKm: clamp(Number.isFinite(vehicle.fullRangeKm) ? vehicle.fullRangeKm : state.vehicle.fullRangeKm, 100, 1000),
    reserveKm: clamp(Number.isFinite(vehicle.reserveKm) ? vehicle.reserveKm : state.vehicle.reserveKm, 0, 200)
  };
  if (elements.socInput) elements.socInput.value = String(Math.round(state.vehicle.socPercent));
  if (elements.fullRangeInput) elements.fullRangeInput.value = String(Math.round(state.vehicle.fullRangeKm));
  if (elements.reserveRangeInput) elements.reserveRangeInput.value = String(Math.round(state.vehicle.reserveKm));
  renderDashboard();
}

async function searchDestination() {
  const query = (elements.destinationSearchInput?.value || elements.destLabelInput?.value || "").trim();
  if (query.length < 2) {
    state.destinationSearchResults = [];
    state.destinationSearchStatus = {
      kind: "error",
      text: "검색어를 두 글자 이상 입력하세요."
    };
    renderDestinationSearchResults();
    return;
  }

  state.destinationSearchAbortController?.abort();
  const controller = new AbortController();
  state.destinationSearchAbortController = controller;
  state.destinationSearchLoading = true;
  state.destinationSearchStatus = {
    kind: "loading",
    text: "목적지 검색 중"
  };
  renderDestinationSearchResults();

  const params = new URLSearchParams({
    q: query,
    lat: String(state.location.lat),
    lon: String(state.location.lon)
  });

  try {
    const response = await fetch(`/api/kakao/search-place?${params}`, {
      headers: { accept: "application/json" },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`목적지 검색 HTTP ${response.status}`);
    const payload = await response.json();
    if (controller.signal.aborted) return;

    state.destinationSearchResults = Array.isArray(payload.places) ? payload.places : [];
    state.destinationSearchStatus = {
      kind: payload.available ? "ready" : "empty",
      text: payload.available ? `${state.destinationSearchResults.length}개 결과` : payload.reason || "검색 결과가 없습니다."
    };
  } catch (error) {
    if (controller.signal.aborted) return;
    state.destinationSearchResults = [];
    state.destinationSearchStatus = {
      kind: "error",
      text: error instanceof Error ? error.message : String(error)
    };
  } finally {
    if (!controller.signal.aborted) {
      state.destinationSearchLoading = false;
      renderDestinationSearchResults();
    }
  }
}

function renderDestinationSearchResults() {
  if (!elements.destinationSearchResults) return;
  const status = state.destinationSearchStatus;
  const statusText = status?.text ? `<div class="destination-result-status ${escapeHtml(status.kind)}">${escapeHtml(status.text)}</div>` : "";

  if (!state.destinationSearchResults.length) {
    elements.destinationSearchResults.innerHTML = statusText;
    elements.destinationSearchResults.classList.toggle("visible", Boolean(statusText));
    return;
  }

  const resultItems = state.destinationSearchResults.map((place) => {
    const address = place.roadAddress || place.address || "주소 정보 없음";
    const distance = Number.isFinite(place.distanceKm) ? `${formatDistance(place.distanceKm)} 거리` : "거리 기준 없음";
    const meta = [distance, place.category, place.source === "address" ? "주소" : "장소"].filter(Boolean).join(" · ");
    return `
      <button class="destination-result" type="button" data-destination-result="${escapeHtml(place.id)}">
        <strong>${escapeHtml(place.name)}</strong>
        <span>${escapeHtml(address)}</span>
        <em>${escapeHtml(meta)}</em>
      </button>
    `;
  }).join("");

  elements.destinationSearchResults.innerHTML = `${statusText}${resultItems}`;
  elements.destinationSearchResults.classList.add("visible");
}

function selectDestinationSearchResult(id) {
  const place = state.destinationSearchResults.find((item) => String(item.id) === String(id));
  if (!place) return;

  setDestination({
    lat: place.lat,
    lon: place.lon,
    label: place.name
  });
}

function renderDashboard(payload = null) {
  const enriched = enrichStations(state.stations);
  const scoped = enriched;
  const filtered = filterStations(scoped);
  void loadRouteSummaries(scoped);
  const recommendations = {
    price: rankStations(filtered, "price")[0],
    distance: rankStations(filtered, "distance")[0],
    time: rankStations(filtered, "time")[0]
  };

  state.rankedStations = rankStations(filtered, "balanced");
  if (!state.rankedStations.some((station) => station.id === state.selectedId)) {
    state.selectedId = state.rankedStations[0]?.id ?? null;
  }

  renderKpis(scoped, filtered);
  renderVehicleScenario(scoped, filtered);
  renderFilterSummary(filtered.length, scoped.length);
  renderRoutePolicySummary(filtered.length);
  renderInsights();
  renderRecommendations(recommendations);
  renderRecommendationComparison(recommendations);
  renderHeatmap();
  renderMapLegend();
  renderStationList(state.rankedStations);
  renderMap(state.rankedStations, recommendations);
  renderDetail();
  renderRtsConsole(scoped, filtered, recommendations);
  void loadSelectedRoute(state.rankedStations.find((station) => station.id === state.selectedId));
  refreshMapSize();

  elements.stationCount.textContent = `${filtered.length}`;
  elements.stationTotal.textContent = `/${scoped.length}`;

  if (payload?.counts) {
    elements.locationStatus.textContent = `${locationText()} · 전국 후보 ${scoped.length}개소`;
  }

  if (window.lucide) window.lucide.createIcons();
}

function refreshMapSize() {
  if (!state.map) return;
  requestAnimationFrame(() => {
    if (state.mapProvider === "kakao") {
      state.map.relayout();
      return;
    }
    state.map.invalidateSize();
  });
}

function centerMapOnLocation() {
  if (!state.map) return;
  const latLng = [state.location.lat, state.location.lon];

  if (state.mapProvider === "kakao") {
    state.map.setCenter(new kakao.maps.LatLng(latLng[0], latLng[1]));
    state.map.setLevel(INITIAL_KAKAO_LEVEL);
    return;
  }

  state.map.setView(latLng, INITIAL_LEAFLET_ZOOM);
}

async function loadRouteSummaries(stations) {
  const limit = routePlanningEnabled() ? ROUTE_PLAN_LIMIT : ROUTE_SUMMARY_LIMIT;
  const candidates = [...stations]
    .filter((station) => Number.isFinite(station.lat) && Number.isFinite(station.lon))
    .sort((a, b) => routeCorridorScore(a) - routeCorridorScore(b))
    .slice(0, limit);
  const key = routeRequestKey(candidates);

  if (!candidates.length || !key) return;
  if (state.routeSummaryLoading || state.routeSummaryKey === key) return;

  state.routeAbortController?.abort();
  const controller = new AbortController();
  state.routeAbortController = controller;
  state.routeSummaryKey = key;
  state.routeSummaryLoading = true;
  state.routeSummaryStatus = {
    available: false,
    source: "loading",
    reason: "카카오내비 경로 계산 중"
  };

  try {
    const routePlan = routePlanningEnabled();
    const response = await fetch(routePlan ? "/api/kakao/route-plan" : "/api/kakao/routes", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        origin: routeOriginPayload(),
        destination: routePlan ? routeDestinationPayload() : undefined,
        stations: routePlan ? candidates.map(stationPointPayload) : undefined,
        destinations: routePlan ? undefined : candidates.map(stationPointPayload),
        priority: KAKAO_ROUTE_PRIORITY
      }),
      signal: controller.signal
    });

    if (!response.ok) throw new Error(`카카오 경로 HTTP ${response.status}`);
    const payload = await response.json();
    if (controller.signal.aborted || state.routeSummaryKey !== key) return;

    state.routeSummaryStatus = payload;
    state.routeSummaries = new Map(
      (payload.routes ?? [])
        .filter((route) => route.available && route.stationId)
        .map((route) => [route.stationId, {
          ...route,
          requestKey: key,
          originKey: routeOriginKey(),
          destinationKey: routeDestinationKey()
        }])
    );
  } catch (error) {
    if (controller.signal.aborted) return;
    state.routeSummaryStatus = {
      available: false,
      source: "fallback",
      reason: error instanceof Error ? error.message : String(error)
    };
    state.routeSummaries = new Map();
  } finally {
    if (!controller.signal.aborted && state.routeSummaryKey === key) {
      state.routeSummaryLoading = false;
      renderDashboard();
    }
  }
}

function stationPointPayload(station) {
  return {
          id: station.id,
          name: station.name,
          lat: station.lat,
          lon: station.lon
  };
}

async function loadSelectedRoute(station) {
  if (!station) return;
  const key = selectedRouteRequestKey(station);
  if (!key) return;
  if (state.selectedRouteKey === key && (state.selectedRouteLoading || state.selectedRouteStatus)) return;

  state.selectedRouteAbortController?.abort();
  const controller = new AbortController();
  state.selectedRouteAbortController = controller;
  state.selectedRouteKey = key;
  state.selectedRoute = null;
  state.selectedRouteLoading = true;
  state.selectedRouteStatus = {
    available: false,
    source: "loading",
    reason: "카카오내비 상세 경로 계산 중"
  };

  try {
    const response = await fetch("/api/kakao/route", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        origin: routeOriginPayload(),
        destination: routePlanningEnabled()
          ? routeDestinationPayload()
          : stationPointPayload(station),
        waypoints: routePlanningEnabled()
          ? [stationPointPayload(station)]
          : [],
        priority: KAKAO_ROUTE_PRIORITY
      }),
      signal: controller.signal
    });

    if (!response.ok) throw new Error(`카카오 상세 경로 HTTP ${response.status}`);
    const payload = await response.json();
    if (controller.signal.aborted || state.selectedRouteKey !== key) return;

    state.selectedRouteStatus = payload;
    const route = payload.route;
    state.selectedRoute = payload.available && route?.points?.length >= 2
      ? {
          ...route,
          stationId: station.id,
          requestKey: key,
          originKey: routeOriginKey(),
          destinationKey: routeDestinationKey()
        }
      : null;
  } catch (error) {
    if (controller.signal.aborted) return;
    state.selectedRouteStatus = {
      available: false,
      source: "fallback",
      reason: error instanceof Error ? error.message : String(error)
    };
    state.selectedRoute = null;
  } finally {
    if (!controller.signal.aborted && state.selectedRouteKey === key) {
      state.selectedRouteLoading = false;
      renderDashboard();
    }
  }
}

function resetRouteState() {
  state.routeAbortController?.abort();
  state.selectedRouteAbortController?.abort();
  state.routeSummaries = new Map();
  state.routeSummaryKey = "";
  state.routeSummaryLoading = false;
  state.routeSummaryStatus = null;
  state.selectedRoute = null;
  state.selectedRouteKey = "";
  state.selectedRouteLoading = false;
  state.selectedRouteStatus = null;
}

function routeRequestKey(stations) {
  const ids = stations.map((station) => station.id).filter(Boolean).sort().join("|");
  return ids ? `${routeOriginKey()}|${routeDestinationKey()}|${ids}` : "";
}

function selectedRouteRequestKey(station) {
  if (!station?.id) return "";
  return `${routeOriginKey()}|${routeDestinationKey()}|${station.id}|${Number(station.lat).toFixed(6)},${Number(station.lon).toFixed(6)}`;
}

function routeOriginKey() {
  return `${state.location.lat.toFixed(5)},${state.location.lon.toFixed(5)}`;
}

function routeOriginPayload() {
  return {
    lat: state.location.lat,
    lon: state.location.lon,
    name: state.location.label
  };
}

function routePlanningEnabled() {
  return (
    Number.isFinite(state.destination?.lat) &&
    Number.isFinite(state.destination?.lon) &&
    haversineKm(state.location.lat, state.location.lon, state.destination.lat, state.destination.lon) > 0.2
  );
}

function routeCorridorScore(station) {
  if (!routePlanningEnabled()) return haversineKm(state.location.lat, state.location.lon, station.lat, station.lon);
  const originToStation = haversineKm(state.location.lat, state.location.lon, station.lat, station.lon);
  const stationToDestination = haversineKm(station.lat, station.lon, state.destination.lat, state.destination.lon);
  const originToDestination = haversineKm(state.location.lat, state.location.lon, state.destination.lat, state.destination.lon);
  return Math.max(0, originToStation + stationToDestination - originToDestination);
}

function applyRoutePolicyDefaults(policy) {
  if (policy === "onRoute") {
    state.filters.maxDetourKm = "5";
    state.filters.maxExtraMinutes = "10";
    state.filters.time = "45";
    return;
  }

  if (policy === "detour") {
    state.filters.maxDetourKm = "25";
    state.filters.maxExtraMinutes = "30";
    state.filters.time = "90";
  }
}

function routeHyperparams() {
  return {
    onRouteKm: parseFilterValue(state.filters.onRouteKm) ?? 5,
    onRouteMinutes: parseFilterValue(state.filters.onRouteMinutes) ?? 10,
    maxDetourKm: parseFilterValue(state.filters.maxDetourKm),
    maxExtraMinutes: parseFilterValue(state.filters.maxExtraMinutes),
    maxImpactMinutes: parseFilterValue(state.filters.time)
  };
}

function isOnRouteCandidate(station) {
  if (!station?.routePlan) return false;
  const params = routeHyperparams();
  return (
    Number.isFinite(station.detourDistanceKm) &&
    Number.isFinite(station.detourMinutes) &&
    station.detourDistanceKm <= params.onRouteKm &&
    station.detourMinutes <= params.onRouteMinutes
  );
}

function passesRoutePolicy(station) {
  if (!station.routePlan) return false;
  const params = routeHyperparams();

  if (state.filters.routePolicy === "onRoute") {
    return isOnRouteCandidate(station);
  }

  const passesDetourDistance =
    params.maxDetourKm === null ||
    (Number.isFinite(station.detourDistanceKm) && station.detourDistanceKm <= params.maxDetourKm);
  const passesExtraTime =
    params.maxExtraMinutes === null ||
    (Number.isFinite(station.detourMinutes) && station.detourMinutes <= params.maxExtraMinutes);
  const passesImpactTime =
    params.maxImpactMinutes === null ||
    (Number.isFinite(station.totalMinutes) && station.totalMinutes <= params.maxImpactMinutes);

  return passesDetourDistance && passesExtraTime && passesImpactTime;
}

function vehicleRangeState() {
  const availableRangeKm = (state.vehicle.fullRangeKm * state.vehicle.socPercent) / 100;
  const safeRangeKm = Math.max(0, availableRangeKm - state.vehicle.reserveKm);
  return {
    ...state.vehicle,
    availableRangeKm,
    safeRangeKm
  };
}

function stationVehicleRange(station, routePlan, routeSummary, straightDistanceKm) {
  const range = vehicleRangeState();
  const toStationKm = routePlan?.toStationDistanceKm ?? routeSummary?.distanceKm ?? straightDistanceKm * ROUTE_DISTANCE_FACTOR;
  const reachable = Number.isFinite(toStationKm) && toStationKm <= range.safeRangeKm;
  const rangeAfterStationKm = Number.isFinite(toStationKm) ? range.availableRangeKm - toStationKm : null;
  const marginKm = Number.isFinite(toStationKm) ? range.safeRangeKm - toStationKm : null;
  const pressure = range.safeRangeKm > 0 && Number.isFinite(toStationKm) ? clamp(toStationKm / range.safeRangeKm, 0, 2) : 2;

  return {
    ...range,
    toStationKm,
    reachable,
    rangeAfterStationKm,
    marginKm,
    pressure,
    urgency: range.socPercent <= 30 ? "low" : range.socPercent >= 70 ? "high" : "medium"
  };
}

function passesVehicleRange(station) {
  return !station.vehicle || station.vehicle.reachable;
}

function routeDestinationKey() {
  if (!routePlanningEnabled()) return "no-destination";
  return `${state.destination.lat.toFixed(5)},${state.destination.lon.toFixed(5)}`;
}

function routeDestinationPayload() {
  return {
    lat: state.destination.lat,
    lon: state.destination.lon,
    name: state.destination.label
  };
}

function routeSummaryForStation(id) {
  const summary = state.routeSummaries.get(id);
  if (!summary || summary.originKey !== routeOriginKey()) return null;
  if (summary.destinationKey !== routeDestinationKey()) return null;
  if (!Number.isFinite(summary.distanceKm) || !Number.isFinite(summary.driveMinutes)) return null;
  return summary;
}

function selectedRouteForStation(station) {
  if (!station || !state.selectedRoute) return null;
  if (state.selectedRoute.stationId !== station.id) return null;
  if (state.selectedRoute.requestKey !== selectedRouteRequestKey(station)) return null;
  if (state.selectedRoute.destinationKey !== routeDestinationKey()) return null;
  return state.selectedRoute;
}

function kakaoRouteTraffic(route, fallbackTraffic) {
  const trafficDistanceKm = route.viaDistanceKm ?? route.distanceKm;
  const calculatedSpeed = trafficDistanceKm > 0 && route.durationSeconds > 0
    ? trafficDistanceKm / (route.durationSeconds / 3600)
    : null;

  return {
    ...fallbackTraffic,
    source: route.routePlan ? "kakao-route-plan" : "kakao-navi",
    sourceName: route.sourceName || "카카오내비 Directions",
    speedKph: clamp(route.traffic?.avgSpeedKph ?? calculatedSpeed ?? fallbackTraffic.speedKph, 12, 90),
    rawSpeedKph: route.traffic?.avgSpeedKph ?? calculatedSpeed ?? fallbackTraffic.rawSpeedKph,
    reliability: route.routePlan ? "목적지 경유 반영" : "카카오내비 경로 반영",
    observedAt: route.observedAt,
    routePriority: route.priority,
    roadCount: route.roadCount,
    routeDistanceKm: trafficDistanceKm
  };
}

function enrichStations(stations) {
  return stations
    .filter((station) => station?.dataQuality?.hasCoordinates)
    .map((station) => {
      const straightDistanceKm = haversineKm(state.location.lat, state.location.lon, station.lat, station.lon);
      const fallbackTraffic = stationTraffic(station);
      const routeSummary = routeSummaryForStation(station.id);
      const traffic = routeSummary ? kakaoRouteTraffic(routeSummary, fallbackTraffic) : fallbackTraffic;
      const routePlan = routeSummary?.routePlan ? routeSummary : null;
      const fallbackDriveMinutes = estimateDriveMinutes(straightDistanceKm, traffic);
      const routeDistanceKm = routePlan?.viaDistanceKm ?? routeSummary?.distanceKm ?? straightDistanceKm * ROUTE_DISTANCE_FACTOR;
      const distanceKm = routePlan?.detourDistanceKm ?? routeSummary?.distanceKm ?? straightDistanceKm;
      const driveMinutes = routePlan?.detourMinutes ?? routeSummary?.driveMinutes ?? fallbackDriveMinutes;
      const vehicle = stationVehicleRange(station, routePlan, routeSummary, straightDistanceKm);
      const waitMinutes = estimateWaitMinutes(station);
      const totalMinutes = driveMinutes + waitMinutes;
      const status = stationStatus(station);
      const reliability = dataReliability(station);
      const supply = stationSupply(station);
      const risk = competitionRisk(station, reliability);
      const reservationOnly = isReservationOnlyStation(station);
      const busOnly = isBusOnlyStation(station);
      const routeContext = {
        ...station,
        routePlan,
        detourDistanceKm: routePlan?.detourDistanceKm ?? null,
        detourMinutes: routePlan?.detourMinutes ?? null
      };

      return {
        ...station,
        straightDistanceKm,
        distanceKm,
        routeDistanceKm,
        driveMinutes,
        driveBaseMinutes: (straightDistanceKm / AVG_DRIVE_SPEED_KPH) * 60,
        vehicle,
        waitMinutes,
        totalMinutes,
        traffic,
        routeSummary,
        routePlan,
        detourDistanceKm: routePlan?.detourDistanceKm ?? null,
        detourMinutes: routePlan?.detourMinutes ?? null,
        baseDriveMinutes: routePlan?.baseDriveMinutes ?? null,
        status,
        reliability,
        supply,
        risk,
        reservationOnly,
        busOnly,
        recommendationReason: recommendationReason({ ...routeContext, vehicle }, driveMinutes, waitMinutes, reliability, reservationOnly, busOnly, traffic, supply)
      };
    });
}

function filterStations(stations) {
  return stations.filter((station) => {
    const routePlanReady = routePlanningEnabled() && state.routeSummaryStatus?.available;
    if (routePlanReady && !passesRoutePolicy(station)) return false;

    const priceLimit = parseFilterValue(state.filters.price);
    const distanceLimit = parseFilterValue(state.filters.distance);
    const timeLimit = parseFilterValue(state.filters.time);

    const includeReservation = state.filters.reservation === "include";
    const includeBusOnly = state.filters.busOnly === "include";
    const passesPrice = priceLimit === null || (Number.isFinite(station.price) && station.price <= priceLimit);
    const passesDistance = routePlanReady || distanceLimit === null || station.distanceKm <= distanceLimit;
    const passesTime = routePlanReady || timeLimit === null || station.totalMinutes <= timeLimit;
    const passesReservation = includeReservation || !station.reservationOnly;
    const passesBusOnly = includeBusOnly || !station.busOnly;
    const passesRange = passesVehicleRange(station);

    return passesPrice && passesDistance && passesTime && passesReservation && passesBusOnly && passesRange;
  });
}

function rankStations(stations, profileName) {
  const profile = scoreProfiles[profileName] ?? scoreProfiles.balanced;
  const ranges = {
    price: getRange(stations.map((station) => station.price)),
    distance: getRange(stations.map((station) => station.distanceKm)),
    time: getRange(stations.map((station) => station.totalMinutes))
  };

  return stations
    .map((station) => {
      const score =
        normalize(station.price, ranges.price) * profile.price +
        normalize(station.distanceKm, ranges.distance) * profile.distance +
        normalize(station.totalMinutes, ranges.time) * profile.time +
        vehicleRangePenalty(station) +
        availabilityPenalty(station);

      return { ...station, score };
    })
    .sort((a, b) => a.score - b.score);
}

function vehicleRangePenalty(station) {
  const vehicle = station.vehicle;
  if (!vehicle) return 0;
  if (!vehicle.reachable) return 10;

  let penalty = 0;
  if (vehicle.urgency === "low") penalty += vehicle.pressure * 0.32;
  if (vehicle.urgency === "medium") penalty += vehicle.pressure * 0.16;
  if (Number.isFinite(vehicle.marginKm) && vehicle.marginKm < state.vehicle.reserveKm * 0.5) penalty += 0.18;
  return penalty;
}

function updateFilterButtons() {
  elements.intervalButtons.forEach((button) => {
    const group = button.closest("[data-filter]");
    const isActive = group && state.filters[group.dataset.filter] === button.dataset.value;
    button.classList.toggle("active", Boolean(isActive));
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

function renderKpis(scoped, filtered) {
  const operating = scoped.filter((station) => station.status.kind === "good").length;
  const avgWaitCars = averageNumber(scoped.map((station) => station.realtime?.waitCars).filter(Number.isFinite));
  const avgFillableCars = averageNumber(scoped.map((station) => station.supply?.fillableCars).filter(Number.isFinite));
  const routeProvider = routeProviderSummary();
  const reachableCount = scoped.filter((station) => station.vehicle?.reachable).length;

  elements.kpiStrip.innerHTML = `
    ${renderKpiCard("전국 후보", `${scoped.length}`, "개소", "전국 범위")}
    ${renderKpiCard("운영중", `${operating}`, "개소", `${scoped.length - operating}개소 주의`)}
    ${renderKpiCard("도달 가능", `${reachableCount}`, "개소", "현재 잔량 기준")}
    ${renderKpiCard("추천 후보", `${filtered.length}`, "개소", "조건 통과")}
    ${renderKpiCard("평균 대기", Number.isFinite(avgWaitCars) ? avgWaitCars.toFixed(1) : "--", "대", "실시간 기준")}
    ${renderKpiCard("공급 여유", Number.isFinite(avgFillableCars) ? avgFillableCars.toFixed(0) : "--", "대", "충전가능 대수 평균")}
    ${renderKpiCard("경로산정", routeProvider.value, routeProvider.unit, routeProvider.caption)}
  `;
}

function renderVehicleScenario(scoped, filtered) {
  if (!elements.vehicleStatus || !elements.scenarioPanel) return;

  const range = vehicleRangeState();
  const baseRoute = state.routeSummaryStatus?.baseRoute;
  const canReachDestination = routePlanningEnabled() && Number.isFinite(baseRoute?.distanceKm)
    ? baseRoute.distanceKm <= range.safeRangeKm
    : false;
  const reachableCount = scoped.filter((station) => station.vehicle?.reachable).length;
  const best = state.rankedStations[0] ?? filtered[0];

  elements.vehicleStatus.textContent = `현재 주행가능 ${formatDistance(range.availableRangeKm)} · 안전 여유 ${formatDistance(range.reserveKm)} · 안전권 ${formatDistance(range.safeRangeKm)}`;

  const scenario = vehicleScenarioText({ range, canReachDestination, reachableCount, best, baseRoute });
  elements.scenarioPanel.innerHTML = `
    <span>${escapeHtml(scenario.kicker)}</span>
    <strong>${escapeHtml(scenario.title)}</strong>
    <small>${escapeHtml(scenario.detail)}</small>
  `;
}

function vehicleScenarioText({ range, canReachDestination, reachableCount, best, baseRoute }) {
  if (canReachDestination) {
    return {
      kicker: "고잔량 시나리오",
      title: "목적지까지 무충전 가능, 가격/경로 이탈 trade-off 중심",
      detail: `직행 ${formatDistance(baseRoute.distanceKm)} 가능. 더 싼 충전소는 추가시간/이탈거리와 비교.`
    };
  }

  if (range.socPercent <= 30) {
    return {
      kicker: "저잔량 시나리오",
      title: "먼 최저가보다 안전권 내 첫 충전 우선",
      detail: best
        ? `${best.name}: ${formatDistance(best.vehicle.toStationKm)} 지점, 도착 후 잔여 ${formatDistance(Math.max(0, best.vehicle.rangeAfterStationKm))}`
        : `현재 안전권 내 후보 ${reachableCount}개. 안전 여유를 낮추거나 가까운 충전소 확인 필요.`
    };
  }

  if (range.socPercent >= 70) {
    return {
      kicker: "고잔량 시나리오",
      title: "경로상 후보와 저가 후보를 함께 비교",
      detail: best
        ? `${best.name}: ${routeImpactText(best) || formatDistance(best.distanceKm)} · ${formatPrice(best.price)}`
        : `현재 조건 통과 후보 없음. 이탈거리/추가시간 조건 완화 필요.`
    };
  }

  return {
    kicker: "중간 잔량 시나리오",
    title: "경로상 충전을 우선하고, 저가 후보는 이탈 비용과 비교",
    detail: best
      ? `${best.name}: ${formatDistance(best.vehicle.toStationKm)} 지점 · ${formatPrice(best.price)}`
      : `현재 조건 통과 후보 없음. 안전 여유 또는 이탈 허용치를 조정.`
  };
}

function renderKpiCard(label, value, unit, caption) {
  return `
    <article class="kpi-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}<small>${escapeHtml(unit)}</small></strong>
      <em>${escapeHtml(caption)}</em>
    </article>
  `;
}

function routeProviderSummary() {
  if (state.routeSummaryLoading) {
    return {
      value: "계산중",
      unit: "",
      caption: "카카오내비 호출 중"
    };
  }

  if (state.routeSummaryStatus?.available) {
    const routePlan = state.routeSummaryStatus.source === "kakao-route-plan";
    return {
      value: "카카오",
      unit: "내비",
      caption: routePlan
        ? `목적지 경유 ${state.routeSummaryStatus.routeCount ?? 0}개 후보`
        : `카카오내비 ${state.routeSummaryStatus.routeCount ?? 0}개 경로`
    };
  }

  return {
    value: "추정",
    unit: "",
    caption: state.routeSummaryStatus?.reason || "도로거리 추정"
  };
}

function renderFilterSummary(filteredCount, totalCount) {
  const price = state.filters.price === "all" ? "가격 전체" : `${Number(state.filters.price).toLocaleString("ko-KR")}원 이하`;
  const routeMode = routePlanningEnabled() ? `${state.destination.label} 경로` : "전국";
  const routePolicy = routePlanningEnabled()
    ? state.filters.routePolicy === "onRoute"
      ? "경로상만"
      : "이탈 허용"
    : "주변 추천";
  const distance = routePlanningEnabled()
    ? state.filters.routePolicy === "onRoute"
      ? `경로상 ${state.filters.onRouteKm}km/${state.filters.onRouteMinutes}분`
      : `이탈 ${state.filters.maxDetourKm === "all" ? "전체" : `${state.filters.maxDetourKm}km 이내`}`
    : state.filters.distance === "all"
      ? "거리 전체"
      : `거리 ${state.filters.distance}km 이내`;
  const time = routePlanningEnabled()
    ? state.filters.maxExtraMinutes === "all"
      ? "추가시간 전체"
      : `추가 ${state.filters.maxExtraMinutes}분 이내`
    : state.filters.time === "all"
      ? "총시간 전체"
      : `총 ${state.filters.time}분 이내`;
  const reservation = state.filters.reservation === "include" ? "예약제 포함" : "예약제 제외";
  const busOnly = state.filters.busOnly === "include" ? "버스전용 포함" : "버스전용 제외";
  elements.filterSummary.textContent = `${routeMode} · 잔량 ${Math.round(state.vehicle.socPercent)}% · ${routePolicy} · ${distance} · ${time} · ${reservation} · ${busOnly} · ${price} · ${filteredCount}/${totalCount}`;
}

function renderRoutePolicySummary(filteredCount) {
  if (!elements.routePolicySummary) return;

  if (!routePlanningEnabled()) {
    elements.routePolicySummary.textContent = "목적지를 선택하면 전국 경로상 충전소와 이탈 허용 충전소를 나눠 추천합니다.";
    return;
  }

  if (state.routeSummaryLoading) {
    elements.routePolicySummary.textContent = `${state.destination.label} 방향 카카오 경로를 계산 중입니다.`;
    return;
  }

  const params = routeHyperparams();
  if (state.filters.routePolicy === "onRoute") {
    elements.routePolicySummary.textContent = `경로상만: +${params.onRouteMinutes}분, +${formatDistance(params.onRouteKm)} 이내 후보 ${filteredCount}개`;
    return;
  }

  const detourDistance = params.maxDetourKm === null ? "거리 제한 없음" : `+${formatDistance(params.maxDetourKm)}`;
  const detourTime = params.maxExtraMinutes === null ? "시간 제한 없음" : `+${params.maxExtraMinutes}분`;
  elements.routePolicySummary.textContent = `이탈 허용: ${detourTime}, ${detourDistance}까지 비교하고 카드에 추가시간/거리 표시`;
}

function renderInsights() {
  if (!state.insights || state.insights.recordCount === 0) {
    elements.insightPanel.textContent = "패턴 기록 수집 중";
    return;
  }

  const busiest = state.insights.busiestHours?.length
    ? state.insights.busiestHours
        .slice(0, 2)
        .map((hour) => `${String(hour.hour).padStart(2, "0")}시 평균 ${hour.avgWaitCars}대`)
        .join(" · ")
    : "혼잡 시간대 산정 중";
  const collector = state.collector?.enabled
    ? `자동수집 ON · ${state.collector.intervalMinutes}분 간격${state.collector.nextRunAt ? ` · 다음 ${formatClock(state.collector.nextRunAt)}` : ""}`
    : "자동수집 OFF";
  const traffic = state.traffic?.available
    ? `교통 API ${formatSpeed(state.traffic.avgSpeedKph)}`
    : "교통 평균속도 추정";
  const routing = routeProviderSummary().caption;

  elements.insightPanel.innerHTML = `
    <span>패턴 ${state.insights.recordCount}건 · ${escapeHtml(state.insights.currentBucket?.label ?? "")}</span>
    <strong>${escapeHtml(busiest)}</strong>
    <small>${escapeHtml(`${collector} · ${routing} · ${traffic}`)}</small>
  `;
}

function renderRecommendations(recommendations) {
  renderRecommendationCard(elements.priceRecommendation, {
    station: recommendations.price,
    title: "최저 가격",
    label: "가격 우선",
    icon: "circle-dollar-sign"
  });
  renderRecommendationCard(elements.distanceRecommendation, {
    station: recommendations.distance,
    title: "최단 거리",
    label: "거리 우선",
    icon: "route"
  });
  renderRecommendationCard(elements.timeRecommendation, {
    station: recommendations.time,
    title: "최소 총시간",
    label: "최소 총시간",
    icon: "timer"
  });
}

function renderRecommendationComparison(recommendations) {
  const rows = [
    { key: "price", label: "가격 우선", station: recommendations.price },
    { key: "distance", label: "거리 우선", station: recommendations.distance },
    { key: "time", label: "최소 총시간", station: recommendations.time }
  ].filter((row) => row.station);

  if (rows.length === 0) {
    elements.recommendCompare.innerHTML = `
      <div class="visual-card-head" data-widget-handle>
        <div>
          <span>Recommendation Matrix</span>
          <strong>비교 후보 없음</strong>
        </div>
        ${widgetToggleButton("compare")}
      </div>
    `;
    applyWidgetState("compare");
    return;
  }

  const max = {
    price: Math.max(...rows.map((row) => row.station.price).filter(Number.isFinite), 1),
    distance: Math.max(...rows.map((row) => row.station.distanceKm).filter(Number.isFinite), 1),
    time: Math.max(...rows.map((row) => row.station.totalMinutes).filter(Number.isFinite), 1),
    supply: 100,
    risk: 3
  };

  elements.recommendCompare.innerHTML = `
    <div class="visual-card-head" data-widget-handle>
      <div>
        <span>Recommendation Matrix</span>
        <strong>추천 3종 비교</strong>
      </div>
      ${widgetToggleButton("compare")}
    </div>
    <div class="compare-chart widget-body">
      ${rows.map((row) => renderCompareRow(row, max)).join("")}
    </div>
  `;
  applyWidgetState("compare");
}

function renderCompareRow(row, max) {
  const station = row.station;
  return `
    <article class="compare-row">
      <div class="compare-row-head">
        <span>${escapeHtml(row.label)}</span>
        <strong>${escapeHtml(station.name)}</strong>
      </div>
      ${renderMetricBar("가격", formatPrice(station.price), percentOf(station.price, max.price), "price")}
      ${renderMetricBar(distanceMetricLabel(station), formatDistance(station.distanceKm), percentOf(station.distanceKm, max.distance), "distance")}
      ${renderMetricBar("총시간", formatMinutes(station.totalMinutes), percentOf(station.totalMinutes, max.time), "time")}
      ${renderMetricBar("공급", formatSupplyShort(station.supply), percentOf(station.supply?.score ?? 42, max.supply), `supply-${station.supply?.kind ?? "unknown"}`)}
      ${renderMetricBar("리스크", station.risk.label.replace("경쟁 ", ""), percentOf(riskValue(station.risk.kind), max.risk), station.risk.kind)}
    </article>
  `;
}

function renderMetricBar(label, value, width, kind) {
  return `
    <div class="metric-bar ${kind}" style="--w:${clamp(width, 6, 100)}%">
      <span>${escapeHtml(label)}</span>
      <i></i>
      <b>${escapeHtml(value)}</b>
    </div>
  `;
}

function renderHeatmap() {
  const buckets = state.insights?.heatmap ?? [];
  const lookup = new Map(buckets.map((bucket) => [`${bucket.day}-${bucket.hour}`, bucket]));
  const days = [
    { value: 1, label: "월" },
    { value: 2, label: "화" },
    { value: 3, label: "수" },
    { value: 4, label: "목" },
    { value: 5, label: "금" },
    { value: 6, label: "토" },
    { value: 0, label: "일" }
  ];
  const hours = Array.from({ length: 24 }, (_, hour) => hour);

  elements.heatmapPanel.innerHTML = `
    <div class="visual-card-head" data-widget-handle>
      <div>
        <span>Congestion Pattern</span>
        <strong>요일 × 시간 혼잡</strong>
      </div>
      ${widgetToggleButton("heatmap")}
    </div>
    <div class="widget-body">
      <div class="heatmap-grid">
        <span class="heatmap-corner"></span>
        ${hours.map((hour) => `<span class="heatmap-hour">${hour % 6 === 0 ? hour : ""}</span>`).join("")}
        ${days
          .map(
            (day) => `
            <span class="heatmap-day">${day.label}</span>
            ${hours.map((hour) => renderHeatCell(lookup.get(`${day.value}-${hour}`), day.label, hour)).join("")}
          `
          )
          .join("")}
      </div>
      <div class="heatmap-legend">
        <span>낮음</span>
        <i class="heat-1"></i>
        <i class="heat-2"></i>
        <i class="heat-3"></i>
        <i class="heat-4"></i>
        <span>높음</span>
      </div>
    </div>
  `;
  applyWidgetState("heatmap");
}

function renderHeatCell(bucket, dayLabel, hour) {
  const level = heatLevel(bucket);
  const label = bucket
    ? `${dayLabel} ${hour}시 평균 ${bucket.avgWaitCars}대, 표본 ${bucket.sampleCount}건`
    : `${dayLabel} ${hour}시 기록 없음`;
  return `<span class="heat-cell heat-${level}" title="${escapeHtml(label)}"></span>`;
}

function renderMapLegend() {
  elements.mapLegend.innerHTML = `
    <div class="legend-head" data-widget-handle>
      <div class="legend-title">Marker Encoding</div>
      ${widgetToggleButton("legend")}
    </div>
    <div class="widget-body legend-body">
      <div class="legend-row"><i class="legend-dot good"></i><span>운영중</span></div>
      <div class="legend-row"><i class="legend-dot busy"></i><span>혼잡/대기</span></div>
      <div class="legend-row"><i class="legend-dot closed"></i><span>마감/중지</span></div>
      <div class="legend-row"><i class="legend-size small"></i><i class="legend-size large"></i><span>대기차량 수</span></div>
      <div class="legend-row"><i class="legend-ring"></i><span>추천/선택 후보</span></div>
      <div class="legend-row"><i class="legend-stale"></i><span>갱신 지연</span></div>
    </div>
  `;
  applyWidgetState("legend");
}

function renderRtsConsole(scoped, filtered, recommendations) {
  if (state.uiMode !== "rts-console" || !elements.rtsHud) return;

  const recommendationIds = new Set(
    Object.values(recommendations)
      .filter(Boolean)
      .map((station) => station.id)
  );
  const selectedStation = state.rankedStations.find((station) => station.id === state.selectedId) ?? state.rankedStations[0];

  renderRtsMinimap(filtered, recommendationIds, selectedStation);
  renderRtsTelemetry(scoped, filtered, selectedStation);
  renderRtsCommandDock(selectedStation, recommendations);
  renderRtsUnitTrack(selectedStation);
}

function renderRtsMinimap(stations, recommendationIds, selectedStation) {
  if (!elements.rtsMinimap) return;

  const located = stations.filter((station) => Number.isFinite(station.lat) && Number.isFinite(station.lon));
  const bounds = minimapBounds(located);
  const targetPoint = selectedStation && Number.isFinite(selectedStation.lat) && Number.isFinite(selectedStation.lon)
    ? minimapPoint(selectedStation, bounds)
    : null;
  const lockStats = selectedStation
    ? `${formatDistance(selectedStation.distanceKm)} · ${formatMinutes(selectedStation.totalMinutes)} · ${selectedStation.risk?.label ?? "리스크 불확실"}`
    : "NO DATA";

  elements.rtsMinimap.innerHTML = `
    <div class="rts-panel-head" data-widget-handle>
      <span>서비스 권역</span>
      <strong>전국 충전망</strong>
      ${widgetToggleButton("rtsMinimap")}
    </div>
    <div class="widget-body">
      <div class="rts-radar-grid" ${targetPoint ? `style="--target-x:${targetPoint.x}%; --target-y:${targetPoint.y}%"` : ""}>
        <span class="rts-scan-axis x-axis"></span>
        <span class="rts-scan-axis y-axis"></span>
        ${rtsMinimapRoute(selectedStation, bounds)}
        ${rtsOriginDot(bounds)}
        ${located
          .slice(0, 80)
          .map((station) => rtsStationDot(station, bounds, recommendationIds.has(station.id)))
          .join("")}
      </div>
      <div class="rts-minimap-legend" aria-label="미니맵 범례">
        <span><i class="good"></i>운영</span>
        <span><i class="busy"></i>대기</span>
        <span><i class="closed"></i>중지</span>
        <span><i class="selected"></i>선택</span>
      </div>
      <div class="rts-minimap-lock">
        <span>선택</span>
        <strong>${escapeHtml(selectedStation?.name ?? "대상 없음")}</strong>
        <em>${escapeHtml(lockStats)}</em>
      </div>
    </div>
  `;
  applyWidgetState("rtsMinimap");
}

function rtsOriginDot(bounds) {
  const point = minimapPoint({ lat: state.location.lat, lon: state.location.lon }, bounds);
  return `<span class="rts-origin-dot" style="--x:${point.x}%; --y:${point.y}%" title="현재 위치"></span>`;
}

function rtsStationDot(station, bounds, recommended) {
  const point = minimapPoint(station, bounds);
  const waitCars = station.realtime?.waitCars;
  const dotSize = clamp(9 + (Number.isFinite(waitCars) ? waitCars : 0), 9, 16).toFixed(0);
  const classes = [
    "rts-radar-dot",
    station.status.kind,
    station.risk?.kind ? `risk-${station.risk.kind}` : "risk-unknown",
    station.supply?.kind ? `supply-${station.supply.kind}` : "supply-unknown",
    recommended ? "recommended" : "",
    station.id === state.selectedId ? "selected" : "",
    station.busOnly ? "bus-only" : ""
  ].filter(Boolean).join(" ");

  return `
    <button
      class="${classes}"
      type="button"
      data-rts-station="${escapeHtml(station.id)}"
      style="--x:${point.x}%; --y:${point.y}%; --dot-size:${dotSize}px"
      title="${escapeHtml(station.name)}"
      aria-label="${escapeHtml(station.name)}"
    >
      <span class="rts-dot-core"></span>
    </button>
  `;
}

function rtsMinimapRoute(station, bounds) {
  if (!station || !Number.isFinite(station.lat) || !Number.isFinite(station.lon)) return "";

  const points = rtsRoutePoints(station)
    .map(([lat, lon]) => minimapPoint({ lat, lon }, bounds))
    .filter((point) => Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)));

  if (points.length < 2) return "";

  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");

  return `
    <svg class="rts-radar-route" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <path class="rts-radar-route-glow" d="${escapeHtml(path)}"></path>
      <path class="rts-radar-route-line" d="${escapeHtml(path)}"></path>
    </svg>
  `;
}

function minimapBounds(stations) {
  const lats = [state.location.lat, ...stations.map((station) => station.lat).filter(Number.isFinite)];
  const lons = [state.location.lon, ...stations.map((station) => station.lon).filter(Number.isFinite)];
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);

  return {
    minLat,
    maxLat: maxLat === minLat ? maxLat + 0.01 : maxLat,
    minLon,
    maxLon: maxLon === minLon ? maxLon + 0.01 : maxLon
  };
}

function minimapPoint(station, bounds) {
  const x = ((station.lon - bounds.minLon) / (bounds.maxLon - bounds.minLon)) * 100;
  const y = 100 - ((station.lat - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * 100;
  return {
    x: clamp(x, 4, 96).toFixed(2),
    y: clamp(y, 4, 96).toFixed(2)
  };
}

function renderRtsTelemetry(scoped, filtered, selectedStation) {
  if (!elements.rtsTelemetry) return;

  const operating = scoped.filter((station) => station.status.kind === "good").length;
  const avgWaitCars = averageNumber(scoped.map((station) => station.realtime?.waitCars).filter(Number.isFinite));
  const avgFillableCars = averageNumber(scoped.map((station) => station.supply?.fillableCars).filter(Number.isFinite));
  const routeProvider = routeProviderSummary();

  elements.rtsTelemetry.innerHTML = `
    <div class="rts-panel-head" data-widget-handle>
      <span>도시 에너지망</span>
      <strong>${escapeHtml(routeProvider.value)} ${escapeHtml(routeProvider.unit)}</strong>
      ${widgetToggleButton("rtsTelemetry")}
    </div>
    <div class="widget-body">
      <div class="rts-readout-grid">
        <span>운영중</span><strong>${operating}/${scoped.length}</strong>
        <span>조건통과</span><strong>${filtered.length}</strong>
        <span>평균대기</span><strong>${Number.isFinite(avgWaitCars) ? avgWaitCars.toFixed(1) : "--"}대</strong>
        <span>평균공급</span><strong>${Number.isFinite(avgFillableCars) ? avgFillableCars.toFixed(0) : "--"}대</strong>
        <span>선택상태</span><strong>${escapeHtml(selectedStation?.status.label ?? "대상 없음")}</strong>
        <span>선택공급</span><strong>${escapeHtml(formatSupplyShort(selectedStation?.supply))}</strong>
      </div>
    </div>
  `;
  applyWidgetState("rtsTelemetry");
}

function renderRtsCommandDock(selectedStation, recommendations) {
  if (!elements.rtsCommandDock) return;

  if (!selectedStation) {
    elements.rtsCommandDock.innerHTML = `
      <div class="rts-panel-head" data-widget-handle>
        <span>경로 계획</span>
        <strong>대상 없음</strong>
        ${widgetToggleButton("rtsCommandDock")}
      </div>
    `;
    applyWidgetState("rtsCommandDock");
    return;
  }

  const roles = Object.entries({
    price: "가격 우선",
    distance: "거리 우선",
    time: "최소 총시간"
  })
    .filter(([key]) => recommendations[key]?.id === selectedStation.id)
    .map(([, label]) => label);

  elements.rtsCommandDock.innerHTML = `
    <div class="rts-panel-head" data-widget-handle>
      <span>경로 계획</span>
      <strong>${escapeHtml(selectedStation.name)}</strong>
      ${widgetToggleButton("rtsCommandDock")}
    </div>
    <div class="widget-body">
      ${renderRtsRecommendationSlots(recommendations, selectedStation)}
      <div class="rts-target-block">
        <div>
          <span class="rts-kicker">선택 충전소</span>
          <h3>${escapeHtml(selectedStation.name)}</h3>
          <p>${escapeHtml(selectedStation.recommendationReason)}</p>
        </div>
        <div class="rts-target-metrics">
          <strong>${formatMinutes(selectedStation.totalMinutes)}</strong>
          <span>${formatPrice(selectedStation.price)} · ${formatDistance(selectedStation.distanceKm)} · ${escapeHtml(formatSupplyShort(selectedStation.supply))}</span>
        </div>
      </div>
      ${renderRtsTacticalPanel(selectedStation)}
      <div class="rts-command-actions">
        <button class="rts-command-button" type="button" data-rts-action="focus-selected">지도 중심</button>
        <a class="rts-command-button primary" href="${directionsUrl(selectedStation)}" target="_blank" rel="noreferrer">길안내</a>
        ${reservationActionLink(selectedStation, "rts-command-button")}
        <span>${escapeHtml(roles.join(" · ") || "수동 선택")}</span>
      </div>
    </div>
  `;
  applyWidgetState("rtsCommandDock");
}

function renderRtsRecommendationSlots(recommendations, selectedStation) {
  const slots = [
    { key: "price", code: "₩", label: "가격 우선", meta: "가격 효율" },
    { key: "distance", code: "KM", label: "거리 우선", meta: "근접성" },
    { key: "time", code: "T", label: "최소 총시간", meta: "시간 효율" }
  ];

  return `
    <div class="rts-recommend-slots" aria-label="추천 선택 슬롯">
      ${slots.map((slot) => renderRtsSlot(slot, recommendations[slot.key], selectedStation)).join("")}
    </div>
  `;
}

function renderRtsSlot(slot, station, selectedStation) {
  if (!station) {
    return `
      <div class="rts-slot ${slot.key} empty">
        ${rtsSlotIcon(slot.key, slot.code)}
        <strong>${escapeHtml(slot.label)}</strong>
        <em>대상 없음</em>
      </div>
    `;
  }

  return `
    <button class="rts-slot ${slot.key} ${station.id === selectedStation?.id ? "active" : ""}" type="button" data-rts-station="${escapeHtml(station.id)}">
      ${rtsSlotIcon(slot.key, slot.code)}
      <strong>${escapeHtml(slot.label)}</strong>
      <em>${escapeHtml(station.name)}</em>
      <b>${escapeHtml(rtsSlotMetric(slot.key, station))}</b>
      <small>${escapeHtml(slot.meta)}</small>
    </button>
  `;
}

function rtsSlotIcon(key, code) {
  const icon = {
    price: `
      <svg viewBox="0 0 44 44" aria-hidden="true">
        <circle cx="22" cy="22" r="17"></circle>
        <path d="M16 16h12M16 22h10M16 28h14"></path>
      </svg>
    `,
    distance: `
      <svg viewBox="0 0 44 44" aria-hidden="true">
        <path d="M10 31c6-14 18 0 24-14"></path>
        <circle cx="10" cy="31" r="4"></circle>
        <circle cx="34" cy="17" r="4"></circle>
      </svg>
    `,
    time: `
      <svg viewBox="0 0 44 44" aria-hidden="true">
        <circle cx="22" cy="22" r="16"></circle>
        <path d="M22 11v12l9 5"></path>
        <path d="M30 10l5-5"></path>
      </svg>
    `
  }[key];

  return `<span class="rts-slot-icon" data-code="${escapeHtml(code)}">${icon}</span>`;
}

function rtsSlotMetric(key, station) {
  if (key === "price") return formatPrice(station.price);
  if (key === "distance") return formatDistance(station.distanceKm);
  return formatMinutes(station.totalMinutes);
}

function renderRtsTacticalPanel(station) {
  const reservation = station.reservationOnly ? "예약제" : "예약 아님";
  const busOnly = station.busOnly ? "버스 전용" : "일반 가능";
  const radar = rtsRadarProfile(station);
  const chips = [
    ["가격", formatPrice(station.price)],
    ["거리", formatDistance(station.distanceKm)],
    ["총시간", formatMinutes(station.totalMinutes)],
    ["대기", formatWait(station.waitMinutes)],
    ["공급", formatSupplyShort(station.supply)],
    ["예약", reservation],
    ["차종", busOnly]
  ];

  return `
    <div class="rts-tactical-panel" aria-label="에너지 조건 요약">
      <div class="rts-radar-card">
        ${renderRtsRadarChart(radar)}
      </div>
      <div class="rts-stat-grid">
        ${chips.map(([label, value]) => `
          <span>
            <small>${escapeHtml(label)}</small>
            <strong>${escapeHtml(value)}</strong>
          </span>
        `).join("")}
      </div>
    </div>
  `;
}

function rtsRadarProfile(station) {
  const candidates = state.rankedStations.length ? state.rankedStations : [station];
  const accessScore = clamp(
    (station.status.kind === "good" ? 100 : station.status.kind === "busy" ? 72 : 38) -
      (station.reservationOnly ? 18 : 0) -
      (station.busOnly ? 26 : 0),
    20,
    100
  );

  return [
    { key: "price", label: "비용", value: relativeScore(station.price, candidates.map((item) => item.price), true) },
    { key: "distance", label: "거리", value: relativeScore(station.distanceKm, candidates.map((item) => item.distanceKm), true) },
    { key: "time", label: "시간", value: relativeScore(station.totalMinutes, candidates.map((item) => item.totalMinutes), true) },
    { key: "wait", label: "대기", value: relativeScore(station.waitMinutes, candidates.map((item) => item.waitMinutes), true) },
    { key: "supply", label: "공급", value: station.supply?.score ?? 42 },
    { key: "access", label: "접근", value: Math.round(accessScore) }
  ];
}

function relativeScore(value, values, lowerIsBetter) {
  if (!Number.isFinite(value)) return 42;
  const range = getRange(values);
  const normalizedValue = normalize(value, range);
  const directional = lowerIsBetter ? 1 - normalizedValue : normalizedValue;
  return Math.round(clamp(28 + directional * 72, 24, 100));
}

function renderRtsRadarChart(profile) {
  const center = 72;
  const radius = 54;
  const grid = [1, 0.66, 0.33].map((scale) => radarPolygon(profile.length, center, radius * scale)).join("");
  const data = profile.map((axis, index) => {
    const angle = radarAngle(index, profile.length);
    const scaled = radius * (axis.value / 100);
    return {
      ...axis,
      x: center + Math.cos(angle) * scaled,
      y: center + Math.sin(angle) * scaled,
      labelX: center + Math.cos(angle) * (radius + 18),
      labelY: center + Math.sin(angle) * (radius + 18)
    };
  });
  const points = data.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");

  return `
    <svg class="rts-radar-chart" viewBox="0 0 144 144" role="img" aria-label="선택 충전소 능력치 그래프">
      <g class="rts-radar-grid-lines">${grid}</g>
      ${profile.map((_, index) => {
        const angle = radarAngle(index, profile.length);
        const x = center + Math.cos(angle) * radius;
        const y = center + Math.sin(angle) * radius;
        return `<line class="rts-radar-axis" x1="${center}" y1="${center}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"></line>`;
      }).join("")}
      <polygon class="rts-radar-fill" points="${points}"></polygon>
      <polyline class="rts-radar-stroke" points="${points} ${data[0].x.toFixed(1)},${data[0].y.toFixed(1)}"></polyline>
      ${data.map((point) => `
        <circle class="rts-radar-node" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="3.2"></circle>
        <text class="rts-radar-label" x="${point.labelX.toFixed(1)}" y="${point.labelY.toFixed(1)}">${escapeHtml(point.label)}</text>
      `).join("")}
    </svg>
  `;
}

function radarPolygon(count, center, radius) {
  const points = Array.from({ length: count }, (_, index) => {
    const angle = radarAngle(index, count);
    return `${(center + Math.cos(angle) * radius).toFixed(1)},${(center + Math.sin(angle) * radius).toFixed(1)}`;
  }).join(" ");
  return `<polygon points="${points}"></polygon>`;
}

function radarAngle(index, count) {
  return -Math.PI / 2 + (Math.PI * 2 * index) / count;
}

function renderRtsUnitTrack(station) {
  if (!elements.rtsUnitTrack) return;
  if (!station || !Number.isFinite(station.lat) || !Number.isFinite(station.lon)) {
    elements.rtsUnitTrack.innerHTML = "";
    return;
  }

  const mapRect = document.querySelector("#map")?.getBoundingClientRect();
  if (!mapRect?.width || !mapRect?.height) {
    elements.rtsUnitTrack.innerHTML = "";
    return;
  }

  const screenPoints = rtsRoutePoints(station)
    .map(([lat, lon]) => mapContainerPoint(lat, lon, mapRect))
    .filter((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y));

  if (screenPoints.length < 2) {
    elements.rtsUnitTrack.innerHTML = "";
    return;
  }

  const motionPoints = reduceMotionPoints(screenPoints);
  const pathId = `rts-motion-${safeDomId(station.id)}`;
  const path = svgSmoothPath(motionPoints);
  const durationSeconds = clamp(screenPathLength(motionPoints) / 380, 3.2, 6.4).toFixed(1);
  elements.rtsUnitTrack.innerHTML = `
    <svg class="rts-route-svg" viewBox="0 0 ${mapRect.width} ${mapRect.height}" preserveAspectRatio="none" aria-hidden="true">
      <path class="rts-route-glow" d="${escapeHtml(path)}"></path>
      <path id="${escapeHtml(pathId)}" class="rts-route-path" d="${escapeHtml(path)}"></path>
      <g class="rts-unit-svg">
        ${rtsVehicleSvg()}
        <animateMotion dur="${durationSeconds}s" repeatCount="indefinite" rotate="auto" calcMode="paced">
          <mpath href="#${escapeHtml(pathId)}"></mpath>
        </animateMotion>
      </g>
    </svg>
  `;
}

function rtsVehicleSvg() {
  return `
    <g class="route-car-icon">
      <path class="route-car-body" d="M-23 0c5.5-10 15-15 29-15h4c10.5 0 19 5.5 26 15-7 9.5-15.5 15-26 15H6c-14 0-23.5-5-29-15Z"></path>
      <path class="route-car-cabin" d="M-3-8h12c6 0 11 2.8 15 8-4 5.2-9 8-15 8H-3c3.2-5.2 3.2-10.8 0-16Z"></path>
      <path class="route-car-front" d="M25-6 36 0 25 6"></path>
      <path class="route-car-axle" d="M-16-13h10M-16 13h10M11-13h10M11 13h10"></path>
    </g>
  `;
}

function rtsRoutePoints(station) {
  const route = selectedRouteForStation(station);
  if (route?.points?.length >= 2) return route.points;
  if (routePlanningEnabled()) {
    return [
      [state.location.lat, state.location.lon],
      [station.lat, station.lon],
      [state.destination.lat, state.destination.lon]
    ];
  }
  return [
    [state.location.lat, state.location.lon],
    [station.lat, station.lon]
  ];
}

function reduceMotionPoints(points) {
  if (points.length <= 2) return points;
  const reduced = [points[0]];

  for (const point of points.slice(1, -1)) {
    const previous = reduced[reduced.length - 1];
    if (Math.hypot(point.x - previous.x, point.y - previous.y) >= 44) {
      reduced.push(point);
    }
  }

  reduced.push(points[points.length - 1]);
  return reduced;
}

function svgSmoothPath(points) {
  if (points.length <= 2) {
    return points
      .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
      .join(" ");
  }

  const commands = [`M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`];
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    const next = points[index + 1];
    const midX = (point.x + next.x) / 2;
    const midY = (point.y + next.y) / 2;
    commands.push(`Q ${point.x.toFixed(1)} ${point.y.toFixed(1)} ${midX.toFixed(1)} ${midY.toFixed(1)}`);
  }

  const last = points[points.length - 1];
  commands.push(`L ${last.x.toFixed(1)} ${last.y.toFixed(1)}`);
  return commands.join(" ");
}

function screenPathLength(points) {
  return points.slice(1).reduce((sum, point, index) => {
    const previous = points[index];
    return sum + Math.hypot(point.x - previous.x, point.y - previous.y);
  }, 0);
}

function safeDomId(value) {
  return String(value ?? "target").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function mapContainerPoint(lat, lon, mapRect) {
  try {
    if (state.mapProvider === "leaflet" && state.map?.latLngToContainerPoint) {
      const point = state.map.latLngToContainerPoint([lat, lon]);
      return { x: point.x, y: point.y };
    }

    if (state.mapProvider === "kakao" && state.map?.getProjection && window.kakao?.maps) {
      const projection = state.map.getProjection();
      const point = projection?.containerPointFromCoords?.(new kakao.maps.LatLng(lat, lon));
      if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
        return { x: point.x, y: point.y };
      }
    }
  } catch {
    return null;
  }

  return null;
}

function renderRecommendationCard(target, { station, title, label, icon }) {
  if (!station) {
    target.classList.add("empty");
    target.innerHTML = `
      <div class="recommend-kicker"><i data-lucide="${icon}"></i>${label}</div>
      <p>조건 내 전국 후보 없음</p>
    `;
    target.onclick = null;
    return;
  }

  target.classList.remove("empty");
  target.innerHTML = `
    <div class="recommend-head">
      <div class="recommend-kicker"><i data-lucide="${icon}"></i>${label}</div>
      <span>${title}</span>
    </div>
    <h3>${escapeHtml(station.name)}</h3>
    <p class="hours-line">${escapeHtml(recommendationSubline(station))}</p>
    <div class="route-scoreline">
      <strong>${escapeHtml(primaryRouteMetric(station))}</strong>
      <span>${escapeHtml(secondaryRouteMetric(station))}</span>
    </div>
    <div class="compact-metrics compact-metrics-focus">
      <strong>${formatPrice(station.price)}</strong>
      <strong>대기 ${formatWait(station.waitMinutes)}</strong>
      <strong>${escapeHtml(formatSupplyShort(station.supply))}</strong>
    </div>
    <div class="signal-row recommend-signals">
      ${routeSourceBadge(station)}
      ${vehicleRangeBadge(station)}
      ${restrictionBadges(station)}
      ${supplyBadge(station.supply)}
    </div>
    <p class="reason-line">${escapeHtml(station.recommendationReason)}</p>
  `;
  target.onclick = () => selectStation(station.id);
}

function recommendationSubline(station) {
  const routeLabel = station.routePlan
    ? isOnRouteCandidate(station)
      ? "경로상 후보"
      : "경로 이탈 후보"
    : operatingHoursSummary(station).label;
  return `${routeLabel} · ${operatingHoursSummary(station).label}`;
}

function routePlanLine(station) {
  if (!station.routePlan) return "";
  return `<p class="route-plan-line">${escapeHtml(routeImpactText(station))}</p>`;
}

function primaryRouteMetric(station) {
  if (station.routePlan) {
    return isOnRouteCandidate(station) ? "경로상" : formatSignedMinutes(station.detourMinutes);
  }
  return formatMinutes(station.totalMinutes);
}

function secondaryRouteMetric(station) {
  if (station.routePlan) {
    const extraDistance = `+${formatDistance(station.detourDistanceKm)}`;
    if (isOnRouteCandidate(station)) {
      return `이탈 ${extraDistance} · 추가 ${formatSignedMinutes(station.detourMinutes)} · 대기 ${formatWait(station.waitMinutes)}`;
    }
    return `이탈거리 ${extraDistance} · 대기 ${formatWait(station.waitMinutes)}`;
  }
  return `${distanceMetricLabel(station)} ${formatDistance(station.distanceKm)} · 대기 ${formatWait(station.waitMinutes)}`;
}

function routeImpactText(station) {
  if (!station.routePlan) return "";
  const status = isOnRouteCandidate(station) ? "경로상 후보" : "경로 이탈";
  return `${status} · 추가시간 ${formatSignedMinutes(station.detourMinutes)} · 이탈거리 +${formatDistance(station.detourDistanceKm)}`;
}

function renderStationList(stations) {
  if (stations.length === 0) {
    elements.stationList.innerHTML = `<div class="error-block">조건에 맞는 전국 충전소가 없습니다.</div>`;
    return;
  }

  elements.stationList.innerHTML = stations
    .slice(0, 60)
    .map(
      (station) => `
      <article class="station-row ${station.id === state.selectedId ? "selected" : ""}" data-id="${escapeHtml(station.id)}">
        <div>
          <p class="station-name">${escapeHtml(station.name)}</p>
          <div class="station-meta">
            <span><i class="status-dot ${station.status.kind}"></i>${escapeHtml(station.status.label)}</span>
            <span>${formatPrice(station.price)}</span>
            <span>${escapeHtml(vehicleRangeText(station))}</span>
            <span>${escapeHtml(primaryRouteMetric(station))}</span>
            <span>${escapeHtml(secondaryRouteMetric(station))}</span>
            <span>대기 ${formatWait(station.waitMinutes)}</span>
            <span>${escapeHtml(formatSupplyShort(station.supply))}</span>
          </div>
          <div class="signal-row mini">
            ${vehicleRangeBadge(station)}
            ${restrictionBadges(station)}
            ${supplyBadge(station.supply)}
          </div>
          ${renderFacilityPills(station.facilities, 3)}
        </div>
        <div class="station-actions">
          <button class="station-action" data-action="focus" title="지도에서 보기" aria-label="지도에서 보기">
            <i data-lucide="map-pinned"></i>
          </button>
          <a class="station-action" href="${directionsUrl(station)}" target="_blank" rel="noreferrer" title="현재 출발 위치로 길안내" aria-label="현재 출발 위치로 길안내">
            <i data-lucide="navigation"></i>
          </a>
          ${reservationActionLink(station, "station-action", { label: "예약 사이트", icon: "calendar-check", iconOnly: true })}
        </div>
      </article>
    `
    )
    .join("");

  elements.stationList.querySelectorAll(".station-row").forEach((row) => {
    row.addEventListener("click", (event) => {
      const action = event.target.closest("[data-action]");
      if (action?.dataset.action === "focus" || !event.target.closest("a")) {
        selectStation(row.dataset.id);
      }
    });
  });
}

function renderMap(stations, recommendations) {
  if (state.mapProvider === "kakao") {
    renderKakaoMap(stations, recommendations);
    return;
  }

  state.routeLayer.clearLayers();
  state.stationLayer.clearLayers();
  state.markers.clear();

  const recommendationIds = new Set(
    Object.values(recommendations)
      .filter(Boolean)
      .map((station) => station.id)
  );

  for (const station of stations) {
    const marker = L.marker([station.lat, station.lon], {
      icon: makeStationIcon(station, station.id === state.selectedId, recommendationIds.has(station.id))
    });
    marker.bindPopup(popupHtml(station));
    marker.on("click", () => selectStation(station.id));
    marker.addTo(state.stationLayer);
    state.markers.set(station.id, marker);
  }

  const selectedStation = stations.find((station) => station.id === state.selectedId);
  if (!selectedStation) closeKakaoPopup();
  renderSelectedRoute(selectedStation);
}

function renderKakaoMap(stations, recommendations) {
  clearKakaoStationOverlays();
  clearKakaoRouteOverlays();
  state.markers.clear();

  const recommendationIds = new Set(
    Object.values(recommendations)
      .filter(Boolean)
      .map((station) => station.id)
  );

  for (const station of stations) {
    const overlay = makeKakaoStationOverlay(
      station,
      station.id === state.selectedId,
      recommendationIds.has(station.id)
    );
    overlay.setMap(state.map);
    state.kakao.stationOverlays.push(overlay);
    state.markers.set(station.id, overlay);
  }

  renderSelectedRoute(stations.find((station) => station.id === state.selectedId));
}

function renderSelectedRoute(station) {
  if (!station) return;
  const kakaoRoute = selectedRouteForStation(station);
  const route = kakaoRoute?.points?.length >= 2
    ? kakaoRoute.points
    : rtsRoutePoints(station);

  if (state.mapProvider === "kakao") {
    renderKakaoSelectedRoute(route, Boolean(kakaoRoute), station);
    return;
  }

  L.polyline(route, {
    className: `selected-route-casing ${kakaoRoute ? "kakao-route" : "fallback-route"}`,
    color: "#101314",
    interactive: false,
    lineCap: "round",
    opacity: 0.82,
    weight: 11
  }).addTo(state.routeLayer);

  L.polyline(route, {
    className: `selected-route-line ${kakaoRoute ? "kakao-route" : "fallback-route"}`,
    color: "#6ff4ff",
    interactive: false,
    lineCap: "round",
    opacity: 1,
    weight: 6
  }).addTo(state.routeLayer);

  L.circleMarker([station.lat, station.lon], {
    className: "selected-route-target",
    color: "#101314",
    fillColor: "#6ff4ff",
    fillOpacity: 0.85,
    opacity: 0.9,
    radius: 14,
    weight: 2
  }).addTo(state.routeLayer);
}

function renderUserMarker() {
  if (state.mapProvider === "kakao") {
    const position = new kakao.maps.LatLng(state.location.lat, state.location.lon);
    if (state.userMarker) {
      state.userMarker.setPosition(position);
      return;
    }

    const element = document.createElement("div");
    element.className = "user-marker kakao-user-marker";
    state.userMarker = new kakao.maps.CustomOverlay({
      position,
      content: element,
      xAnchor: 0.5,
      yAnchor: 0.5,
      zIndex: 40,
      clickable: true
    });
    state.userMarker.setMap(state.map);
    return;
  }

  if (state.userMarker) {
    state.userMarker.setLatLng([state.location.lat, state.location.lon]);
    return;
  }

  state.userMarker = L.marker([state.location.lat, state.location.lon], {
    icon: L.divIcon({
      className: "",
      html: `<div class="user-marker"></div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15]
    })
  }).addTo(state.map);
}

function renderDestinationMarker() {
  if (!routePlanningEnabled() || !state.map) return;

  if (state.mapProvider === "kakao") {
    const position = new kakao.maps.LatLng(state.destination.lat, state.destination.lon);
    if (state.destinationMarker) {
      state.destinationMarker.setPosition(position);
      return;
    }

    const element = document.createElement("div");
    element.className = "destination-marker kakao-destination-marker";
    element.textContent = "A";
    state.destinationMarker = new kakao.maps.CustomOverlay({
      position,
      content: element,
      xAnchor: 0.5,
      yAnchor: 0.5,
      zIndex: 38,
      clickable: false
    });
    state.destinationMarker.setMap(state.map);
    return;
  }

  if (state.destinationMarker) {
    state.destinationMarker.setLatLng([state.destination.lat, state.destination.lon]);
    return;
  }

  state.destinationMarker = L.marker([state.destination.lat, state.destination.lon], {
    icon: L.divIcon({
      className: "",
      html: `<div class="destination-marker">A</div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15]
    })
  }).addTo(state.map);
}

function makeKakaoStationOverlay(station, selected, recommended) {
  const position = new kakao.maps.LatLng(station.lat, station.lon);
  const element = document.createElement("button");
  const icon = makeStationIconSpec(station, selected, recommended);
  element.type = "button";
  element.className = icon.classes;
  element.style.setProperty("--marker-size", `${icon.size}px`);
  element.innerHTML = stationMarkerSvg(station);
  element.title = station.name;
  element.setAttribute("aria-label", `${station.name} 선택`);
  element.addEventListener("click", (event) => {
    event.preventDefault();
    selectStation(station.id);
  });

  return new kakao.maps.CustomOverlay({
    position,
    content: element,
    xAnchor: 0.5,
    yAnchor: 0.5,
    zIndex: selected ? 30 : recommended ? 22 : 18,
    clickable: true
  });
}

function renderKakaoSelectedRoute(route, isKakaoRoute, station) {
  clearKakaoRouteOverlays();
  const path = route.map(([lat, lon]) => new kakao.maps.LatLng(lat, lon));

  const casing = new kakao.maps.Polyline({
    path,
    strokeWeight: 11,
    strokeColor: "#101314",
    strokeOpacity: 0.82,
    strokeStyle: "solid"
  });
  casing.setMap(state.map);
  state.kakao.routeOverlays.push(casing);

  const line = new kakao.maps.Polyline({
    path,
    strokeWeight: 6,
    strokeColor: "#6ff4ff",
    strokeOpacity: isKakaoRoute ? 1 : 0.68,
    strokeStyle: isKakaoRoute ? "solid" : "shortdash"
  });
  line.setMap(state.map);
  state.kakao.routeOverlays.push(line);

  const target = new kakao.maps.Circle({
    center: new kakao.maps.LatLng(station.lat, station.lon),
    radius: 180,
    strokeWeight: 2,
    strokeColor: "#101314",
    strokeOpacity: 0.9,
    fillColor: "#6ff4ff",
    fillOpacity: 0.35
  });
  target.setMap(state.map);
  state.kakao.routeOverlays.push(target);
}

function clearKakaoStationOverlays() {
  for (const overlay of state.kakao.stationOverlays) {
    overlay.setMap(null);
  }
  state.kakao.stationOverlays = [];
}

function clearKakaoRouteOverlays() {
  for (const overlay of state.kakao.routeOverlays) {
    overlay.setMap(null);
  }
  state.kakao.routeOverlays = [];
}

function openKakaoPopup(station) {
  closeKakaoPopup();
  const element = document.createElement("div");
  element.className = "kakao-popup";
  element.innerHTML = popupHtml(station);
  state.kakao.popupOverlay = new kakao.maps.CustomOverlay({
    position: new kakao.maps.LatLng(station.lat, station.lon),
    content: element,
    xAnchor: 0.5,
    yAnchor: 1.35,
    zIndex: 50,
    clickable: true
  });
  state.kakao.popupOverlay.setMap(state.map);
}

function closeKakaoPopup() {
  if (!state.kakao.popupOverlay) return;
  state.kakao.popupOverlay.setMap(null);
  state.kakao.popupOverlay = null;
}

function renderDetail() {
  const station = state.rankedStations.find((item) => item.id === state.selectedId);
  if (!station) {
    elements.detailPanel.classList.remove("visible");
    elements.detailPanel.innerHTML = "";
    return;
  }

  elements.detailPanel.classList.add("visible");
  elements.detailPanel.dataset.stationId = station.id;
  elements.detailPanel.innerHTML = `
    <div class="sheet-header" data-widget-handle>
      <div>
        <span class="sheet-label">선택 충전소</span>
        <h2>${escapeHtml(station.name)}</h2>
      </div>
      <div class="sheet-actions">
        ${widgetToggleButton("detail")}
        <a class="primary-button route-button" href="${directionsUrl(station)}" target="_blank" rel="noreferrer">
          <i data-lucide="navigation"></i>
          현재위치 길안내
        </a>
        ${reservationActionLink(station, "primary-button reservation-button", { label: "예약 사이트", icon: "calendar-check" })}
      </div>
    </div>
    <div class="widget-body">
      <div class="detail-grid">
        <div class="detail-item"><span>가격</span><strong>${formatPrice(station.price)}</strong></div>
        <div class="detail-item"><span>${escapeHtml(distanceMetricLabel(station))}</span><strong>${formatDistance(station.distanceKm)}</strong></div>
        <div class="detail-item"><span>${escapeHtml(driveMetricLabel(station))}</span><strong>${escapeHtml(driveMetricValue(station))}</strong></div>
        <div class="detail-item"><span>대기</span><strong>${formatWait(station.waitMinutes)}</strong></div>
        <div class="detail-item"><span>잔량 도달성</span><strong>${escapeHtml(vehicleRangeText(station))}</strong></div>
        <div class="detail-item"><span>공급여유</span><strong>${escapeHtml(formatSupplyShort(station.supply))}</strong></div>
        <div class="detail-item wide"><span>운영시간</span><strong>${escapeHtml(operatingHoursSummary(station).label)}</strong></div>
      </div>
      ${renderRouteTimeline(station)}
      <div class="signal-row sheet-signals">
        ${routeSourceBadge(station)}
        ${vehicleRangeBadge(station)}
        ${restrictionBadges(station)}
        ${supplyBadge(station.supply)}
        ${signalBadge(station.risk)}
        ${signalBadge(station.reliability)}
        ${predictionBadge(station.prediction)}
      </div>
      <p class="reason-line">${escapeHtml(station.recommendationReason)}</p>
      <div class="sheet-meta">
        <span><i class="status-dot ${station.status.kind}"></i>${escapeHtml(station.status.label)}</span>
        <span>총 ${formatMinutes(station.totalMinutes)}</span>
        <span>${escapeHtml(station.traffic.reliability)} · ${formatSpeed(station.traffic.speedKph)}</span>
        <span>${escapeHtml(station.realtime?.congestion || "혼잡 정보 없음")}</span>
        <span>${escapeHtml(formatSupplyDetail(station.supply))}</span>
        <span>${escapeHtml(operatingHoursSummary(station).detail)}</span>
        <span>${escapeHtml(station.address || "주소 정보 없음")}</span>
      </div>
      ${renderFacilityPills(station.facilities, 6)}
    </div>
  `;
  applyWidgetState("detail");
}

function renderRouteTimeline(station) {
  const drive = Math.max(0, station.driveMinutes);
  const wait = Math.max(0, station.waitMinutes);
  const ready = 5;
  const total = Math.max(1, drive + wait + ready);

  return `
    <div class="route-timeline" aria-label="선택 충전소 이동 타임라인">
      <div class="timeline-track">
        <span class="timeline-segment start" style="--w:8%"><b>출발</b></span>
        <span class="timeline-segment drive" style="--w:${clamp((drive / total) * 100, 18, 78)}%"><b>${escapeHtml(driveMetricText(station))}</b></span>
        <span class="timeline-segment wait" style="--w:${clamp((wait / total) * 100, 10, 45)}%"><b>대기 ${formatWait(wait)}</b></span>
        <span class="timeline-segment ready" style="--w:12%"><b>${escapeHtml(formatSupplyShort(station.supply))}</b></span>
      </div>
    </div>
  `;
}

function selectStation(id, { keepPopup = false } = {}) {
  state.selectedId = id;
  const station = state.rankedStations.find((item) => item.id === id);
  if (station) {
    if (state.mapProvider === "kakao") {
      const bounds = new kakao.maps.LatLngBounds();
      bounds.extend(new kakao.maps.LatLng(state.location.lat, state.location.lon));
      bounds.extend(new kakao.maps.LatLng(station.lat, station.lon));
      state.map.setBounds(bounds);
    } else {
      const bounds = L.latLngBounds([
        [state.location.lat, state.location.lon],
        [station.lat, station.lon]
      ]);
      state.map.fitBounds(bounds, {
        maxZoom: 13,
        paddingBottomRight: [80, 220],
        paddingTopLeft: [80, 80]
      });
    }
  }
  renderDashboard();
  if (station && !keepPopup) {
    if (state.mapProvider === "kakao") {
      openKakaoPopup(station);
    } else {
      state.markers.get(id)?.openPopup();
    }
  }
}

function makeStationIcon(station, selected, recommended) {
  const icon = makeStationIconSpec(station, selected, recommended);
  return L.divIcon({
    className: "",
    html: `<div class="${icon.classes}" style="--marker-size:${icon.size}px">${stationMarkerSvg(station)}</div>`,
    iconSize: [icon.size, icon.size],
    iconAnchor: [icon.size / 2, icon.size / 2]
  });
}

function makeStationIconSpec(station, selected, recommended) {
  const waitCars = station.realtime?.waitCars;
  const markerSize = selected ? 58 : clamp(42 + (Number.isFinite(waitCars) ? waitCars * 3 : 0), 42, 50);
  const classes = [
    "h2-marker",
    station.status.kind,
    selected ? "selected" : "",
    recommended ? "recommended" : "",
    station.busOnly ? "bus-only" : "",
    station.supply?.kind === "empty" ? "supply-empty" : "",
    station.supply?.kind === "low" ? "low-supply" : "",
    station.reliability?.kind === "high" ? "stale" : ""
  ].filter(Boolean).join(" ");

  return {
    classes,
    size: markerSize
  };
}

function stationMarkerSvg(station) {
  return `
    <svg viewBox="0 0 74 74" aria-hidden="true" focusable="false">
      <circle class="marker-face" cx="37" cy="37" r="27"></circle>
      <path class="marker-pump" d="M24 22h17v28H24zM29 28h7M41 29h5l4 5v12c0 3 5 3 5 0V33l-5-6M24 50h18"></path>
      <text class="marker-h2" x="32.5" y="44">H2</text>
      <circle class="marker-status-dot" cx="53" cy="21" r="5"></circle>
      ${station.busOnly ? `<text class="marker-bus-tag" x="37" y="67">BUS</text>` : ""}
    </svg>
  `;
}

function popupHtml(station) {
  return `
    <p class="popup-title">${escapeHtml(station.name)}</p>
    <div class="popup-meta">
      <span>${formatPrice(station.price)} · ${formatDistance(station.distanceKm)} · ${escapeHtml(driveMetricText(station))} · 대기 ${formatWait(station.waitMinutes)}</span>
      <span>${escapeHtml(formatSupplyDetail(station.supply))}</span>
      <span>${escapeHtml(operatingHoursSummary(station).detail)}</span>
      <span>${escapeHtml(station.status.label)} · 총 ${formatMinutes(station.totalMinutes)}</span>
      <span>${escapeHtml(station.address || "")}</span>
      <a href="${directionsUrl(station)}" target="_blank" rel="noreferrer">현재위치 길안내 열기</a>
      ${reservationActionLink(station, "popup-reservation-link", { label: "예약 사이트 열기" })}
    </div>
  `;
}

function renderFacilityPills(facilities, limit = 6) {
  if (!facilities?.length) return "";
  return `
    <div class="facility-list">
      ${facilities
        .slice(0, limit)
        .map((facility) => `<span class="facility-pill"><i data-lucide="${facilityIcon(facility.name)}"></i>${escapeHtml(facility.name)}</span>`)
        .join("")}
    </div>
  `;
}

function facilityIcon(name) {
  if (name.includes("세차")) return "car-front";
  if (name.includes("정비")) return "wrench";
  if (name.includes("편의점")) return "store";
  if (name.includes("화장실")) return "toilet";
  if (name.includes("대기")) return "armchair";
  if (name.includes("카페") || name.includes("커피")) return "coffee";
  if (name.includes("식당")) return "utensils";
  return "circle-dot";
}

function stationStatus(station) {
  const text = `${station.operating} ${station.realtime?.operationStatus ?? ""} ${station.realtime?.posStatus ?? ""}`;
  if (/중지|종료|휴업|폐쇄|불가|영업마감|N/i.test(text)) {
    return { kind: "closed", label: station.realtime?.operationStatus || "운영 불확실" };
  }
  if (/혼잡|대기|지연/.test(station.realtime?.congestion ?? "")) {
    return { kind: "busy", label: station.realtime?.operationStatus || "운영 중" };
  }
  return { kind: "good", label: station.realtime?.operationStatus || (station.operating === "Y" ? "운영 중" : "상태 정보 없음") };
}

function stationSupply(station) {
  const fillableCars = station.realtime?.fillableCars;
  const ttPressure = station.realtime?.ttPressure;
  const fillRate = parseStationFillRate(station);
  const base = {
    fillableCars: Number.isFinite(fillableCars) ? fillableCars : null,
    ttPressure: Number.isFinite(ttPressure) ? ttPressure : null,
    fillRate: fillRate?.value ?? null,
    fillRateLabel: fillRate?.label ?? ""
  };

  if (Number.isFinite(fillableCars)) {
    const supporting = [];
    if (fillRate) supporting.push(`충전률 ${fillRate.label}`);
    if (Number.isFinite(ttPressure)) supporting.push(`TT ${Math.round(ttPressure)}`);
    const description = [`충전가능 ${Math.round(fillableCars)}대`, ...supporting].join(" · ");

    if (fillableCars <= 0) {
      return { ...base, kind: "empty", label: "공급 없음", score: 12, description };
    }
    if (fillableCars < LOW_SUPPLY_CAR_THRESHOLD) {
      return { ...base, kind: "low", label: "공급 낮음", score: clamp(20 + fillableCars * 5, 18, 42), description };
    }
    if (fillableCars < MODERATE_SUPPLY_CAR_THRESHOLD) {
      return { ...base, kind: "medium", label: "공급 보통", score: clamp(44 + fillableCars * 3, 44, 72), description };
    }
    return { ...base, kind: "high", label: "공급 충분", score: clamp(68 + fillableCars * 1.2, 72, 100), description };
  }

  if (fillRate) {
    const value = fillRate.value;
    const description = `충전률 ${fillRate.label}`;
    if (value < 20) return { ...base, kind: "low", label: "공급 낮음", score: 34, description };
    if (value < 55) return { ...base, kind: "medium", label: "공급 보통", score: 58, description };
    return { ...base, kind: "high", label: "공급 충분", score: 84, description };
  }

  if (Number.isFinite(ttPressure)) {
    const description = `TT ${Math.round(ttPressure)}`;
    if (ttPressure <= 0) return { ...base, kind: "empty", label: "공급 없음", score: 12, description };
    if (ttPressure < 700) return { ...base, kind: "low", label: "공급 낮음", score: 36, description };
    if (ttPressure < 1100) return { ...base, kind: "medium", label: "공급 보통", score: 62, description };
    return { ...base, kind: "high", label: "공급 충분", score: 82, description };
  }

  return {
    ...base,
    kind: "unknown",
    label: "공급 불확실",
    score: 42,
    description: "충전가능 대수 정보 없음"
  };
}

function parseStationFillRate(station) {
  const text = `${station.event ?? ""} ${station.chargerNote ?? ""}`;
  const match = text.match(/충전[률율]\s*[:：]?\s*(\d{1,3})(?:\s*[~\-–]\s*(\d{1,3}))?\s*%/);
  if (!match) return null;

  const first = Number(match[1]);
  const second = match[2] ? Number(match[2]) : first;
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null;

  const low = clamp(Math.min(first, second), 0, 100);
  const high = clamp(Math.max(first, second), 0, 100);
  return {
    value: low,
    label: low === high ? `${low}%` : `${low}-${high}%`
  };
}

function competitionRisk(station, reliability) {
  if (!station.realtime || reliability.kind === "unknown") {
    return {
      kind: "unknown",
      label: "경쟁 불확실",
      description: "실시간 갱신 정보 부족"
    };
  }

  const waitCars = station.realtime?.waitCars;
  const congestion = station.realtime?.congestion ?? "";
  const predictedRisk = station.prediction?.risk;

  if (waitCars >= 3 || congestion.includes("혼잡") || predictedRisk === "high") {
    return {
      kind: "high",
      label: "경쟁 높음",
      description: `${formatWaitCars(waitCars)} · ${congestion || station.prediction?.label || "예상 혼잡"}`
    };
  }

  if (waitCars >= 1 || congestion.includes("보통") || predictedRisk === "medium") {
    return {
      kind: "medium",
      label: "경쟁 보통",
      description: `${formatWaitCars(waitCars)} · ${congestion || station.prediction?.label || "보통"}`
    };
  }

  return {
    kind: "low",
    label: "경쟁 낮음",
    description: `${formatWaitCars(waitCars)} · ${congestion || "여유"}`
  };
}

function dataReliability(station) {
  const updatedAt = parseDate(station.realtime?.lastUpdated);
  if (!updatedAt) {
    return {
      kind: "unknown",
      label: "신뢰도 불확실",
      description: "갱신시각 없음"
    };
  }

  const ageMinutes = Math.max(0, Math.round((Date.now() - updatedAt.getTime()) / 60_000));
  if (ageMinutes <= 10) {
    return {
      kind: "low",
      label: "신뢰도 높음",
      description: `${ageMinutes}분 전 갱신`
    };
  }
  if (ageMinutes <= 30) {
    return {
      kind: "medium",
      label: "신뢰도 보통",
      description: `${ageMinutes}분 전 갱신`
    };
  }
  return {
    kind: "high",
    label: "갱신 지연",
    description: `${ageMinutes}분 전 갱신`
  };
}

function recommendationReason(station, driveMinutes, waitMinutes, reliability, reservationOnly, busOnly, traffic, supply) {
  const waitCars = station.realtime?.waitCars;
  const reservation = reservationOnly ? "예약제" : "예약제 아님";
  const serviceType = busOnly ? "버스전용" : "일반 이용";
  const driveLabel = station.routePlan ? "추가시간" : traffic.source === "kakao-navi" ? "카카오 주행" : "추정 주행";
  const routePlan = station.routePlan ? routeImpactText(station) : "";
  const driveText = station.routePlan ? `${driveLabel} ${formatSignedMinutes(driveMinutes)}` : `${driveLabel} ${formatMinutes(driveMinutes)}`;
  const vehicleText = station.vehicle ? vehicleRangeText(station) : "";
  return [formatWaitCars(waitCars), formatSupplyShort(supply), vehicleText, routePlan, driveText, `대기 ${formatWait(waitMinutes)}`, operatingHoursSummary(station).label, reservation, serviceType]
    .filter(Boolean)
    .join(", ");
}

function signalBadge(signal) {
  return `<span class="signal-badge ${signal.kind}">${escapeHtml(signal.label)}</span>`;
}

function supplyBadge(supply) {
  return `<span class="signal-badge supply ${escapeHtml(supply?.kind ?? "unknown")}" title="${escapeHtml(supply?.description ?? "공급 정보 없음")}">${escapeHtml(supply?.label ?? "공급 불확실")}</span>`;
}

function vehicleRangeBadge(station) {
  const vehicle = station.vehicle;
  if (!vehicle) return "";
  const kind = vehicle.reachable ? "reachable" : "unreachable";
  const label = vehicle.reachable ? "잔량 도달" : "잔량 부족";
  return `<span class="signal-badge vehicle-range ${kind}" title="${escapeHtml(vehicleRangeText(station))}">${label}</span>`;
}

function vehicleRangeText(station) {
  const vehicle = station.vehicle;
  if (!vehicle) return "잔량 정보 없음";
  const toStation = Number.isFinite(vehicle.toStationKm) ? formatDistance(vehicle.toStationKm) : "거리 정보 없음";
  if (!vehicle.reachable) return `도달 불가 · 필요 ${toStation}`;
  const margin = Number.isFinite(vehicle.marginKm) ? formatDistance(Math.max(0, vehicle.marginKm)) : "여유 정보 없음";
  return `도달 가능 · 여유 ${margin}`;
}

function predictionBadge(prediction) {
  if (!prediction) return `<span class="signal-badge unknown">예측 불확실</span>`;
  return `<span class="signal-badge prediction ${prediction.risk}">${escapeHtml(prediction.label)} · ${prediction.sampleCount}건</span>`;
}

function routeSourceBadge(station) {
  const isRoutePlan = Boolean(station.routePlan);
  const isKakao = station.traffic?.source === "kakao-navi" || station.traffic?.source === "kakao-route-plan";
  const label = isRoutePlan ? "목적지 경유" : isKakao ? "카카오 경로" : "추정 경로";
  return `<span class="signal-badge route-source ${isKakao ? "kakao" : "fallback"}">${label}</span>`;
}

function restrictionBadges(station) {
  const badges = [];
  if (station.reservationOnly) {
    badges.push(`<span class="signal-badge restriction reservation">예약제</span>`);
  } else if (isReservationOperatedStation(station)) {
    badges.push(`<span class="signal-badge restriction reservation-available">예약운영</span>`);
  }
  if (station.busOnly) badges.push(`<span class="signal-badge restriction bus-only">버스 전용</span>`);
  return badges.join("");
}

function driveMetricText(station) {
  if (station.routePlan) return `${driveMetricLabel(station)} ${formatSignedMinutes(station.driveMinutes)}`;
  return `${driveMetricLabel(station)} ${formatMinutes(station.driveMinutes)}`;
}

function driveMetricValue(station) {
  return station.routePlan ? formatSignedMinutes(station.driveMinutes) : formatMinutes(station.driveMinutes);
}

function driveMetricLabel(station) {
  if (station.routePlan) return "추가시간";
  return station.traffic?.source === "kakao-navi" ? "카카오 주행" : "추정 주행";
}

function distanceMetricLabel(station) {
  if (station.routePlan) return "경로이탈";
  return station.traffic?.source === "kakao-navi" ? "도로거리" : "직선거리";
}

function operatingHoursSummary(station) {
  const hours = station.hours?.[todayHoursKey()];
  const start = normalizeHour(hours?.start);
  const end = normalizeHour(hours?.end);
  const breakStart = normalizeHour(station.breakTime?.start);
  const breakEnd = normalizeHour(station.breakTime?.end);

  if (!start || !end) {
    return {
      label: "오늘 운영시간 정보 없음",
      detail: weeklyHoursSummary(station) || "운영시간 정보 없음"
    };
  }

  const label = isAllDayHours(start, end) ? "오늘 24시간" : `오늘 ${start}-${end}`;
  const breakText = breakStart && breakEnd ? `휴게 ${breakStart}-${breakEnd}` : "";

  return {
    label,
    detail: [label, breakText].filter(Boolean).join(" · ")
  };
}

function weeklyHoursSummary(station) {
  const keys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const values = keys
    .map((key) => {
      const start = normalizeHour(station.hours?.[key]?.start);
      const end = normalizeHour(station.hours?.[key]?.end);
      return start && end ? `${start}-${end}` : "";
    })
    .filter(Boolean);
  const unique = [...new Set(values)];
  if (unique.length === 1) return `주간 ${unique[0]}`;
  return "";
}

function todayHoursKey() {
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][new Date().getDay()] ?? "mon";
}

function normalizeHour(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const compact = text.replace(/[^\d]/g, "");
  if (compact.length < 3) return "";
  const padded = compact.padStart(4, "0").slice(0, 4);
  const hour = Number(padded.slice(0, 2));
  const minute = Number(padded.slice(2, 4));
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 24 || minute > 59) return "";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function isAllDayHours(start, end) {
  return start === "00:00" && ["23:59", "24:00"].includes(end);
}

function isCapitalRegionStation(station) {
  return isSeoulStation(station) || isGyeonggiStation(station);
}

function isSeoulStation(station) {
  return [station.address, station.roadAddress, station.lotAddress]
    .filter(Boolean)
    .some((address) => {
      const value = String(address).trim();
      return value.startsWith("서울 ") || value.startsWith("서울특별시") || value.startsWith("서울시 ");
    });
}

function isGyeonggiStation(station) {
  return [station.address, station.roadAddress, station.lotAddress]
    .filter(Boolean)
    .some((address) => {
      const value = String(address).trim();
      return value.startsWith("경기 ") || value.startsWith("경기도");
    });
}

function isReservationOnlyStation(station) {
  const searchable = `${station.name} ${station.event} ${station.chargerNote}`;
  return /사전\s*예약|예약제/.test(searchable);
}

function isReservationOperatedStation(station) {
  const reservationFlag = String(station.reservationAvailable ?? "").trim();
  return station.reservationOnly || /^(Y|YES|예|가능|예약가능)$/i.test(reservationFlag);
}

function isBusOnlyStation(station) {
  const vehicleText = (station.vehicleKinds ?? []).join(" ");
  if (/버스/.test(vehicleText) && !/승용|승용차|넥쏘|트럭/.test(vehicleText)) return true;
  if (/버스/.test(vehicleText) && /승용|승용차|넥쏘|트럭/.test(vehicleText)) return false;

  const searchable = `${station.name ?? ""} ${station.event ?? ""} ${station.chargerNote ?? ""} ${station.stationType ?? ""} ${station.equipmentType ?? ""}`;
  const publicCarAvailable = /승용\s*가능|승용차\s*가능|넥쏘\s*가능|승용.*충전\s*가능|승용차.*충전\s*가능/.test(searchable);
  const busPriorityWindow = /버스\s*(우선|집중)\s*충전|버스\s*충전\s*시간|버스\s*충전가능\s*시간/.test(searchable);
  const busOnlyPattern = /버스\s*전용|버스전용|수소버스\s*전용|수소버스\s*충전소|버스\s*충전소/.test(searchable);
  return busOnlyPattern && !publicCarAvailable && !busPriorityWindow;
}

function estimateWaitMinutes(station) {
  const waitCars = station.realtime?.waitCars;
  if (Number.isFinite(waitCars)) return waitCars * WAIT_MINUTES_PER_CAR;
  const congestion = station.realtime?.congestion ?? "";
  if (congestion.includes("혼잡")) return 25;
  if (congestion.includes("보통")) return 10;
  return 0;
}

function stationTraffic(station) {
  const traffic = station.traffic ?? {};
  const speedKph = Number.isFinite(traffic.speedKph)
    ? traffic.speedKph
    : Number.isFinite(state.traffic?.avgSpeedKph)
      ? state.traffic.avgSpeedKph
      : AVG_DRIVE_SPEED_KPH;

  return {
    source: traffic.source ?? state.traffic?.source ?? "fallback",
    sourceName: traffic.sourceName ?? state.traffic?.sourceName ?? "평균속도",
    speedKph: clamp(speedKph, 12, 55),
    rawSpeedKph: traffic.rawSpeedKph ?? speedKph,
    probeLinkId: traffic.probeLinkId ?? null,
    reliability: traffic.reliability ?? (state.traffic?.available ? "교통 API 반영" : "평균속도 추정"),
    observedAt: traffic.observedAt ?? state.traffic?.observedAt ?? null
  };
}

function estimateDriveMinutes(distanceKm, traffic) {
  const routeDistanceKm = distanceKm * ROUTE_DISTANCE_FACTOR;
  return (routeDistanceKm / traffic.speedKph) * 60;
}

function availabilityPenalty(station) {
  let penalty = 0;
  if (station.status.kind === "closed") penalty += 0.35;
  if (!station.realtime) penalty += 0.08;
  if (station.risk?.kind === "high") penalty += 0.18;
  if (station.risk?.kind === "medium") penalty += 0.08;
  if (station.risk?.kind === "unknown") penalty += 0.06;
  if (station.reliability?.kind === "high") penalty += 0.08;
  if (station.supply?.kind === "empty") penalty += 0.32;
  if (station.supply?.kind === "low") penalty += 0.18;
  if (station.supply?.kind === "medium") penalty += 0.06;
  if (station.supply?.kind === "unknown") penalty += 0.05;
  return penalty;
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

function parseFilterValue(value) {
  if (value === "all") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getRange(values) {
  const numeric = values.filter((value) => Number.isFinite(value));
  if (!numeric.length) return { min: 0, max: 1, fallback: 1 };
  return {
    min: Math.min(...numeric),
    max: Math.max(...numeric),
    fallback: Math.max(...numeric) * 1.2
  };
}

function normalize(value, range) {
  const usableValue = Number.isFinite(value) ? value : range.fallback;
  if (range.max === range.min) return 0;
  return (usableValue - range.min) / (range.max - range.min);
}

function locationText() {
  return `${state.location.label}: ${state.location.lat.toFixed(5)}, ${state.location.lon.toFixed(5)}`;
}

function destinationText() {
  return `${state.destination.label}: ${state.destination.lat.toFixed(5)}, ${state.destination.lon.toFixed(5)}`;
}

function setBadge(kind, text) {
  elements.sourceBadge.className = `badge ${kind}`;
  elements.sourceBadge.textContent = text;
}

function directionsUrl(station) {
  const originName = kakaoLinkName(state.location.label || "현재위치");
  const destinationName = kakaoLinkName(station.name || "수소충전소");
  return `https://map.kakao.com/link/from/${originName},${formatCoordinate(state.location.lat)},${formatCoordinate(state.location.lon)}/to/${destinationName},${formatCoordinate(station.lat)},${formatCoordinate(station.lon)}`;
}

function reservationBookingUrl(station) {
  const reservationText = `${station.name ?? ""} ${station.event ?? ""} ${station.chargerNote ?? ""}`;
  if (/하이케어|H2\s*Care/i.test(reservationText)) return H2CARE_APP_URL;
  return station.reservationUrl || station.bookingUrl || H2_RESERVATION_URL;
}

function reservationActionLink(station, className, options = {}) {
  if (!isReservationOperatedStation(station)) return "";
  const label = options.label ?? "예약 사이트";
  const icon = options.icon ? `<i data-lucide="${escapeHtml(options.icon)}"></i>` : "";
  const text = options.iconOnly ? "" : escapeHtml(label);
  return `
    <a class="${escapeHtml(className)} reservation-link" href="${escapeHtml(reservationBookingUrl(station))}" target="_blank" rel="noreferrer" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">
      ${icon}${text}
    </a>
  `;
}

function kakaoLinkName(value) {
  return encodeURIComponent(String(value).replace(/[,/]/g, " ").trim() || "위치");
}

function formatCoordinate(value) {
  return Number(value).toFixed(6);
}

function formatPrice(value) {
  return Number.isFinite(value) ? `${Math.round(value).toLocaleString("ko-KR")}원/kg` : "가격 정보 없음";
}

function formatDistance(value) {
  return Number.isFinite(value) ? `${value.toFixed(value < 10 ? 1 : 0)}km` : "거리 정보 없음";
}

function formatSpeed(value) {
  return Number.isFinite(value) ? `${Math.round(value)}km/h` : "속도 정보 없음";
}

function formatMinutes(value) {
  if (!Number.isFinite(value)) return "시간 정보 없음";
  if (value < 60) return `${Math.round(value)}분`;
  const hours = Math.floor(value / 60);
  const minutes = Math.round(value % 60);
  return `${hours}시간 ${minutes}분`;
}

function formatSignedMinutes(value) {
  if (!Number.isFinite(value)) return "정보 없음";
  return `${value >= 0 ? "+" : "-"}${formatMinutes(Math.abs(value))}`;
}

function formatWait(value) {
  return Number.isFinite(value) ? `${Math.round(value)}분` : "정보 없음";
}

function formatWaitCars(value) {
  return Number.isFinite(value) ? `대기 ${value}대` : "대기 정보 없음";
}

function formatSupplyShort(supply) {
  if (!supply) return "공급 정보 없음";
  if (Number.isFinite(supply.fillableCars)) return `충전가능 ${Math.round(supply.fillableCars)}대`;
  if (Number.isFinite(supply.fillRate)) return `충전률 ${supply.fillRateLabel || `${Math.round(supply.fillRate)}%`}`;
  if (Number.isFinite(supply.ttPressure)) return `TT ${Math.round(supply.ttPressure)}`;
  return supply.label || "공급 정보 없음";
}

function formatSupplyDetail(supply) {
  if (!supply) return "공급 정보 없음";
  return supply.description || formatSupplyShort(supply);
}

function formatClock(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function averageNumber(values) {
  const numeric = values.filter(Number.isFinite);
  if (!numeric.length) return NaN;
  return numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
}

function percentOf(value, max) {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return (value / max) * 100;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function riskValue(kind) {
  if (kind === "high") return 3;
  if (kind === "medium") return 2;
  if (kind === "low") return 1;
  return 0.5;
}

function heatLevel(bucket) {
  if (!bucket || bucket.sampleCount === 0) return 0;
  if (bucket.avgWaitCars >= 3 || bucket.busyRate >= 0.6) return 4;
  if (bucket.avgWaitCars >= 1.5 || bucket.busyRate >= 0.35) return 3;
  if (bucket.avgWaitCars >= 0.5 || bucket.busyRate >= 0.1) return 2;
  return 1;
}

function parseDate(value) {
  if (!value) return null;
  const text = String(value).trim();
  const compact = text.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (compact) {
    const [, year, month, day, hour, minute, second] = compact;
    return new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second)
    );
  }

  const normalized = text.replace(" ", "T");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
