import { useCallback, useState, useEffect } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { LayoutDashboard, Grid2x2, Sparkles, Newspaper, Handshake, Home, RefreshCw, ClipboardList } from "lucide-react";

import { getOverview, hasCredentials, checkHealth, setCredentials } from "@/services/api";
import { useApi } from "@/hooks/useApi";
import { HQTab } from "@/components/tabs/HQTab";
import { OverviewTab } from "@/components/tabs/OverviewTab";
import { PostsTab } from "@/components/tabs/PostsTab";
import { InsightsTab } from "@/components/tabs/InsightsTab";
import { DealsTab } from "@/components/tabs/DealsTab";
import { HeadlinesTab } from "@/components/tabs/HeadlinesTab";
import { ActionBoardTab } from "@/components/tabs/ActionBoardTab";
import { formatDateTime } from "@/lib/utils";
import { DailySparkButton } from "@/components/DailySparkButton";

const SHOW_DEALS_TAB = true;
// Flip to true when a real trends API is integrated (TikTok Research API, etc.)
const SHOW_HEADLINES_TAB = false;

const TABS = [
  { value: "overview",     label: "Overview",      icon: LayoutDashboard },
  { value: "posts",        label: "Posts",          icon: Grid2x2 },
  { value: "insights",     label: "AI Insights",    icon: Sparkles },
  { value: "action-board", label: "Action Board",   icon: ClipboardList },
  { value: "hq",           label: "HQ",             icon: Home },
  ...(SHOW_HEADLINES_TAB ? [{ value: "headlines", label: "Headlines", icon: Newspaper }] : []),
  ...(SHOW_DEALS_TAB ? [{ value: "deals", label: "Deals", icon: Handshake }] : []),
];

export default function App() {
  // Auto-login for demo: if no credentials, set demo ones automatically.
  // This is safe because the deployed backend is demo-only (USE_MOCK_DATA=true).
  const [authed] = useState(() => {
    if (hasCredentials()) return true;
    const demoUser = import.meta.env.VITE_DEMO_USER as string | undefined;
    const demoPass = import.meta.env.VITE_DEMO_PASSWORD as string | undefined;
    if (demoUser && demoPass) {
      setCredentials(demoUser, demoPass);
      return true;
    }
    return false;
  });
  const [activeTab, setActiveTab] = useState("overview");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    checkHealth();
  }, []);

  const overviewFetcher = useCallback(
    () => (authed ? getOverview() : new Promise<never>(() => {})),
    [authed]
  );
  const { data: overview, loading: ovLoading, error: ovError, refetch: refetchOverview } = useApi(overviewFetcher);

  function handleRefresh() {
    refetchOverview();
    setRefreshKey((k) => k + 1);
  }

  if (!authed) {
    // Fallback for when demo env vars are missing — should not happen in deployed demo.
    return (
      <div className="min-h-screen bg-[#F5F5F5] flex items-center justify-center p-4">
        <p className="text-sm text-[#1A1A1A]/60">Loading demo…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F5F5] text-[#1A1A1A]">
      {/* Header */}
      <header className="border-b border-[#1A1A1A]/10 bg-white">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 xl:px-10 py-3 sm:py-4 flex items-center justify-between">
        {/* Left: title */}
        <div>
          <h1
            className="text-lg sm:text-xl font-semibold text-[#1A1A1A] leading-tight"
            style={{ fontFamily: "'Playfair Display', Georgia, 'Times New Roman', serif" }}
          >
            Demo Creator
          </h1>
          <p className="text-[9px] sm:text-[10px] tracking-[0.18em] uppercase text-[#1A1A1A]/40 font-light">
            Analytics Dashboard
          </p>
        </div>

        {/* Right: Live pill + avatar */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            {/* Live pill */}
            <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs text-emerald-700 font-medium">Live</span>
              {!ovLoading && !ovError && overview?.last_refreshed && (
                <span className="text-xs text-emerald-600/60 hidden sm:inline">
                  {formatDateTime(overview.last_refreshed)}
                </span>
              )}
            </div>

            <button
              onClick={handleRefresh}
              className="flex items-center gap-1 text-xs text-[#1A1A1A]/40 hover:text-[#1A1A1A] transition-colors px-2 py-1 rounded-lg border border-[#1A1A1A]/10 hover:border-[#1A1A1A]/20"
            >
              <RefreshCw className="w-3 h-3" />
              <span className="hidden sm:inline">Refresh</span>
            </button>


          </div>

          {/* Creator avatar */}
          <div className="w-8 h-8 rounded-full bg-[#F5EEF0] border border-[#EAC5CC] flex items-center justify-center shrink-0">
            <span className="text-xs font-semibold text-[#8B4A5C]">DC</span>
          </div>
        </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-[1440px] mx-auto px-4 sm:px-6 xl:px-10 py-4 sm:py-6">
        <Tabs.Root value={activeTab} onValueChange={setActiveTab}>
          {/* Tab nav — underline style, scrollable on mobile */}
          <div className="overflow-x-auto mb-6 -mx-4 px-4 sm:mx-0 sm:px-0">
            <Tabs.List className="flex border-b border-[#1A1A1A]/10 w-max sm:w-full">
              {TABS.map(({ value, label, icon: Icon }) => (
                <Tabs.Trigger
                  key={value}
                  value={value}
                  className="flex items-center gap-1.5 px-3 py-2.5 sm:px-4 text-xs sm:text-sm font-medium text-[#1A1A1A]/40 transition-all border-b-2 border-transparent data-[state=active]:text-[#8B4A5C] data-[state=active]:border-[#C4788A] hover:text-[#1A1A1A]/70 whitespace-nowrap translate-y-[1px]"
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </Tabs.Trigger>
              ))}
            </Tabs.List>
          </div>

          <Tabs.Content value="overview" className="outline-none">
            <OverviewTab
              overview={overview}
              ovLoading={ovLoading}
              ovError={ovError}
              refreshKey={refreshKey}
            />
          </Tabs.Content>
          <Tabs.Content value="posts">
            <PostsTab />
          </Tabs.Content>
          <Tabs.Content value="insights">
            <InsightsTab />
          </Tabs.Content>
          <Tabs.Content value="action-board">
            <ActionBoardTab />
          </Tabs.Content>
          <Tabs.Content value="hq">
            <HQTab />
          </Tabs.Content>
          {SHOW_HEADLINES_TAB && (
            <Tabs.Content value="headlines">
              <HeadlinesTab />
            </Tabs.Content>
          )}
          {SHOW_DEALS_TAB && (
            <Tabs.Content value="deals">
              <DealsTab />
            </Tabs.Content>
          )}
        </Tabs.Root>
      </main>

      {/* Daily Spark — floats at top of content area, right-aligned with container */}
      <div className="fixed top-[104px] right-4 sm:right-6 xl:right-[max(1.5rem,calc(50%-700px))] z-40">
        <DailySparkButton />
      </div>
    </div>
  );
}
