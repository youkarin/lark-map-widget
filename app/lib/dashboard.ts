/**
 * Lightweight helper to interact with Feishu Dashboard plugin runtime.
 * Supports state detection (Create/Config/View/FullScreen) and optional data hooks.
 */
export type DashboardState = "Create" | "Config" | "View" | "FullScreen" | "Unknown";

export async function loadDashboard() {
  if (typeof window === "undefined") return null;
  const w = window as any;
  if (w.dashboard) return w.dashboard;
  if (w.lark?.dashboard) return w.lark.dashboard;
  return null;
}

export async function getDashboardState(dashboard: any): Promise<DashboardState> {
  try {
    if (typeof dashboard?.getState === "function") {
      const state = await dashboard.getState();
      return (state as DashboardState) ?? "Unknown";
    }
    if (dashboard?.state) return dashboard.state as DashboardState;
  } catch (err) {
    console.warn("dashboard getState failed", err);
  }
  return "Unknown";
}
