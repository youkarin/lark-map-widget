"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { base, bitable, dashboard } from "@lark-base-open/js-sdk";

type TableOption = { id: string; name: string };
type FieldOption = { id: string; name: string; type?: string };
type MapPoint = { id: string; name: string; lat: number; lng: number };
type DashboardState = "Create" | "Config" | "View" | "FullScreen" | "Unknown";
type ExclusionConfig = {
  fieldId: string;
  operator: ExclusionOperator;
  value?: string;
};
type ExclusionOperator =
  | "contains"
  | "notContains"
  | "equals"
  | "notEquals"
  | "isEmpty"
  | "notEmpty";
type MapResult = {
  points: MapPoint[];
  invalidSample?: any;
  total?: number;
  invalid?: number;
  excluded?: number;
};
const VERSION = "v0.0.16";

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
const DEFAULT_CENTER: [number, number] = [44.0, 12.0];
const CENTER_PRESETS = [
  { id: "italy", label: "意大利（默认）", center: { lat: 44.0, lng: 12.0 } },
  { id: "china", label: "中国（北京）", center: { lat: 39.9042, lng: 116.4074 } },
  { id: "shanghai", label: "上海", center: { lat: 31.2304, lng: 121.4737 } },
  { id: "shenzhen", label: "深圳", center: { lat: 22.543096, lng: 114.057865 } },
  { id: "hangzhou", label: "杭州", center: { lat: 30.2741, lng: 120.1551 } },
  { id: "custom", label: "自定义经纬度" },
];
const EXCLUSION_OPERATORS: { id: ExclusionOperator; label: string; requiresValue: boolean }[] =
  [
    { id: "contains", label: "包含", requiresValue: true },
    { id: "notContains", label: "不包含", requiresValue: true },
    { id: "equals", label: "等于", requiresValue: true },
    { id: "notEquals", label: "不等于", requiresValue: true },
    { id: "isEmpty", label: "为空", requiresValue: false },
    { id: "notEmpty", label: "不为空", requiresValue: false },
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
  const refreshTimer = useRef<NodeJS.Timeout | null>(null);
  const initialRefreshTimer = useRef<NodeJS.Timeout | null>(null);
  const exclusionRef = useRef<ExclusionConfig | undefined>(undefined);
  const [defaultCenter, setDefaultCenter] = useState<[number, number]>(DEFAULT_CENTER);
  const [centerPresetId, setCenterPresetId] = useState<string>(CENTER_PRESETS[0].id);
  const [customCenterInput, setCustomCenterInput] = useState<{ lat: string; lng: string }>({
    lat: "",
    lng: "",
  });
  const [excludeFieldId, setExcludeFieldId] = useState<string>("");
  const [excludeOperator, setExcludeOperator] = useState<ExclusionOperator>("contains");
  const [excludeValue, setExcludeValue] = useState<string>("");

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
          (dashboard as any).onStateChange(async (next: DashboardState) => {
            setDashboardState(next ?? "Unknown");
            if (next === "Config" || next === "Create") {
              setAutoFetched(false);
              if (next === "Config") {
                await renderFromConfig();
              }
            }
            if (next === "View" || next === "FullScreen") {
              await renderFromConfig();
            }
          });
        }

        if ((dashboard as any)?.onConfigChange) {
          (dashboard as any).onConfigChange(async (e: any) => {
            const nextCfg = e?.data;
            setConfig(nextCfg);
            await renderFromConfig();
          });
        }

        if ((dashboard as any)?.onDataChange) {
          (dashboard as any).onDataChange(async (e: any) => {
            const mapped = mapDashboardData(e?.data, exclusionRef.current);
            // 在展示态常会收到空聚合，这里仅在有有效点时更新
            if (mapped.points.length) {
              updatePoints(mapped.points, {
                clearOnEmpty: true,
                sampleRaw: mapped.invalidSample,
                total: mapped.total,
                invalid: mapped.invalid,
                excluded: mapped.excluded,
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
            const mapped = mapDashboardData(preview?.data ?? preview, exclusionRef.current);
            updatePoints(mapped.points, {
              fallbackToMock: false,
              clearOnEmpty: true,
              sampleRaw: mapped.invalidSample,
              total: mapped.total,
              invalid: mapped.invalid,
              excluded: mapped.excluded,
            });
          }
        }

        // 在展示态优先使用已保存配置直接读取多维表
        if (st === "View" || st === "FullScreen") {
          // 立即拉一次，确保切换/刷新后同步
          await renderFromConfig();
        } else if (
          initialTableId &&
          initialNameField &&
          initialLocField &&
          !autoFetched
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

    return () => {
      if (refreshTimer.current) {
        clearInterval(refreshTimer.current);
        refreshTimer.current = null;
      }
      if (initialRefreshTimer.current) {
        clearTimeout(initialRefreshTimer.current);
        initialRefreshTimer.current = null;
      }
    };
  }, []);

  const isReadyToQuery =
    Boolean(selectedTableId) && Boolean(nameFieldId) && Boolean(locationFieldId);

  const activePoints = useMemo(() => points, [points]);
  const isDashboardView =
    dashboardState === "View" || dashboardState === "FullScreen";
  const outerClass = isDashboardView
    ? "min-h-screen w-full bg-white"
    : "min-h-screen bg-gradient-to-b from-blue-50 via-white to-slate-50 px-6 py-10 text-slate-800";
  const wrapperClass = isDashboardView
    ? "mx-auto flex w-full flex-col gap-4"
    : "mx-auto flex w-full max-w-6xl flex-col gap-6";
  const exclusionOperatorMeta = useMemo(
    () => EXCLUSION_OPERATORS.find((item) => item.id === excludeOperator),
    [excludeOperator]
  );
  const exclusionNeedsValue = exclusionOperatorMeta?.requiresValue ?? false;
  const activeExclusion = useMemo(
    () => buildExclusionConfig(excludeFieldId, excludeOperator, excludeValue),
    [excludeFieldId, excludeOperator, excludeValue]
  );
  useEffect(() => {
    exclusionRef.current = activeExclusion;
  }, [activeExclusion]);

  // View/FullScreen 自动轮询最新数据
  useEffect(() => {
    if (dashboardState === "View" || dashboardState === "FullScreen") {
      const tableId = selectedTableId;
      const nameId = selectedNameField || nameFieldId;
      const locId = selectedLocField || locationFieldId;
      if (tableId && nameId && locId) {
        const doFetch = () =>
          fetchFromBitable(tableId, nameId, locId, { preserveOnEmpty: true });
        if (initialRefreshTimer.current) {
          clearTimeout(initialRefreshTimer.current);
          initialRefreshTimer.current = null;
        }
        if (refreshTimer.current) {
          clearInterval(refreshTimer.current);
          refreshTimer.current = null;
        }
        initialRefreshTimer.current = setTimeout(() => {
          doFetch();
          refreshTimer.current = setInterval(() => {
            doFetch();
          }, 30000); // 30s 轮询
        }, 5000); // 首次延迟 5s
      }
    } else {
      if (refreshTimer.current) {
        clearInterval(refreshTimer.current);
        refreshTimer.current = null;
      }
      if (initialRefreshTimer.current) {
        clearTimeout(initialRefreshTimer.current);
        initialRefreshTimer.current = null;
      }
    }
  }, [
    dashboardState,
    selectedTableId,
    selectedNameField,
    selectedLocField,
    nameFieldId,
    locationFieldId,
  ]);

  useEffect(() => {
    if (centerPresetId !== "custom") return;
    const latNum = Number.parseFloat(customCenterInput.lat);
    const lngNum = Number.parseFloat(customCenterInput.lng);
    if (Number.isFinite(latNum) && Number.isFinite(lngNum)) {
      const tuple: [number, number] = [latNum, lngNum];
      setDefaultCenter(tuple);
    }
  }, [centerPresetId, customCenterInput]);

  const resolveCenterToPersist = (): [number, number] => {
    if (centerPresetId !== "custom") {
      const preset = CENTER_PRESETS.find((p) => p.id === centerPresetId)?.center;
      if (preset) {
        return [preset.lat, preset.lng];
      }
      return defaultCenter;
    }
    const latNum = Number.parseFloat(customCenterInput.lat);
    const lngNum = Number.parseFloat(customCenterInput.lng);
    if (Number.isFinite(latNum) && Number.isFinite(lngNum)) {
      return [latNum, lngNum];
    }
    return defaultCenter;
  };

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
      if (!parsed.some((field: FieldOption) => field.id === excludeFieldId)) {
        setExcludeFieldId("");
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
          const mapped = mapDashboardData(preview?.data ?? preview, activeExclusion);
          updatePoints(mapped.points, {
            fallbackToMock: false,
            clearOnEmpty: true,
            sampleRaw: mapped.invalidSample,
            total: mapped.total,
            invalid: mapped.invalid,
            excluded: mapped.excluded,
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
    locId?: string,
    center?: [number, number],
    exclusionOverride?: ExclusionConfig | null
  ) => {
    const dash = dashboardRef.current;
    if (!dash?.saveConfig) return;
    try {
      const targetTable = tableId || selectedTableId;
      const dc = deriveDataConditions(config, targetTable);
      if (!dc) return;
      const centerToPersist = center ?? resolveCenterToPersist();
      const exclusionToPersist =
        exclusionOverride === undefined
          ? activeExclusion
          : exclusionOverride || undefined;
      await dash.saveConfig({
        dataConditions: dc,
        customConfig: {
          nameFieldId: nameId ?? nameFieldId,
          locationFieldId: locId ?? locationFieldId,
          defaultCenter: serializeCenter(centerToPersist),
          exclusion: exclusionToPersist,
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
      excluded?: number;
    } = {},
    preserveOnEmpty?: boolean
  ) => {
    if (!mapped || !mapped.length) {
      if (preserveOnEmpty) {
        return;
      }
      const extra =
        opts.sampleRaw !== undefined
          ? ` 示例原值: ${safeSample(opts.sampleRaw)}`
          : "";
      const statParts: string[] = [];
      if (opts.total !== undefined) {
        statParts.push(`总记录: ${opts.total}`);
      }
      if (opts.invalid !== undefined) {
        statParts.push(`无效: ${opts.invalid}`);
      }
      if (opts.excluded !== undefined) {
        statParts.push(`排除: ${opts.excluded}`);
      }
      const totalInfo = statParts.length ? ` | ${statParts.join(", ")}` : "";
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
    const statParts = [
      `总记录: ${totalVal}`,
      `无效: ${invalidVal}`,
    ];
    if (opts.excluded !== undefined) {
      statParts.push(`排除: ${opts.excluded}`);
    }
    setStatus(`已加载 ${mapped.length} 条位置 | ${statParts.join(", ")}`);
    setPoints(mapped);
    setUsingMock(false);
  };

  const fetchFromBitable = async (
    tableId?: string,
    nameField?: string,
    locationField?: string,
    opts: { preserveOnEmpty?: boolean; exclusion?: ExclusionConfig | null } = {}
  ) => {
    try {
      if (!tableId || !nameField || !locationField) {
        return;
      }
      const exclusion =
        opts.exclusion === undefined
          ? activeExclusion
          : opts.exclusion || undefined;
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
      let excludedCount = 0;

      records.forEach((record: any, idx: number) => {
        const nameRaw = record?.fields?.[nameField];
        const locRaw = record?.fields?.[locationField];
        const coords = parseLocation(locRaw);
        if (!coords) {
          if (invalidSample === undefined) invalidSample = locRaw;
          invalidCount += 1;
          return;
        }
        if (
          exclusion &&
          shouldExcludeValue(
            record?.fields?.[exclusion.fieldId],
            exclusion.operator,
            exclusion.value
          )
        ) {
          excludedCount += 1;
          return;
        }
        mapped.push({
          id: record.recordId || String(idx),
          name: getCellText(nameRaw) || "未命名",
          lat: coords.lat,
          lng: coords.lng,
        });
      });

      updatePoints(
        mapped,
        {
          fallbackToMock: false,
          clearOnEmpty: !opts.preserveOnEmpty,
          sampleRaw: invalidSample,
          total: records.length,
          invalid: invalidCount,
          excluded: exclusion ? excludedCount : undefined,
        },
        opts.preserveOnEmpty
      );
    } catch (error) {
      console.error(error);
      setStatus("读取失败，已回退到示例数据");
      setUsingMock(true);
      setPoints(mockPoints);
    }
  };

  const renderFromConfig = async () => {
    try {
      const dash = dashboardRef.current;
      const cfg: any = await dash?.getConfig?.();
      if (cfg) {
        setConfig(cfg);
      }
      const dc = normalizeDataConditions(cfg?.dataConditions);
      const tableId = dc?.tableId || selectedTableId;
      const nameId =
        cfg?.customConfig?.nameFieldId ||
        selectedNameField ||
        nameFieldId;
      const locId =
        cfg?.customConfig?.locationFieldId ||
        selectedLocField ||
        locationFieldId;
      const cfgCenter = parseCenterTuple(cfg?.customConfig?.defaultCenter);
      if (cfgCenter) {
        setDefaultCenter(cfgCenter);
        const preset = CENTER_PRESETS.find(
          (p) => p.center && isSameCenter([p.center.lat, p.center.lng], cfgCenter)
        );
        setCenterPresetId(preset?.id ?? "custom");
        if (!preset) {
          setCustomCenterInput({
            lat: cfgCenter[0].toString(),
            lng: cfgCenter[1].toString(),
          });
        } else {
          setCustomCenterInput({ lat: "", lng: "" });
        }
      } else {
        setDefaultCenter(DEFAULT_CENTER);
        setCenterPresetId(CENTER_PRESETS[0].id);
        setCustomCenterInput({ lat: "", lng: "" });
      }
      const savedExclusion = normalizeExclusionConfig(
        cfg?.customConfig?.exclusion
      );
      if (savedExclusion) {
        setExcludeFieldId(savedExclusion.fieldId);
        setExcludeOperator(savedExclusion.operator);
        setExcludeValue(savedExclusion.value ?? "");
      } else {
        setExcludeFieldId("");
        setExcludeOperator("contains");
        setExcludeValue("");
      }

      if (tableId) {
        setSelectedTableId(tableId);
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

      if (tableId && nameId && locId) {
        await fetchFromBitable(tableId, nameId, locId, {
          exclusion: savedExclusion ?? null,
        });
        setAutoFetched(true);
      }
    } catch (err) {
      console.warn("renderFromConfig failed", err);
    }
  };

  return (
    <div className={outerClass}>
      <div className={wrapperClass}>
        {isDashboardView ? null : (
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
        )}

        {/* 配置面板在仪表盘 View/FullScreen 隐藏 */}
        {isDashboardView ? null : (
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
                  setExcludeFieldId("");
                  setExcludeOperator("contains");
                  setExcludeValue("");
                  if (bitableRef.current && nextId) {
                    await loadFields(nextId, bitableRef.current);
                  }
                  await autoSaveConfig(nextId, "", "", undefined, null);
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
                名称字段
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

            <div className="flex flex-col gap-2 md:col-span-1">
              <label className="text-sm font-semibold text-slate-700">
                默认地图中心
              </label>
              <select
                value={centerPresetId}
                onChange={(e) => {
                  const nextId = e.target.value;
                  setCenterPresetId(nextId);
                  const preset = CENTER_PRESETS.find((p) => p.id === nextId);
                  if (preset?.center) {
                    const tuple: [number, number] = [
                      preset.center.lat,
                      preset.center.lng,
                    ];
                    setDefaultCenter(tuple);
                    setCustomCenterInput({
                      lat: preset.center.lat.toString(),
                      lng: preset.center.lng.toString(),
                    });
                  } else if (nextId === "custom") {
                    setCustomCenterInput({
                      lat: defaultCenter[0].toString(),
                      lng: defaultCenter[1].toString(),
                    });
                  }
                }}
                className="h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-800 outline-none focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
              >
                {CENTER_PRESETS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-500">
                点位为空时将使用此经纬度作为地图中心。
              </p>
              {centerPresetId === "custom" ? (
                <div className="flex flex-col gap-2">
                  <input
                    value={customCenterInput.lat}
                    onChange={(e) =>
                      setCustomCenterInput((prev) => ({
                        ...prev,
                        lat: e.target.value,
                      }))
                    }
                    placeholder="纬度（Lat）示例：31.2304"
                    className="h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-800 outline-none focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
                    inputMode="decimal"
                  />
                  <input
                    value={customCenterInput.lng}
                    onChange={(e) =>
                      setCustomCenterInput((prev) => ({
                        ...prev,
                        lng: e.target.value,
                      }))
                    }
                    placeholder="经度（Lng）示例：121.4737"
                    className="h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-800 outline-none focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
                    inputMode="decimal"
                  />
                  <p className="text-xs text-slate-500">
                    输入十进制经纬度，系统会在没有点位时使用该位置。
                  </p>
                </div>
              ) : null}
            </div>

            <div className="flex flex-col gap-2 md:col-span-3">
              <label className="text-sm font-semibold text-slate-700">
                排除规则（可选）
              </label>
              <div className="grid gap-3 md:grid-cols-3">
                <select
                  value={excludeFieldId}
                  onChange={(e) => {
                    const next = e.target.value;
                    setExcludeFieldId(next);
                    setAutoFetched(false);
                    if (!next) {
                      setExcludeOperator("contains");
                      setExcludeValue("");
                    }
                  }}
                  className="h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-800 outline-none focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
                >
                  <option value="">不使用排除字段</option>
                  {fieldOptions.map((field) => (
                    <option key={field.id} value={field.id}>
                      {field.name}
                    </option>
                  ))}
                </select>
                <select
                  value={excludeOperator}
                  onChange={(e) => {
                    const next = e.target.value as ExclusionOperator;
                    setExcludeOperator(next);
                    setAutoFetched(false);
                    if (!EXCLUSION_OPERATORS.find((item) => item.id === next)?.requiresValue) {
                      setExcludeValue("");
                    }
                  }}
                  className="h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-800 outline-none focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
                  disabled={!excludeFieldId}
                >
                  {EXCLUSION_OPERATORS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <input
                  value={excludeValue}
                  onChange={(e) => {
                    setExcludeValue(e.target.value);
                    setAutoFetched(false);
                  }}
                  placeholder="输入对比文本"
                  disabled={
                    !excludeFieldId || !exclusionNeedsValue
                  }
                  className="h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-800 outline-none focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100"
                />
              </div>
              <p className="text-xs text-slate-500">
                选择一个字段并设置条件（包含 / 不包含 / 等于 / 为空等），满足条件的记录将从地图点位中剔除。
              </p>
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
                    const centerToPersist = resolveCenterToPersist();
                    const exclusionToPersist = buildExclusionConfig(
                      excludeFieldId,
                      excludeOperator,
                      excludeValue
                    );
                    try {
                      await dash.saveConfig({
                        dataConditions: dc,
                        customConfig: {
                          nameFieldId,
                          locationFieldId,
                          defaultCenter: serializeCenter(centerToPersist),
                          exclusion: exclusionToPersist,
                        },
                      });
                      setDefaultCenter(centerToPersist);
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
          {isDashboardView ? null : (
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
          )}

          <LeafletMap
            points={activePoints}
            compact={isDashboardView}
            fallbackCenter={defaultCenter}
          />

          {isDashboardView ? null : (
            <div className="flex items-center justify-between rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-800">
              <span className="font-medium">{status}</span>
              <span className="text-xs">
                未显示点？检查经纬度字段格式，或切换示例数据进行预览。
              </span>
            </div>
          )}
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

function shouldExcludeValue(
  raw: unknown,
  operator: ExclusionOperator,
  compare?: string
): boolean {
  const text = getCellText(raw).trim();
  const normalizedSource = text.toLowerCase();
  const target = (compare ?? "").trim();
  const normalizedTarget = target.toLowerCase();
  switch (operator) {
    case "contains":
      return target ? normalizedSource.includes(normalizedTarget) : false;
    case "notContains":
      return target ? !normalizedSource.includes(normalizedTarget) : false;
    case "equals":
      return target ? normalizedSource === normalizedTarget : false;
    case "notEquals":
      return target ? normalizedSource !== normalizedTarget : false;
    case "isEmpty":
      return text.length === 0;
    case "notEmpty":
      return text.length > 0;
    default:
      return false;
  }
}

function tryGetExclusionFieldFromRow(row: any, fieldId: string): {
  found: boolean;
  value?: unknown;
} {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return { found: false };
  }
  if (
    row.fields &&
    typeof row.fields === "object" &&
    fieldId in row.fields
  ) {
    return { found: true, value: row.fields[fieldId] };
  }
  if (fieldId in row) {
    return { found: true, value: (row as any)[fieldId] };
  }
  return { found: false };
}

function mapDashboardData(data: any, exclusion?: ExclusionConfig): MapResult {
  if (!data) return { points: [] };

  // IData: IDataItem[][] from dashboard getData / getPreviewData
  if (Array.isArray(data) && Array.isArray(data[0])) {
    const mapped: MapPoint[] = [];
    let invalidSample: any = undefined;
    let invalidCount = 0;
     let excludedCount = 0;
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
      if (exclusion) {
        const candidate = tryGetExclusionFieldFromRow(row, exclusion.fieldId);
        if (
          candidate.found &&
          shouldExcludeValue(candidate.value, exclusion.operator, exclusion.value)
        ) {
          excludedCount += 1;
          return;
        }
      }
      mapped.push({
        id: String(idx),
        name: getCellText(name) || "未命名",
        lat: coords.lat,
        lng: coords.lng,
      });
    });
    return {
      points: mapped,
      invalidSample,
      total,
      invalid: invalidCount,
      excluded: exclusion ? excludedCount : undefined,
    };
  }

  if (Array.isArray(data)) {
    const mapped: MapPoint[] = [];
    let invalidSample: any = undefined;
    let invalidCount = 0;
    let excludedCount = 0;
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
      if (exclusion) {
        const candidate = tryGetExclusionFieldFromRow(row, exclusion.fieldId);
        if (
          candidate.found &&
          shouldExcludeValue(candidate.value, exclusion.operator, exclusion.value)
        ) {
          excludedCount += 1;
          return;
        }
      }
      mapped.push({
        id: row?.id || String(idx),
        name: getCellText(name) || "未命名",
        lat: coords.lat,
        lng: coords.lng,
      });
    });
    return {
      points: mapped,
      invalidSample,
      total,
      invalid: invalidCount,
      excluded: exclusion ? excludedCount : undefined,
    };
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

function serializeCenter(center: [number, number]) {
  return { lat: center[0], lng: center[1] };
}

function parseCenterTuple(raw: any): [number, number] | null {
  if (!raw) return null;
  const lat =
    typeof raw.lat === "number"
      ? raw.lat
      : typeof raw.latitude === "number"
        ? raw.latitude
        : undefined;
  const lng =
    typeof raw.lng === "number"
      ? raw.lng
      : typeof raw.longitude === "number"
        ? raw.longitude
        : undefined;
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return [lat as number, lng as number];
  }
  return null;
}

function isSameCenter(a: [number, number], b: [number, number]) {
  return Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
}

function operatorRequiresValue(operator: ExclusionOperator) {
  return EXCLUSION_OPERATORS.some(
    (item) => item.id === operator && item.requiresValue
  );
}

function isValidExclusionOperator(value: any): value is ExclusionOperator {
  return EXCLUSION_OPERATORS.some((item) => item.id === value);
}

function buildExclusionConfig(
  fieldId: string,
  operator: ExclusionOperator,
  value: string
): ExclusionConfig | undefined {
  if (!fieldId || !isValidExclusionOperator(operator)) return undefined;
  if (operatorRequiresValue(operator)) {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    return { fieldId, operator, value: trimmed };
  }
  return { fieldId, operator };
}

function normalizeExclusionConfig(raw: any): ExclusionConfig | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const fieldId = raw.fieldId;
  const operator = raw.operator;
  if (typeof fieldId !== "string" || !isValidExclusionOperator(operator)) {
    return undefined;
  }
  if (operatorRequiresValue(operator)) {
    if (typeof raw.value !== "string" || !raw.value.trim()) {
      return undefined;
    }
    return { fieldId, operator, value: raw.value.trim() };
  }
  return { fieldId, operator };
}
