"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { base, bitable, dashboard } from "@lark-base-open/js-sdk";

type TableOption = { id: string; name: string };
type FieldOption = { id: string; name: string; type?: string };
type MapPoint = { id: string; name: string; lat: number; lng: number };
type DashboardState = "Create" | "Config" | "View" | "FullScreen" | "Unknown";
type MapResult = {
  points: MapPoint[];
  invalidSample?: any;
  total?: number;
  invalid?: number;
};
const VERSION = "v0.0.12";

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
  const [points, setPoints] = useState<MapPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [usingMock, setUsingMock] = useState(true);
  const bitableRef = useRef<any | null>(null);
  const dashboardRef = useRef<typeof dashboard | null>(null);
  const [dashboardState, setDashboardState] = useState<DashboardState>("Unknown");
  const [config, setConfig] = useState<any | null>(null);
  const [autoFetched, setAutoFetched] = useState(false);
  const [selectedNameField, setSelectedNameField] = useState<string>("");
  const [selectedLocField, setSelectedLocField] = useState<string>("");

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
            if (
              (next === "View" || next === "FullScreen") &&
              selectedTableId &&
              (selectedNameField || nameFieldId) &&
              (selectedLocField || locationFieldId)
            ) {
              const nameId = selectedNameField || nameFieldId;
              const locId = selectedLocField || locationFieldId;
              if (nameId && locId) {
                fetchFromBitable(selectedTableId, nameId, locId);
              }
            }
            if (next === "Config" || next === "Create") {
              setAutoFetched(false);
            }
          });
        }

        if ((dashboard as any)?.onConfigChange) {
          (dashboard as any).onConfigChange(async (e: any) => {
            const nextCfg = e?.data;
            setConfig(nextCfg);
            const dc = normalizeDataConditions(nextCfg?.dataConditions);
            const tableId = dc?.tableId || selectedTableId;
            const nameId =
              nextCfg?.customConfig?.nameFieldId || selectedNameField;
            const locId =
              nextCfg?.customConfig?.locationFieldId || selectedLocField;

            if (tableId) {
              setSelectedTableId(tableId);
              setAutoFetched(false);
              if (bitableRef.current) {
                await loadFields(tableId, bitableRef.current);
              }
            }
            if (nameId) {
              setNameFieldId(nameId);
              setSelectedNameField(nameId);
            }
            if (locId) {
              setLocationFieldId(locId);
              setSelectedLocField(locId);
            }

            if (
              (dashboardState === "View" || dashboardState === "FullScreen") &&
              tableId &&
              nameId &&
              locId
            ) {
              await fetchFromBitable(tableId, nameId, locId);
              setAutoFetched(true);
            }
          });
        }

        if ((dashboard as any)?.onDataChange) {
          (dashboard as any).onDataChange(async (e: any) => {
            const mapped = mapDashboardData(e?.data);
            // 在展示态常会收到空聚合，这里仅在有有效点时更新
            if (mapped.points.length) {
              updatePoints(mapped.points, {
                clearOnEmpty: true,
                sampleRaw: mapped.invalidSample,
                total: mapped.total,
                invalid: mapped.invalid,
              });
            }
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
        if (initialNameField) {
          setNameFieldId(initialNameField);
          setSelectedNameField(initialNameField);
        }
        if (initialLocField) {
          setLocationFieldId(initialLocField);
          setSelectedLocField(initialLocField);
        }

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
            updatePoints(mapped.points, {
              fallbackToMock: false,
              clearOnEmpty: true,
              sampleRaw: mapped.invalidSample,
              total: mapped.total,
              invalid: mapped.invalid,
            });
          }
        }

        // 在展示态优先直接读取多维表，避免 getData 聚合带来的格式问题
        if (
          (st === "View" || st === "FullScreen") &&
          initialTableId &&
          initialNameField &&
          initialLocField
        ) {
          await fetchFromBitable(
            initialTableId,
            initialNameField,
            initialLocField
          );
          setAutoFetched(true);
        }

        setSdkReady(true);
        setUsingMock(false);
        if (!points.length) {
          setPoints([]);
        }
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
      // Prefer dashboard-provided data in Create/Config (preview only)
      if (dash) {
        if (
          typeof dash.getPreviewData === "function" &&
          (dashboardState === "Create" || dashboardState === "Config")
        ) {
          const dc = deriveDataConditions(config, selectedTableId);
          const preview: any = await dash.getPreviewData(dc as any);
          const mapped = mapDashboardData(preview?.data ?? preview);
          updatePoints(mapped.points, {
            fallbackToMock: false,
            clearOnEmpty: true,
            sampleRaw: mapped.invalidSample,
            total: mapped.total,
            invalid: mapped.invalid,
          });
          if (mapped.points.length) {
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

      await fetchFromBitable(
        selectedTableId,
        nameFieldId,
        locationFieldId
      );
      // 只在展示态自动保存配置，避免配置态弹回
      if (dashboardState === "View" || dashboardState === "FullScreen") {
        await autoSaveConfig(selectedTableId, nameFieldId, locationFieldId);
      }
    } catch (error) {
      console.error(error);
      setStatus("读取失败，已回退到示例数据");
      setUsingMock(true);
      setPoints(mockPoints);
    } finally {
      setLoading(false);
    }
  };

  const autoSaveConfig = async (
    tableId?: string,
    nameId?: string,
    locId?: string
  ) => {
    const dash = dashboardRef.current;
    if (!dash?.saveConfig) return;
    try {
      const targetTable = tableId || selectedTableId;
      const dc = deriveDataConditions(config, targetTable);
      if (!dc) return;
      await dash.saveConfig({
        dataConditions: dc,
        customConfig: {
          nameFieldId: nameId ?? nameFieldId,
          locationFieldId: locId ?? locationFieldId,
        },
      });
    } catch (err) {
      console.warn("saveConfig failed", err);
    }
  };

  const updatePoints = (
    mapped: MapPoint[],
    opts: {
      fallbackToMock?: boolean;
      clearOnEmpty?: boolean;
      sampleRaw?: any;
      total?: number;
      invalid?: number;
    } = {}
  ) => {
    if (!mapped || !mapped.length) {
      const extra =
        opts.sampleRaw !== undefined
          ? ` 示例原值: ${safeSample(opts.sampleRaw)}`
          : "";
      const totalInfo =
        opts.total !== undefined || opts.invalid !== undefined
          ? ` | 总记录: ${opts.total ?? 0}, 无效: ${opts.invalid ?? 0}`
          : "";
      setStatus(
        `未解析到有效经纬度，请检查字段格式（如 31.2,121.5）。${extra}${totalInfo}`
      );
      if (opts.fallbackToMock) {
        setPoints(mockPoints);
        setUsingMock(true);
      } else if (opts.clearOnEmpty) {
        setPoints([]);
        setUsingMock(false);
      }
      return;
    }
    const totalVal = opts.total ?? mapped.length;
    const invalidVal = opts.invalid ?? 0;
    const totalInfo = ` | 总记录: ${totalVal}, 无效: ${invalidVal}`;
    setStatus(`已加载 ${mapped.length} 条位置${totalInfo}`);
    setPoints(mapped);
    setUsingMock(false);
  };

  const fetchFromBitable = async (
    tableId: string,
    nameField: string,
    locationField: string
  ) => {
    try {
      const b = bitableRef.current || bitable;
      const table =
        (b as any)?.base?.getTableById
          ? await (b as any).base.getTableById(tableId)
          : await base.getTableById(tableId);
      const { records = [] } =
        (await table.getRecords({ pageSize: 5000 })) || {};
      const mapped: MapPoint[] = [];
      let invalidSample: any = undefined;
      let invalidCount = 0;

      records.forEach((record: any, idx: number) => {
        const nameRaw = record?.fields?.[nameField];
        const locRaw = record?.fields?.[locationField];
        const coords = parseLocation(locRaw);
        if (!coords) {
          if (invalidSample === undefined) invalidSample = locRaw;
          invalidCount += 1;
          return;
        }
        mapped.push({
          id: record.recordId || String(idx),
          name: getCellText(nameRaw) || "未命名",
          lat: coords.lat,
          lng: coords.lng,
        });
      });

      updatePoints(mapped, {
        fallbackToMock: false,
        clearOnEmpty: true,
        sampleRaw: invalidSample,
        total: records.length,
        invalid: invalidCount,
      });
    } catch (error) {
      console.error(error);
      setStatus("读取失败，已回退到示例数据");
      setUsingMock(true);
      setPoints(mockPoints);
    }
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
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
              版本：{VERSION}
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
                  setAutoFetched(false);
                  setNameFieldId("");
                  setLocationFieldId("");
                  setSelectedNameField("");
                  setSelectedLocField("");
                  if (bitableRef.current && nextId) {
                    await loadFields(nextId, bitableRef.current);
                  }
                  await autoSaveConfig(nextId, "", "");
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
              onChange={async (e) => {
                  const next = e.target.value;
                  setNameFieldId(next);
                  setSelectedNameField(next);
                  setAutoFetched(false);
                  await autoSaveConfig(selectedTableId, next, selectedLocField);
              }}
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
              onChange={async (e) => {
                  const next = e.target.value;
                  setLocationFieldId(next);
                  setSelectedLocField(next);
                  setAutoFetched(false);
                  await autoSaveConfig(selectedTableId, selectedNameField, next);
              }}
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
    // 有些字段会返回数组，可能是富文本片段
    const first = raw[0];
    if (typeof first === "object" && first !== null) {
      if ("text" in first && typeof (first as any).text === "string") {
        return parseLocation((first as any).text);
      }
      if ("value" in first && typeof (first as any).value === "string") {
        return parseLocation((first as any).value);
      }
    }
    return parseLocation(first);
  }

  if (typeof raw === "object") {
    const obj = raw as any;
    if (typeof obj?.text === "string") {
      return parseLocation(obj.text);
    }
    if (typeof obj?.value === "string") {
      return parseLocation(obj.value);
    }
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

function mapDashboardData(data: any): MapResult {
  if (!data) return { points: [] };

  // IData: IDataItem[][] from dashboard getData / getPreviewData
  if (Array.isArray(data) && Array.isArray(data[0])) {
    const mapped: MapPoint[] = [];
    let invalidSample: any = undefined;
    let invalidCount = 0;
    const total = Math.max(0, (data?.length || 1) - 1);
    data.slice(1).forEach((row: any[], idx: number) => {
      const name = row?.[0]?.text ?? row?.[0]?.value ?? row?.[0];
      const loc = row?.[1]?.text ?? row?.[1]?.value ?? row?.[1];
      const coords = parseLocation(loc);
      if (!coords) {
        if (invalidSample === undefined) invalidSample = loc;
        invalidCount += 1;
        return;
      }
      mapped.push({
        id: String(idx),
        name: getCellText(name) || "未命名",
        lat: coords.lat,
        lng: coords.lng,
      });
    });
    return { points: mapped, invalidSample, total, invalid: invalidCount };
  }

  if (Array.isArray(data)) {
    const mapped: MapPoint[] = [];
    let invalidSample: any = undefined;
    let invalidCount = 0;
    const total = data.length;
    data.forEach((row: any, idx: number) => {
      const name = row?.name || row?.title || row?.[0];
      const loc = row?.location || row?.loc || row?.[1];
      const coords = parseLocation(loc);
      if (!coords) {
        if (invalidSample === undefined) invalidSample = loc;
        invalidCount += 1;
        return;
      }
      mapped.push({
        id: row?.id || String(idx),
        name: getCellText(name) || "未命名",
        lat: coords.lat,
        lng: coords.lng,
      });
    });
    return { points: mapped, invalidSample, total, invalid: invalidCount };
  }

  return { points: [] };
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

function safeSample(raw: any) {
  try {
    if (typeof raw === "string" || typeof raw === "number") return String(raw);
    return JSON.stringify(raw);
  } catch {
    return String(raw);
  }
}
