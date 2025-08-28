import React, { useEffect, useMemo, useRef } from "react";
import mapboxgl from "mapbox-gl";
import { io } from "socket.io-client";
import useDroneStore from "./store";
import "./index.css";
import "mapbox-gl/dist/mapbox-gl.css";

const DEMO_MODE = false;
const DEMO_INTERVAL_MS = 500;

const ALLOWED_PREFIX = "SD-";
const ALLOWED_CHAR = "B";

mapboxgl.accessToken =
  "pk.eyJ1IjoiYWJkZWxyYWhtYW5hc3NhciIsImEiOiJjbWV0bDcxcnMwMGdjMm5zODdxa2R6ZjY3In0.iGYzvWg33bknHCuablcSXA";

export default function App() {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const socketRef = useRef(null);

  const markersRef = useRef(new Map());
  const frozenPosRef = useRef(new Map());

  const addOrUpdateDrone = useDroneStore((s) => s.addOrUpdateDrone);
  const drones = useDroneStore((s) => s.drones);
  const selectedDroneId = useDroneStore((s) => s.selectedDroneId);
  const setSelectedDrone = useDroneStore((s) => s.setSelectedDrone);

  const isAllowed = (id) => {
    if (!id || typeof id !== "string") return false;
    if (!id.startsWith(ALLOWED_PREFIX)) return false;
    return id[ALLOWED_PREFIX.length] === ALLOWED_CHAR;
  };

  const redDrones = useMemo(
    () => Object.values(drones).filter((d) => !isAllowed(d.id)),
    [drones]
  );

  const fmtFlightTime = (ms) => {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = String(Math.floor(total / 3600)).padStart(2, "0");
    const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
    const s = String(total % 60).padStart(2, "0");
    return `${h}:${m}:${s}`;
  };

  const popupHTML = (drone) => {
    const flightMs = Date.now() - (drone.firstSeen || Date.now());
    return `
      <div style="font-family: system-ui, sans-serif; min-width: 180px;">
        <div style="font-weight: 600; margin-bottom: 4px;">${drone.id || "N/A"}</div>
        <div><strong>Flight time:</strong> ${fmtFlightTime(flightMs)}</div>
        <div><strong>Altitude:</strong> ${
          typeof drone.altitude === "number" ? drone.altitude + " m" : "-"
        }</div>
        <div><strong>Yaw:</strong> ${drone.yaw ?? 0}°</div>
      </div>
    `;
  };

  const createMarkerElement = (imgSrc) => {
    const el = document.createElement("img");
    el.src = imgSrc;
    el.alt = "drone";
    el.style.width = "30px";
    el.style.height = "30px";
    el.style.transformOrigin = "center center";
    el.style.cursor = "pointer";
    return el;
  };

  useEffect(() => {
    if (map.current) return;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/streets-v11",
      center: [35.9, 31.95],
      zoom: 10,
    });

    map.current.addControl(new mapboxgl.NavigationControl(), "top-right");

    map.current.on("load", () => {
      map.current.addSource("drone-paths", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.current.addLayer({
        id: "drone-paths-layer",
        type: "line",
        source: "drone-paths",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": [
            "case",
            ["==", ["get", "allowed"], true],
            "#2e7d32",
            "#c62828",
          ],
          "line-width": 3,
          "line-opacity": 0.9,
        },
      });
    });
  }, []);

  useEffect(() => {
    const socket = io("http://localhost:9013", { transports: ["polling"] });
    socketRef.current = socket;

    socket.on("connect", () => console.log("[socket] connected"));

    socket.on("message", (fc) => {
      const feat = fc?.features?.[0];
      if (!feat || feat.geometry?.type !== "Point") return;

      const [lon, lat] = feat.geometry.coordinates || [];
      const p = feat.properties || {};
      const id = p.registration || "SD-UNK";
      const yaw = p.yaw ?? 0;

      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;

      if (!isAllowed(id)) {
        const key = String(id);
        if (!frozenPosRef.current.has(key)) {
          frozenPosRef.current.set(key, { lon, lat, yaw });
        }
        const lock = frozenPosRef.current.get(key);
        addOrUpdateDrone({
          id,
          lon: lock.lon,
          lat: lock.lat,
          yaw: lock.yaw,
          altitude: p.altitude,
          registration: p.registration,
          name: p.Name,
          pilot: p.pilot,
          organization: p.organization,
        });
      } else {
        frozenPosRef.current.delete(String(id));
        addOrUpdateDrone({
          id,
          lon,
          lat,
          yaw,
          altitude: p.altitude,
          registration: p.registration,
          name: p.Name,
          pilot: p.pilot,
          organization: p.organization,
        });
      }
    });

    return () => socket.disconnect();
  }, [addOrUpdateDrone]);

  useEffect(() => {
    if (!DEMO_MODE) return;
    if (!Object.keys(drones).length) return;

    let t = 0;
    const idToPhase = new Map();

    const timer = setInterval(() => {
      const state = useDroneStore.getState();
      const addOrUpdate = state.addOrUpdateDrone;

      Object.values(state.drones).forEach((d, idx) => {
        if (!isAllowed(d.id)) return;

        if (!idToPhase.has(d.id)) idToPhase.set(d.id, Math.random() * Math.PI * 2);
        const phase = idToPhase.get(d.id);

        const R = 0.0012;
        const angle = t * 0.2 + phase;

        const newLon = d.lon + R * Math.cos(angle);
        const newLat = d.lat + R * Math.sin(angle);

        addOrUpdate({
          ...d,
          lon: newLon,
          lat: newLat,
          yaw: ((d.yaw ?? 0) + 15) % 360,
          altitude: (d.altitude ?? 100) + (idx % 2 ? 1 : -1),
        });
      });

      t += 1;
    }, DEMO_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [drones]);

  useEffect(() => {
    if (!map.current) return;

    Object.values(drones).forEach((drone) => {
      const allowed = isAllowed(drone.id);
      const imgSrc = allowed ? "/green.svg" : "/red.svg";
      const id = drone.id;

      let marker = markersRef.current.get(id);
      if (!marker) {
        const el = createMarkerElement(imgSrc);

        const popup = new mapboxgl.Popup({ offset: 24, closeButton: false }).setHTML(
          popupHTML(drone)
        );

        marker = new mapboxgl.Marker({ element: el, rotationAlignment: "map" })
          .setLngLat([drone.lon, drone.lat])
          .setPopup(popup)
          .addTo(map.current);

        el.addEventListener("click", () => setSelectedDrone(id));
        markersRef.current.set(id, marker);
      }

      marker.setLngLat([drone.lon, drone.lat]);

      const el = marker.getElement();
      if (el) {
        const wanted = window.location.origin + imgSrc;
        if (el.src !== wanted) el.src = imgSrc;

        if (!allowed && frozenPosRef.current.has(String(id))) {
          const lock = frozenPosRef.current.get(String(id));
          el.style.transform = `rotate(${lock.yaw || 0}deg)`;
        } else {
          el.style.transform = `rotate(${drone.yaw || 0}deg)`;
        }
      }

      marker.getPopup()?.setHTML(popupHTML(drone));
    });

    const currentIds = new Set(Object.keys(drones).map(String));
    for (const [id, marker] of markersRef.current.entries()) {
      if (!currentIds.has(String(id))) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }
  }, [drones, setSelectedDrone]);

  useEffect(() => {
    if (!map.current) return;
    const src = map.current.getSource("drone-paths");
    if (!src) return;

    const features = Object.values(drones)
      .filter((d) => Array.isArray(d.path) && d.path.length > 1)
      .map((d) => ({
        type: "Feature",
        properties: { allowed: isAllowed(d.id) },
        geometry: { type: "LineString", coordinates: d.path },
      }));

    src.setData({ type: "FeatureCollection", features });
  }, [drones]);

  useEffect(() => {
    if (!map.current || selectedDroneId == null) return;
    const d = drones[selectedDroneId];
    if (!d) return;

    map.current.flyTo({
      center: [d.lon, d.lat],
      zoom: Math.max(map.current.getZoom(), 14),
      essential: true,
    });

    const marker = markersRef.current.get(selectedDroneId);
    const el = marker?.getElement();
    if (el) {
      el.classList.add("pulse");
      setTimeout(() => el.classList.remove("pulse"), 800);
    }
  }, [selectedDroneId, drones]);

  return (
    <div style={{ display: "flex", height: "100vh", position: "relative" }}>
      <div className="sidebar">
        <h3 className="sidebar-title">Drones List</h3>
        {Object.values(drones).length === 0 && (
          <div className="empty-hint">No drones yet… waiting for live data</div>
        )}
        {Object.values(drones).map((drone) => {
          const allowed = isAllowed(drone.id);
          const isSelected = drone.id === selectedDroneId;
          return (
            <div
              key={drone.id}
              className={`drone-item ${allowed ? "allowed" : "not-allowed"} ${
                isSelected ? "selected" : ""
              }`}
              onClick={() => setSelectedDrone(drone.id)}
              title={`Go to ${drone.id}`}
            >
              <img className="drone-icon" src="/drone.svg" alt="Drone" />
              <div className="drone-meta">
                <div className="drone-id">{drone.id}</div>
                <div className="drone-sub">
                  Alt: {typeof drone.altitude === "number" ? `${drone.altitude} m` : "-"} • Yaw:{" "}
                  {drone.yaw ?? 0}°
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div ref={mapContainer} style={{ flex: 1 }} />

      <div className="counter">Red Drones: {redDrones.length}</div>
    </div>
  );
}

