"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { base, bitable, dashboard } from "@lark-base-open/js-sdk";

type TableOption = { id: string; name: string };
type FieldOption = { id: string; name: string; type?: string };
type MapPoint = { id: string; name: string; lat: number; lng: number };
type DashboardState = "Create" | "Config" | "View" | "FullScreen" | "Unknown";

const LeafletMap = dynamic(
  () => import("./components/LeafletMap").then((m) => m.LeafletMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[520px] w-full items-center justify-center rounded-2xl border border-blue-100 bg-white shadow-md">
        <p className="text-sm text-slate-500">地图加载中…</p>
      </div>
    ),
  }
);

const mockPoints: MapPoint[] = [
  { id: "1", name: "上海静安寺店", lat: 31.223, lng: 121.445 },
  { id: "2", name: "上海陆家嘴店", lat: 31.240, lng: 121.513 },
  { id: "3", name: "杭州西湖店", lat: 30.249, lng: 120.155 },
  { id: "4", name: "深圳南山店", lat: 22.533, lng: 113.930 },
];

export default function Home() {
  const [sdkReady, setSdkReady] = useState(false);
  const [status, setStatus] = useState<string>("等待飞书环境…");
  const [tableOptions, setTableOptions] = useState<TableOption[]>([]);
  const [fieldOptions, setFieldOptions] = useState<FieldOption[]>([]);
  const [selectedTableId, setSelectedTableId] = useState<string>("");
  const [nameFieldId, setNameFieldId] = useState<string>("");
  const [locationFieldId, setLocationFieldId] = useState<string>("");
  const [points, setPoints] = useState<MapPoint[]>(mockPoints);
  const [loading, setLoading] = useState(false);
  const [usingMock, setUsingMock] = useState(true);
  const bitableRef = useRef<any | null>(null);
  const dashboardRef = useRef<typeof dashboard | null>(null);
  const [dashboardState, setDashboardState] = useState<DashboardState>("Unknown");
  const [config, setConfig] = useState<any | null>(null);

  useEffect(() => {
    const bootstrap = async () => {
      try {
        await bridgeReady(bitable);
        await bridgeReady(dashboard);

        dashboardRef.current = dashboard;
        const st =
          (dashboard && (dashboard.state as DashboardState)) ||
          (dashboard && (await (dashboard as any)?.getState?.())) ||
          "Unknown";
        setDashboardState(st ?? "Unknown");

        if ((dashboard as any)?.onStateChange) {
          (dashboard as any).onStateChange((next: DashboardState) => {
            setDashboardState(next ?? "Unknown");
          });
        }

        if ((dashboard as any)?.onConfigChange) {
          (dashboard as any).onConfigChange(async (e: any) => {
            setConfig(e?.data);
          });
        }

        if ((dashboard as any)?.onDataChange) {
          (dashboard as any).onDataChange(async (e: any) => {
            const mapped = mapDashboardData(e?.data);
            updatePoints(mapped);
          });
        }

        bitableRef.current = bitable;
        const meta = await base.getTableMetaList();
        const tables = (meta || []).map((t: any) => ({
          id: t.id,
          name: t.name,
        }));
        setTableOptions(tables);

        let initialTableId = tables[0]?.id ?? "";
        let initialNameField = "";
        let initialLocField = "";

        if (dashboard) {
          try {
            if (st !== "Create") {
              const cfg: any = await dashboard.getConfig();
              setConfig(cfg);
              const dc = normalizeDataConditions(cfg?.dataConditions);
              initialTableId = dc?.tableId || initialTableId;
              initialNameField = cfg?.customConfig?.nameFieldId || "";
              initialLocField = cfg?.customConfig?.locationFieldId || "";
            }
          } catch (err) {
            console.warn("getConfig failed (likely Create state)", err);
          }
        }

        if (initialTableId) {
          setSelectedTableId(initialTableId);
          await loadFields(initialTableId, bitable);
        }
        if (initialNameField) setNameFieldId(initialNameField);
        if (initialLocField) setLocationFieldId(initialLocField);

        if (
          dashboard &&
          (st === "Create" || st === "Config") &&
          (dashboard as any)?.getPreviewData
        ) {
          const dc = normalizeDataConditions(
            config?.dataConditions ?? [{ tableId: initialTableId }]
          );
          if (dc) {
            const preview = await (dashboard as any).getPreviewData(dc as any);
            const mapped = mapDashboardData(preview?.data ?? preview);
            if (mapped.length) {
              updatePoints(mapped, { fallbackToMock: false });
            }
          }
        } else if (dashboard && (st === "View" || st === "FullScreen")) {
          try {
            const data: any = await dashboard.getData?.();
            const mapped = mapDashboardData((data as any)?.data ?? data);
            if (mapped.length) {
              updatePoints(mapped, { fallbackToMock: false });
            }
          } catch {
            // fall back to direct read when no data
          }
        }

        setSdkReady(true);
        setUsingMock(false);
        setStatus("已连接飞书多维表，选择字段后加载数据");
      } catch (err) {
        console.error(err);
        setStatus("未能加载飞书 SDK，使用示例数据");
        setUsingMock(true);
      }
    };

    bootstrap();
  }, []);

  const isReadyToQuery =
    Boolean(selectedTableId) && Boolean(nameFieldId) && Boolean(locationFieldId);

  const activePoints = useMemo(() => points, [points]);

  const loadFields = async (tableId: string, bitableInstance: any) => {
    try {
      const table = await bitableInstance.base.getTableById(tableId);
      const metas = await table.getFieldMetaList();
      const parsed = (metas || []).map((f: any) => ({
        id: f.id,
        name: f.name,
        type: f.type,
      }));
      setFieldOptions(parsed);
      if (parsed[0]) {
        setNameFieldId(parsed[0].id);
      }
      if (parsed[1]) {
        setLocationFieldId(parsed[1].id);
      }
    } catch (error) {
      console.error(error);
      setFieldOptions([]);
    }
  };

  const fetchRecords = async () => {
    if (!isReadyToQuery) {
      setStatus("请先选择表与字段");
      return;
    }
    setLoading(true);
    setStatus("正在从多维表读取数据…");
    try {
      const dash = dashboardRef.current;
      // Prefer dashboard-provided data in Create/Config (preview) and View (正式数据)
      if (dash) {
        if (
          typeof dash.getPreviewData === "function" &&
          (dashboardState === "Create" || dashboardState === "Config")
        ) {
          const dc = deriveDataConditions(config, selectedTableId);
          const preview: any = await dash.getPreviewData(dc as any);
          const mapped = mapDashboardData(preview?.data ?? preview);
          if (mapped.length) {
            updatePoints(mapped, { fallbackToMock: false });
            return;
          }
        }
        if (
          typeof dash.getData === "function" &&
          (dashboardState === "View" || dashboardState === "FullScreen")
        ) {
          const data: any = await dash.getData();
          const mapped = mapDashboardData((data as any)?.data ?? data);
          if (mapped.length) {
            updatePoints(mapped, { fallbackToMock: false });
            return;
          }
        }
      }

      if (!bitableRef.current) {
        setStatus("未找到 Bitable SDK，使用示例数据");
        setUsingMock(true);
        setPoints(mockPoints);
        return;
      }

      const bitable = bitableRef.current;
      const table = await bitable.base.getTableById(selectedTableId);
      const { records = [] } =
        (await table.getRecords({ pageSize: 5000 })) || {};
      const mapped: MapPoint[] = [];

      records.forEach((record: any, idx: number) => {
        const nameRaw = record?.fields?.[nameFieldId];
        const locRaw = record?.fields?.[locationFieldId];
        const coords = parseLocation(locRaw);
        if (!coords) {
          return;
        }
        mapped.push({
          id: record.recordId || String(idx),
          name: getCellText(nameRaw) || "未命名",
          lat: coords.lat,
          lng: coords.lng,
        });
      });

      updatePoints(mapped, { fallbackToMock: false });
    } catch (error) {
      console.error(error);
      setStatus("读取失败，已回退到示例数据");
      setUsingMock(true);
      setPoints(mockPoints);
    } finally {
      setLoading(false);
    }
  };

  const updatePoints = (
    mapped: MapPoint[],
    opts: { fallbackToMock?: boolean } = {}
  ) => {
    if (!mapped || !mapped.length) {
      setStatus("未解析到有效经纬度，请检查字段格式（如 31.2,121.5）");
      if (opts.fallbackToMock) {
        setPoints(mockPoints);
        setUsingMock(true);
      } else {
        setPoints([]);
        setUsingMock(false);
      }
      return;
    }
    setStatus(`已加载 ${mapped.length} 条位置`);
    setPoints(mapped);
    setUsingMock(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 via-white to-slate-50 px-6 py-10 text-slate-800">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-blue-600">
              Feishu Dashboard Widget
            </p>
            <h1 className="text-3xl font-semibold text-slate-900">
              多维表门店分布地图
            </h1>
            <p className="text-sm text-slate-500">
              选择名称字段 + 经纬度字段，自动在 Leaflet 地图上打点。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full px-3 py-1 text-sm font-medium ${
                sdkReady && !usingMock
                  ? "bg-blue-100 text-blue-700"
                  : "bg-slate-100 text-slate-600"
              }`}
            >
              {sdkReady && !usingMock ? "飞书多维表已连接" : "示例模式"}
            </span>
            <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
              Leaflet · 蓝色主题
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
              仪表盘状态：{dashboardState}
            </span>
          </div>
        </header>

        {dashboardState === "View" || dashboardState === "FullScreen" ? null : (
          <section className="grid grid-cols-1 gap-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100 md:grid-cols-3">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-slate-700">
                选择多维表
              </label>
              <select
              value={selectedTableId}
              onChange={async (e) => {
                const nextId = e.target.value;
                setSelectedTableId(nextId);
                setNameFieldId("");
                setLocationFieldId("");
                if (bitableRef.current && nextId) {
                  await loadFields(nextId, bitableRef.current);
                }
              }}
              className="h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-800 outline-none focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
            >
              <option value="">
                {sdkReady ? "请选择表" : "等待飞书环境 / 使用示例"}
              </option>
              {tableOptions.map((table) => (
                <option key={table.id} value={table.id}>
                  {table.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-semibold text-slate-700">
              名称字段（店名）
            </label>
            <select
              value={nameFieldId}
              onChange={(e) => setNameFieldId(e.target.value)}
              className="h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-800 outline-none focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
            >
              <option value="">请选择</option>
              {fieldOptions.map((field) => (
                <option key={field.id} value={field.id}>
                  {field.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-semibold text-slate-700">
              经纬度字段（单列，示例：31.2,121.5）
            </label>
            <select
              value={locationFieldId}
              onChange={(e) => setLocationFieldId(e.target.value)}
              className="h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-800 outline-none focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
            >
              <option value="">请选择</option>
              {fieldOptions.map((field) => (
                <option key={field.id} value={field.id}>
                  {field.name}
                </option>
              ))}
            </select>
          </div>

            <div className="flex items-center gap-3 md:col-span-3">
              <button
                onClick={fetchRecords}
                disabled={!isReadyToQuery || loading}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {loading ? "读取中…" : "从多维表加载"}
              </button>
              {dashboardRef.current?.saveConfig && (
                <button
                  onClick={async () => {
                    const dash = dashboardRef.current;
                    if (!dash) return;
                    const dc = deriveDataConditions(config, selectedTableId);
                    try {
                      await dash.saveConfig({
                        dataConditions: dc,
                        customConfig: {
                          nameFieldId,
                          locationFieldId,
                        },
                      });
                      setStatus("配置已保存");
                    } catch (e) {
                      console.error(e);
                      setStatus("配置保存失败");
                    }
                  }}
                  className="inline-flex items-center gap-2 rounded-xl border border-blue-200 px-4 py-2 text-sm font-semibold text-blue-700 transition hover:border-blue-300 hover:text-blue-800"
                >
                  保存配置
                </button>
              )}
              <button
                onClick={() => {
                  setPoints(mockPoints);
                  setUsingMock(true);
                  setStatus("已切换到示例数据");
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-blue-200 hover:text-blue-700"
            >
              使用示例数据
              </button>
              <p className="text-xs text-slate-500">
                经纬度支持字符串“lat,lng”或位置对象（包含 latitude / longitude）。
              </p>
            </div>
          </section>
        )}

        <section className="flex flex-col gap-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">门店地图</h2>
              <p className="text-xs text-slate-500">
                点亮地图后，点击图钉可查看店名与经纬度。
              </p>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
              {usingMock ? "示例数据" : "实时数据"}
            </span>
          </div>

          <LeafletMap points={activePoints} />

          <div className="flex items-center justify-between rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-800">
            <span className="font-medium">{status}</span>
            <span className="text-xs">
              未显示点？检查经纬度字段格式，或切换示例数据进行预览。
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}

function parseLocation(raw: unknown): { lat: number; lng: number } | null {
  if (!raw) return null;

  const normalize = (a: number, b: number) => {
    // 如果其中一个超出纬度范围，则自动判定为经度
    const isALng = Math.abs(a) > 90;
    const isBLng = Math.abs(b) > 90;
    if (isALng && !isBLng) return { lat: b, lng: a };
    if (isBLng && !isALng) return { lat: a, lng: b };
    return { lat: a, lng: b };
  };

  if (typeof raw === "string") {
    const parts = raw
      .split(/,|，|\s+/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => Number.parseFloat(p));
    if (parts.length >= 2 && parts.every((n) => Number.isFinite(n))) {
      return normalize(parts[0], parts[1]);
    }
  }

  if (Array.isArray(raw) && raw.length > 0) {
    // 有些字段会返回数组
    return parseLocation(raw[0]);
  }

  if (typeof raw === "object") {
    const obj = raw as any;
    if (
      Number.isFinite(obj?.latitude) &&
      Number.isFinite(obj?.longitude)
    ) {
      return { lat: obj.latitude, lng: obj.longitude };
    }
    if (Number.isFinite(obj?.lat) && Number.isFinite(obj?.lng)) {
      return { lat: obj.lat, lng: obj.lng };
    }
  }

  return null;
}

function getCellText(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "string" || typeof raw === "number") {
    return String(raw);
  }
  if (Array.isArray(raw)) {
    return raw
      .map((item) =>
        typeof item === "object" && item !== null && "text" in item
          ? (item as any).text
          : String(item)
      )
      .join(" / ");
  }
  if (typeof raw === "object" && "text" in (raw as any)) {
    return String((raw as any).text);
  }
  try {
    return JSON.stringify(raw);
  } catch {
    return "";
  }
}

function mapDashboardData(data: any): MapPoint[] {
  if (!data) return [];

  // IData: IDataItem[][] from dashboard getData / getPreviewData
  if (Array.isArray(data) && Array.isArray(data[0])) {
    const mapped: MapPoint[] = [];
    data.slice(1).forEach((row: any[], idx: number) => {
      const name = row?.[0]?.text ?? row?.[0]?.value ?? row?.[0];
      const loc = row?.[1]?.text ?? row?.[1]?.value ?? row?.[1];
      const coords = parseLocation(loc);
      if (!coords) return;
      mapped.push({
        id: String(idx),
        name: getCellText(name) || "未命名",
        lat: coords.lat,
        lng: coords.lng,
      });
    });
    return mapped;
  }

  if (Array.isArray(data)) {
    const mapped: MapPoint[] = [];
    data.forEach((row: any, idx: number) => {
      const name = row?.name || row?.title || row?.[0];
      const loc = row?.location || row?.loc || row?.[1];
      const coords = parseLocation(loc);
      if (!coords) return;
      mapped.push({
        id: row?.id || String(idx),
        name: getCellText(name) || "未命名",
        lat: coords.lat,
        lng: coords.lng,
      });
    });
    return mapped;
  }

  return [];
}

function deriveDataConditions(cfg: any, tableId: string) {
  if (cfg?.dataConditions) return cfg.dataConditions;
  if (tableId) return [{ tableId }];
  return undefined;
}

function normalizeDataConditions(dc: any): { tableId?: string } | undefined {
  if (!dc) return undefined;
  const first = Array.isArray(dc) ? dc[0] : dc;
  if (!first) return undefined;
  return { tableId: first.tableId };
}

async function bridgeReady(obj: any) {
  if (obj?.bridge?.ready) {
    try {
      await obj.bridge.ready();
    } catch {
      // ignore
    }
  }
}
