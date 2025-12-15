"use client";

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import { useEffect, useMemo } from "react";

export type MapPoint = { id: string; name: string; lat: number; lng: number };

const defaultIcon = L.icon({
  iconUrl: (markerIcon as any).src ?? (markerIcon as any),
  iconRetinaUrl: (markerIcon2x as any).src ?? (markerIcon2x as any),
  shadowUrl: (markerShadow as any).src ?? (markerShadow as any),
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

export function LeafletMap({
  points,
  zoom = 6,
  height = 520,
  compact = false,
  fallbackCenter = [44.0, 12.0],
}: {
  points: MapPoint[];
  zoom?: number;
  height?: number;
  compact?: boolean;
  fallbackCenter?: [number, number];
}) {
  useEffect(() => {
    L.Marker.prototype.options.icon = defaultIcon;
  }, []);

  const center = useMemo<[number, number]>(() => {
    if (points.length > 0) {
      return [points[0].lat, points[0].lng];
    }
    return fallbackCenter;
  }, [points, fallbackCenter]);

  return (
    <div
      className={
        compact
          ? "h-full w-full"
          : "overflow-hidden rounded-2xl border border-blue-100 shadow-md"
      }
      style={{ height }}
    >
      <MapContainer
        center={center}
        zoom={zoom}
        scrollWheelZoom
        className="h-full w-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {points.map((point) => (
          <Marker
            key={point.id}
            position={[point.lat, point.lng]}
            icon={defaultIcon}
          >
            <Popup>
              <div className="space-y-1">
                <div className="text-sm font-semibold text-slate-900">
                  {point.name || "未命名位置"}
                </div>
                <div className="text-[11px] text-slate-500">
                  Lat: {point.lat.toFixed(6)} · Lng: {point.lng.toFixed(6)}
                </div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
