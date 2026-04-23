import type {
  AccountAverages,
  AiInsights,
  CalendarPostApi,
  Comment,
  CsvImportResult,
  FormatPerformance,
  GrowthRecord,
  HQGlance,
  HeatmapSlot,
  Headline,
  Overview,
  Post,
  PostAnalysis,
  ReachRecord,
  LastReel,
  ReachSources,
  SortKey,
  ThisWeek,
  TrackerMetrics,
  WeeklyPlan,
} from "@/types";

const BASE_URL = import.meta.env.VITE_API_BASE_URL as string;

function getAuthHeader(): string {
  const stored = sessionStorage.getItem("demo_auth");
  return stored ? `Basic ${stored}` : "";
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: getAuthHeader(),
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (res.status === 401) {
    sessionStorage.removeItem("demo_auth");
    window.location.reload();
    throw new Error("Unauthorized");
  }

  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${path}`);
  }

  return res.json() as Promise<T>;
}

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

export function setCredentials(username: string, password: string): void {
  const encoded = btoa(`${username}:${password}`);
  sessionStorage.setItem("demo_auth", encoded);
  sessionStorage.setItem("demo_auth_ts", String(Date.now()));
}

export function hasCredentials(): boolean {
  const token = sessionStorage.getItem("demo_auth");
  const ts    = sessionStorage.getItem("demo_auth_ts");
  if (!token || !ts) return false;
  if (Date.now() - Number(ts) > SESSION_TTL_MS) {
    sessionStorage.removeItem("demo_auth");
    sessionStorage.removeItem("demo_auth_ts");
    return false;
  }
  return true;
}

export function clearCredentials(): void {
  sessionStorage.removeItem("demo_auth");
  sessionStorage.removeItem("demo_auth_ts");
}

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/health`);
    return res.ok;
  } catch {
    return false;
  }
}

export const getOverview = (): Promise<Overview> =>
  apiFetch<Overview>("/api/instagram/overview");

export const getGrowth = (): Promise<GrowthRecord[]> =>
  apiFetch<GrowthRecord[]>("/api/instagram/growth");

export const getPosts = (sortBy: SortKey = "date"): Promise<Post[]> =>
  apiFetch<Post[]>(`/api/instagram/posts?sort_by=${sortBy}`);

export const getReachChart = (): Promise<ReachRecord[]> =>
  apiFetch<ReachRecord[]>("/api/instagram/reach-chart");

export const getReachSources = (): Promise<ReachSources> =>
  apiFetch<ReachSources>("/api/instagram/reach-sources");

export const getThisWeek = (): Promise<ThisWeek> =>
  apiFetch<ThisWeek>("/api/instagram/this-week");

export const getLastReel = (): Promise<LastReel> =>
  apiFetch<LastReel>("/api/instagram/last-reel");

export const getPostingHeatmap = (): Promise<HeatmapSlot[]> =>
  apiFetch<HeatmapSlot[]>("/api/instagram/posting-heatmap");

export const getDailySpark = (): Promise<{ message: string; date: string }> =>
  apiFetch<{ message: string; date: string }>("/api/spark/daily");

export const getInsights = (): Promise<AiInsights> =>
  apiFetch<AiInsights>("/api/insights/latest");

export const generateInsights = (): Promise<AiInsights> =>
  apiFetch<AiInsights>("/api/insights/generate", { method: "POST" });

export async function getFormatPerformance(): Promise<FormatPerformance[]> {
  const res = await apiFetch("/api/insights/format-performance");
  return res as FormatPerformance[];
}

export const getHeadlines = (): Promise<Headline[]> =>
  apiFetch<Headline[]>("/api/headlines");

export const getComments = (): Promise<Comment[]> =>
  apiFetch<Comment[]>("/api/instagram/comments");

export const getHQGlance = (): Promise<HQGlance> =>
  apiFetch<HQGlance>("/api/insights/hq-glance");

export const refreshHQGlance = (): Promise<HQGlance> =>
  apiFetch<HQGlance>("/api/insights/hq-glance/refresh", { method: "POST" });

export const forceRefresh = (): Promise<{ status: string; refreshed_at: string; posts_count: number }> =>
  apiFetch("/api/refresh", { method: "POST" });

export const getActionBoard = (): Promise<WeeklyPlan> =>
  apiFetch<WeeklyPlan>("/api/action-board");

export const forceGenerateActionBoard = (): Promise<WeeklyPlan> =>
  apiFetch<WeeklyPlan>("/api/action-board/generate", { method: "POST" });

export const getCalendarPosts = (): Promise<CalendarPostApi[]> =>
  apiFetch<CalendarPostApi[]>("/api/calendar");

export const createCalendarPost = (
  body: Omit<CalendarPostApi, "id" | "created_at" | "updated_at">
): Promise<CalendarPostApi> =>
  apiFetch<CalendarPostApi>("/api/calendar", { method: "POST", body: JSON.stringify(body) });

export const updateCalendarPost = (
  id: number,
  body: Partial<Omit<CalendarPostApi, "id" | "created_at" | "updated_at">>
): Promise<CalendarPostApi> =>
  apiFetch<CalendarPostApi>(`/api/calendar/${id}`, { method: "PUT", body: JSON.stringify(body) });

export const deleteCalendarPost = (id: number): Promise<void> =>
  apiFetch<void>(`/api/calendar/${id}`, { method: "DELETE" });

export interface PostDetails {
  opening_script: string;
  products_to_mention: string[];
  hashtags: string[];
  recommended_duration: string;
}

export const generateCalendarDetails = (body: {
  post_idea: string;
  hook: string;
  content_angle: string;
}): Promise<PostDetails> =>
  apiFetch<PostDetails>("/api/calendar/generate-details", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const getTrackerMetrics = (): Promise<TrackerMetrics> =>
  apiFetch<TrackerMetrics>("/api/tracker/metrics");

export const analyzePost = (body: {
  metrics: Record<string, number | string>;
  averages: AccountAverages;
}): Promise<PostAnalysis> =>
  apiFetch<PostAnalysis>("/api/posts/analyze", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const savePostAnalysis = (post_id: string, analysis: string, is_final: boolean): Promise<void> =>
  apiFetch<void>(`/api/posts/${encodeURIComponent(post_id)}/ai-analysis`, {
    method: "PATCH",
    body: JSON.stringify({ analysis, is_final }),
  });

export async function importCsv(file: File): Promise<CsvImportResult> {
  const formData = new FormData();
  formData.append("file", file);
  // Do NOT set Content-Type — browser must set it with the multipart boundary
  const res = await fetch(`${BASE_URL}/api/admin/import-csv`, {
    method: "POST",
    headers: { Authorization: getAuthHeader() },
    body: formData,
  });
  if (res.status === 401) {
    sessionStorage.removeItem("demo_auth");
    window.location.reload();
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => res.status.toString());
    throw new Error(`CSV import failed: ${detail}`);
  }
  return res.json() as Promise<CsvImportResult>;
}
