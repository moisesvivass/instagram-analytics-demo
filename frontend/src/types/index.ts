export interface Overview {
  followers: number;
  reach_28d: number;
  profile_views: number;
  accounts_engaged: number;
  interactions: number;
  last_refreshed: string;
  // Growth metrics
  ytd_start_followers?: number;
  monthly_pace?: number;
  // Week-over-week deltas (null = no data available)
  followers_delta_pct?: number | null;
  reach_28d_delta_pct?: number | null;
  profile_views_delta_pct?: number | null;
  accounts_engaged_delta_pct?: number | null;
  interactions_delta_pct?: number | null;
}

export interface GrowthRecord {
  date: string;
  followers: number;
}

export interface ReachRecord {
  date: string;
  reach: number;
}

export type MediaType = "REEL" | "CAROUSEL_ALBUM" | "IMAGE";

export interface Post {
  post_id: string;
  caption: string;
  media_type: MediaType;
  timestamp: string;
  like_count: number;
  comments_count: number;
  reach: number;
  saved: number;
  shares: number;
  engagement_rate: number;
  thumbnail_url: string;
  comments: string[];
  perf_score?: number;
  perf_label?: "winner" | "promising" | "underperformer" | "neutral";
  // Optional — not yet returned by API, show "—" when absent
  views?: number;
  impressions?: number;
  // Cached Claude analysis state
  // null/undefined = not yet generated; false = early (24-72h); true = final (72h+)
  ai_analysis?: string | null;
  analysis_is_final?: boolean | null;
}

export interface AccountAverages {
  avg_reach: number;
  avg_saves: number;
  avg_shares: number;
  avg_likes: number;
  avg_comments: number;
  avg_er: number;
}

export interface PostAnalysis {
  analysis: string;
  source: "mock" | "real" | "age_check";
}

export interface Comment {
  comment_id: string;
  username: string;
  text: string;
  timestamp: string;
  post_id: string;
  post_caption: string;
  like_count: number;
}

export interface InsightItem {
  title: string;
  insight: string;
  next_step?: string;
}

export interface FormatPerformance {
  media_type: string;
  label: string;
  post_count: number;
  avg_saves: number;
  avg_shares: number;
  avg_reach: number;
}

export interface AiInsights {
  what_working: InsightItem[] | string;
  what_flopping: InsightItem[] | string;
  briefing: string;
  action_board: string[];
  generated_at: string;
  source: "mock" | "real";
  calls_used?: number;
  calls_max?: number;
}

export interface Headline {
  title: string;
  source: string;
  summary: string;
  url: string;
  fetched_at: string;
}

export type SortKey = "date" | "reach" | "performance";

export interface PinnedComment {
  id: string;
  comment_id: string;
  username: string;
  text: string;
  post_caption: string;
  pinned_at: string;
}

export interface HQGlance {
  top_post: string;
  follower_growth: string;
  top_signal: string;
  priority_action: string;
  generated_at: string;
}

export interface CsvImportResult {
  imported: number;
  skipped: number;
  total_rows: number;
}

export interface ActionBoardTargetMetrics {
  saves: number;
  shares: number;
  reach_multiplier: number;
}

export type FormatType = "A" | "B" | "C" | "D" | "FLEX";
export type RetailerAnchor = "Sephora Canada" | "Shoppers Drug Mart" | "Both" | "None";

export interface ActionBoardPost {
  post_number: number;
  day: string;
  time: string;
  format_type?: FormatType;
  format: string;
  hooks: string[];
  content_angle: string;
  retailer_anchor?: RetailerAnchor;
  why_it_should_work: string;
  target_metrics: ActionBoardTargetMetrics;
  confidence_score: number;
}

export interface WeeklyPlan {
  weekly_plan: ActionBoardPost[];
  generated_at?: string;
  source?: string;
  calls_used?: number;
  calls_max?: number;
}

export interface CalendarPostApi {
  id: number;
  title: string;
  date: string;           // "YYYY-MM-DD"
  time_slot: string | null;
  content_type: string;
  status: string;
  hook: string | null;
  notes: string | null;
  opening_script: string | null;
  products_to_mention: string | null;   // JSON array string
  hashtags: string | null;               // JSON array string
  recommended_duration: string | null;
  created_at: string;
  updated_at: string;
}

export interface TrackerMetricValue {
  current: number | null;
  previous: number | null;
  delta_abs: number | null;    // absolute change (e.g. +3.5pp for percentages)
  delta_pct: number | null;    // relative % change (e.g. +13.6% for views)
  source: "manual" | "calculated";
}

export interface TrackerMetrics {
  target_market_reach: TrackerMetricValue;
  reel_reach: TrackerMetricValue;
  profile_visit_conversion: TrackerMetricValue;
  views_rolling_avg: TrackerMetricValue;
  content_quality_score: TrackerMetricValue;
  updated_at: string;
}

export interface ThisWeek {
  shares_this_week: number;
  shares_delta_pct: number | null;
  saves_this_week: number;
  saves_delta_pct: number | null;
  reach_this_week?: number;
  reach_delta_pct?: number | null;
  posts_this_week?: number;
  posts_delta_pct?: number | null;
}

export interface ReachSources {
  reel_reach_pct: number | null;
  reel: number;
  story: number;
  carousel: number;
  total: number;
}

export interface TokenStatus {
  days_remaining: number | null;
  expires_at: string | null;
  status: "ok" | "warning" | "critical" | "unknown";
}

export type ColdStreakRisk = "ok" | "warning" | "critical" | "unknown";

export interface LastReel {
  post_id: string;
  caption: string;
  timestamp: string;
  hours_since_posted: number;
  avg_watch_time_sec: number | null;
  video_views: number | null;
  reach: number;
  reach_pct_of_avg: number | null;
  avg_reach_baseline: number;
  shares: number;
  saved: number;
  cold_streak_risk: ColdStreakRisk;
  signal: string;
}

export interface HeatmapSlot {
  dow: number;   // 0=Sun … 6=Sat
  hour: number;  // UTC hour (stored timestamps are UTC)
  posts: number;
  shares: number;
  saves: number;
  score: number; // shares*2 + saves
}

export type DealStatus = "Negotiating" | "Confirmed" | "Delivered" | "Paid";
export type DeliverableType = "Instagram Post" | "Reel" | "Story" | "Package";

export interface Deal {
  id: string;
  brand: string;
  value: number;
  status: DealStatus;
  deliverable: DeliverableType;
  due_date: string;
  notes: string;
  created_at: string;
}