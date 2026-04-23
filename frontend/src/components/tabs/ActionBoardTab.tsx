import { useCallback, useEffect, useRef, useState } from "react";
import {
  Target, Zap, BookOpen, RefreshCw, Plus, Calendar, Table2,
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight, X, Trash2, Pencil, AlertCircle,
} from "lucide-react";

import {
  getActionBoard, forceGenerateActionBoard,
  getCalendarPosts, createCalendarPost, updateCalendarPost, deleteCalendarPost,
} from "@/services/api";
import { nextMondayDisplay } from "@/lib/utils";
import { useApi } from "@/hooks/useApi";
import { LoadingOverlay, Spinner } from "@/components/ui/spinner";
import type { ActionBoardPost, CalendarPostApi, WeeklyPlan } from "@/types";

// ─── Date utilities ───────────────────────────────────────────────────────────

function getPlanWeekStart(): Date {
  const today = new Date();
  const day   = today.getDay();
  const diff  = day === 1 ? 0 : day === 0 ? 1 : 8 - day;
  const d = new Date(today);
  d.setDate(today.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(d.getDate() + n);
  return r;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth()    === b.getMonth()    &&
    a.getDate()     === b.getDate()
  );
}

function toISODate(d: Date): string {
  const m  = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${dd}`;
}

const SHORT_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const FULL_MONTHS  = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const SHORT_DAYS   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const FULL_DAYS    = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

function calLabel(d: Date): string {
  return `${SHORT_DAYS[d.getDay()]} ${SHORT_MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function fullDate(d: Date): string {
  return `${FULL_DAYS[d.getDay()]}, ${SHORT_MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function formatTime(t: string): string {
  const match = t.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return t;
  const h = Number(match[1]);
  const m = Number(match[2]);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12  = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function isoToLocalDate(s: string): Date {
  const [y, mo, d] = s.split("-").map(Number);
  return new Date(y, mo - 1, d);
}

const todayISO = new Date().toISOString().slice(0, 10);

function hoursAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins   = Math.floor(diffMs / 60_000);
  if (mins < 60) return mins <= 1 ? "just now" : `${mins}m ago`;
  const hrs = Math.floor(diffMs / 3_600_000);
  return hrs === 1 ? "1h ago" : `${hrs}h ago`;
}

// ─── Time slot utilities ──────────────────────────────────────────────────────

const CAL_TIMES = ["9 am", "12 pm", "3 pm", "6 pm", "9 pm"];
const DEFAULT_TIME_SLOT = "12:00";

function parseDbId(id: string): number | null {
  const n = parseInt(id, 10);
  return isNaN(n) ? null : n;
}

const SLOT_HOURS: Record<string, number> = {
  "9 am": 9, "12 pm": 12, "3 pm": 15, "6 pm": 18, "9 pm": 21,
};

function matchesSlot(postTime: string, slot: string): boolean {
  const target = SLOT_HOURS[slot];
  const m = postTime.match(/^(\d{1,2}):/);
  return m ? parseInt(m[1]) === target : false;
}

function slotToTime(slot: string): string {
  const h = SLOT_HOURS[slot];
  return `${String(h).padStart(2, "0")}:00`;
}

/** Strips timezone/suffix so "18:00 EST" → "18:00" for input[type=time] */
function normalizeTimeInput(t: string): string {
  const match = t.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return "";
  return `${String(Number(match[1])).padStart(2, "0")}:${match[2]}`;
}

// ─── Format / display helpers ─────────────────────────────────────────────────

function getFormatEmoji(s: string): string {
  const l = s.toLowerCase();
  if (l.includes("reel"))     return "🎬";
  if (l.includes("carousel")) return "🖼️";
  if (l.includes("static"))   return "📸";
  return "📌";
}

function shortTitle(text: string): string {
  return text.split(" ").slice(0, 2).join(" ");
}

// ─── Month view helper ────────────────────────────────────────────────────────

function getMonthDays(year: number, month: number): (Date | null)[] {
  const first    = new Date(year, month, 1);
  const lastDate = new Date(year, month + 1, 0).getDate();
  const pad      = (first.getDay() + 6) % 7; // Mon-based grid
  const days: (Date | null)[] = Array(pad).fill(null);
  for (let d = 1; d <= lastDate; d++) days.push(new Date(year, month, d));
  while (days.length % 7 !== 0) days.push(null);
  return days;
}

// ─── Post status ──────────────────────────────────────────────────────────────

type PostStatus = "Idea" | "Filming" | "Edited" | "Posted";
const POST_STATUSES: PostStatus[] = ["Idea", "Filming", "Edited", "Posted"];

const STATUS_STYLE: Record<PostStatus, React.CSSProperties> = {
  Idea:    { backgroundColor: "#F3F4F6", color: "#6B7280" },
  Filming: { backgroundColor: "#FEF3C7", color: "#D97706" },
  Edited:  { backgroundColor: "#DBEAFE", color: "#1D4ED8" },
  Posted:  { backgroundColor: "#D1FAE5", color: "#059669" },
};

// ─── Post type metadata ───────────────────────────────────────────────────────

type PostTypeInfo = { label: string; pillClass: string; icon: React.ReactElement; dot: string };

function getPostType(n: number): PostTypeInfo {
  if (n <= 2) return {
    label: "Proven Winner",
    pillClass: "bg-[#F5EEF0] text-[#8B4A5C] border-[#EAC5CC]",
    icon: <Target className="w-3.5 h-3.5" />,
    dot: "bg-[#C4788A]",
  };
  if (n <= 4) return {
    label: "Experimental",
    pillClass: "bg-[#F3F0FF] text-[#6D28D9] border-[#DDD6FE]",
    icon: <Zap className="w-3.5 h-3.5" />,
    dot: "bg-violet-500",
  };
  return {
    label: "Safe Educational",
    pillClass: "bg-[#EFF6FF] text-[#1D4ED8] border-[#BFDBFE]",
    icon: <BookOpen className="w-3.5 h-3.5" />,
    dot: "bg-sky-500",
  };
}

const POST_TYPE_LEGEND: PostTypeInfo[] = [getPostType(1), getPostType(3), getPostType(5)];

function calBlockStyle(n: number): React.CSSProperties {
  if (n <= 2) return { backgroundColor: "#F5EEF0", color: "#6B2A3A", borderColor: "#EAC5CC" };
  if (n <= 4) return { backgroundColor: "#F3F0FF", color: "#6D28D9", borderColor: "#DDD6FE" };
  return { backgroundColor: "#EFF6FF", color: "#1D4ED8", borderColor: "#BFDBFE" };
}

// ─── Confidence bar ───────────────────────────────────────────────────────────

function confidenceBarColor(score: number): string {
  if (score >= 80) return "bg-emerald-500";
  if (score >= 60) return "bg-amber-400";
  return "bg-rose-400";
}

function ConfidenceBar({ score, width }: { score: number; width: string }) {
  return (
    <div className={`${width} h-1.5 bg-[#1A1A1A]/10 rounded-full overflow-hidden`}>
      <div className={`h-full rounded-full ${confidenceBarColor(score)}`} style={{ width: `${score}%` }} />
    </div>
  );
}

// ─── Domain types ─────────────────────────────────────────────────────────────

type ApiOverride = { date: string; time: string };

type DragPayload =
  | { kind: "api";    postNumber: number }
  | { kind: "custom"; id: string };

const CONTENT_TYPES = ["Reel (20-30s)", "Reel (45-60s)", "Carousel", "Static"];

interface CustomPost {
  id:                   string;
  date:                 string;   // "YYYY-MM-DD"
  time:                 string;   // "HH:MM" 24h
  title:                string;
  hook:                 string;
  content_type:         string;
  notes:                string;
  status:               PostStatus;
  opening_script:       string;
  products_to_mention:  string[];
  hashtags:             string[];
  recommended_duration: string;
}

type SelectedBlock =
  | { kind: "api";    post: ActionBoardPost; date: Date; time: string }
  | { kind: "custom"; post: CustomPost };

// ─── Schedule table ───────────────────────────────────────────────────────────

const DAY_ORDER = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];

function ScheduleTable({ plan }: { plan: ActionBoardPost[] }) {
  const sorted = [...plan].sort((a, b) => DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day));
  return (
    <div className="bg-white border border-[#1A1A1A]/8 rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#1A1A1A]/8 bg-[#1A1A1A]/2">
              <th className="text-left py-2.5 px-4 font-medium text-[#1A1A1A]/40 text-xs uppercase tracking-wide">Day</th>
              <th className="text-left py-2.5 px-4 font-medium text-[#1A1A1A]/40 text-xs uppercase tracking-wide">Time</th>
              <th className="text-left py-2.5 px-4 font-medium text-[#1A1A1A]/40 text-xs uppercase tracking-wide">Format</th>
              <th className="text-left py-2.5 px-4 font-medium text-[#1A1A1A]/40 text-xs uppercase tracking-wide hidden sm:table-cell">Confidence</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((post) => {
              const { label, pillClass, icon } = getPostType(post.post_number);
              return (
                <tr key={post.post_number} className="border-b border-[#1A1A1A]/5 last:border-0 hover:bg-[#1A1A1A]/1 transition-colors">
                  <td className="py-3 px-4 font-medium text-[#1A1A1A] text-sm">{post.day}</td>
                  <td className="py-3 px-4 text-[#1A1A1A]/60 font-mono text-xs">{post.time}</td>
                  <td className="py-3 px-4">
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-[#1A1A1A]/80">{post.format}</span>
                      <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border w-fit ${pillClass}`}>
                        {icon}{label}
                      </span>
                    </div>
                  </td>
                  <td className="py-3 px-4 hidden sm:table-cell">
                    <div className="flex items-center gap-2">
                      <ConfidenceBar score={post.confidence_score} width="w-16" />
                      <span className="text-xs text-[#1A1A1A]/60 font-mono">{post.confidence_score}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Field style ─────────────────────────────────────────────────────────────

const FIELD = "w-full bg-white border border-[#1A1A1A]/12 rounded-lg px-3 py-2 text-sm text-[#1A1A1A] focus:outline-none focus:border-[#C4788A]/50 focus:ring-1 focus:ring-[#C4788A]/15";

// ─── Detail modal ─────────────────────────────────────────────────────────────

interface DetailModalProps {
  block:          SelectedBlock;
  onClose:        () => void;
  onDelete:       () => void;
  onEdit?:        (updated: CustomPost) => void;
  onPromoteApi?:  (postNumber: number, post: CustomPost) => void;
}

function DetailModal({ block, onClose, onDelete, onEdit, onPromoteApi }: DetailModalProps) {
  const isApi      = block.kind === "api";
  const customPost = isApi ? null : block.post;

  const [isEditing,       setIsEditing]       = useState(false);
  const [eDate,           setEDate]           = useState(isApi ? toISODate(block.date) : customPost?.date ?? "");
  const [eTime,           setETime]           = useState(isApi ? normalizeTimeInput(block.time) : customPost?.time ?? "");
  const [eTitle,          setETitle]          = useState(isApi ? block.post.format      : customPost?.title ?? "");
  const [eHook,           setEHook]           = useState(isApi ? (block.post.hooks?.[0] ?? "") : customPost?.hook ?? "");
  const [eContentType,    setEContentType]    = useState(customPost?.content_type ?? CONTENT_TYPES[0]);
  const [eNotes,          setENotes]          = useState(isApi ? (block.post.content_angle ?? "") : customPost?.notes ?? "");
  const [eStatus,         setEStatus]         = useState<PostStatus>(customPost?.status ?? "Idea");

  function handleSave() {
    if (isApi) {
      const promoted: CustomPost = {
        id:                   `api-${block.post.post_number}-${Date.now()}`,
        date:                 eDate,
        time:                 eTime,
        title:                eTitle,
        hook:                 eHook,
        content_type:         eContentType,
        notes:                eNotes,
        status:               eStatus,
        opening_script:       "",
        products_to_mention:  [],
        hashtags:             [],
        recommended_duration: "",
      };
      onPromoteApi?.(block.post.post_number, promoted);
    } else if (customPost && onEdit) {
      onEdit({
        ...customPost,
        date: eDate, time: eTime, title: eTitle, hook: eHook,
        content_type: eContentType, notes: eNotes, status: eStatus,
      });
    }
    setIsEditing(false);
    onClose();
  }

  const dateStr    = isApi ? fullDate(block.date) : fullDate(isoToLocalDate(block.post.date));
  const timeStr    = isApi ? formatTime(block.time) : formatTime(block.post.time);
  const titleDisp  = isApi ? block.post.format : block.post.title;
  const hookDisp   = isApi ? (block.post.hooks?.[0] ?? "—") : block.post.hook;
  const typeLabel  = isApi ? getPostType(block.post.post_number).label : block.post.content_type;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl border border-[#1A1A1A]/8 shadow-xl w-full max-w-[600px] max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#1A1A1A]/8">
          <span className="text-sm font-semibold text-[#1A1A1A]">
            {isEditing ? "Edit Post" : "Post Details"}
          </span>
          <button onClick={onClose} className="text-[#1A1A1A]/40 hover:text-[#1A1A1A] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Edit mode */}
        {isEditing ? (
          <div className="p-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-[#1A1A1A]/50 mb-1">Date</label>
                <input type="date" className={FIELD} value={eDate} min={todayISO} onChange={(e) => setEDate(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs text-[#1A1A1A]/50 mb-1">Time</label>
                <input type="time" className={FIELD} value={eTime} onChange={(e) => setETime(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="block text-xs text-[#1A1A1A]/50 mb-1">Title <span className="text-rose-400">*</span></label>
              <input className={FIELD} value={eTitle} onChange={(e) => setETitle(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs text-[#1A1A1A]/50 mb-1">Hook</label>
              <textarea className={`${FIELD} resize-none`} rows={3} value={eHook} onChange={(e) => setEHook(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-[#1A1A1A]/50 mb-1">Content type</label>
                <select className={FIELD} value={eContentType} onChange={(e) => setEContentType(e.target.value)}>
                  {CONTENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-[#1A1A1A]/50 mb-1">Status</label>
                <select className={FIELD} value={eStatus} onChange={(e) => setEStatus(e.target.value as PostStatus)}>
                  {POST_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs text-[#1A1A1A]/50 mb-1">Notes</label>
              <textarea className={`${FIELD} resize-none`} rows={6} value={eNotes} onChange={(e) => setENotes(e.target.value)} />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setIsEditing(false)} className="px-4 py-2 text-sm text-[#1A1A1A]/40 hover:text-[#1A1A1A] transition-colors">
                Cancel
              </button>
              <button type="button" onClick={handleSave} disabled={!eTitle.trim()} className="px-4 py-2 text-sm bg-[#A05A6A] hover:bg-[#8B4A5C] text-white rounded-lg transition-colors disabled:opacity-40">
                Save
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* View mode body */}
            <div className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] text-[#1A1A1A]/40 uppercase tracking-wide mb-0.5">Date</p>
                  <p className="text-xs text-[#1A1A1A]/80 font-medium">{dateStr}</p>
                </div>
                <div>
                  <p className="text-[10px] text-[#1A1A1A]/40 uppercase tracking-wide mb-0.5">Time</p>
                  <p className="text-xs text-[#1A1A1A]/80 font-medium">{timeStr}</p>
                </div>
              </div>

              <div>
                <p className="text-[10px] text-[#1A1A1A]/40 uppercase tracking-wide mb-0.5">Post Idea</p>
                <p className="text-sm text-[#1A1A1A] font-medium leading-snug">{titleDisp}</p>
              </div>

              <div>
                <p className="text-[10px] text-[#1A1A1A]/40 uppercase tracking-wide mb-0.5">Hook</p>
                <p className="text-xs text-[#1A1A1A]/70 leading-snug italic">"{hookDisp}"</p>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <p className="text-[10px] text-[#1A1A1A]/40 uppercase tracking-wide mb-0.5">Content Type</p>
                  <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${getPostType(isApi ? block.post.post_number : 5).pillClass}`}>
                    {typeLabel}
                  </span>
                </div>
                {isApi && (
                  <div>
                    <p className="text-[10px] text-[#1A1A1A]/40 uppercase tracking-wide mb-1">Confidence</p>
                    <div className="flex items-center gap-1.5">
                      <ConfidenceBar score={block.post.confidence_score} width="w-16" />
                      <span className="text-xs font-semibold text-[#1A1A1A]">{block.post.confidence_score}%</span>
                    </div>
                  </div>
                )}
                {!isApi && (
                  <div>
                    <p className="text-[10px] text-[#1A1A1A]/40 uppercase tracking-wide mb-0.5">Status</p>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={STATUS_STYLE[block.post.status]}>
                      {block.post.status}
                    </span>
                  </div>
                )}
              </div>

              {!isApi && block.post.notes && (
                <div>
                  <p className="text-[10px] text-[#1A1A1A]/40 uppercase tracking-wide mb-0.5">Notes</p>
                  <p className="text-xs text-[#1A1A1A]/60 leading-snug">{block.post.notes}</p>
                </div>
              )}

              {isApi && block.post.content_angle && (
                <div>
                  <p className="text-[10px] text-[#1A1A1A]/40 uppercase tracking-wide mb-0.5">Content Angle</p>
                  <p className="text-xs text-[#1A1A1A]/60 leading-snug">{block.post.content_angle}</p>
                </div>
              )}

              {!isApi && customPost && (customPost.opening_script || customPost.products_to_mention.length > 0 || customPost.hashtags.length > 0 || customPost.recommended_duration) && (
                <div className="border-t border-[#1A1A1A]/6 pt-3 space-y-3">
                  {customPost.opening_script && (
                    <div>
                      <p className="text-[10px] text-[#1A1A1A]/40 uppercase tracking-wide mb-0.5">Opening Script</p>
                      <p className="text-xs text-[#1A1A1A]/70 leading-relaxed italic">"{customPost.opening_script}"</p>
                    </div>
                  )}
                  {customPost.products_to_mention.length > 0 && (
                    <div>
                      <p className="text-[10px] text-[#1A1A1A]/40 uppercase tracking-wide mb-1">Products to Mention</p>
                      <div className="flex flex-wrap gap-1.5">
                        {customPost.products_to_mention.map((p, i) => (
                          <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-[#F5EEF0] text-[#8B4A5C]">{p}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {customPost.hashtags.length > 0 && (
                    <div>
                      <p className="text-[10px] text-[#1A1A1A]/40 uppercase tracking-wide mb-1">Hashtags</p>
                      <div className="flex flex-wrap gap-1.5">
                        {customPost.hashtags.map((h, i) => (
                          <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-[#EFF6FF] text-[#1D4ED8]">#{h}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {customPost.recommended_duration && (
                    <div>
                      <p className="text-[10px] text-[#1A1A1A]/40 uppercase tracking-wide mb-0.5">Recommended Duration</p>
                      <p className="text-xs text-[#1A1A1A]/70 font-medium">{customPost.recommended_duration}</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 pb-5 flex justify-end gap-2 flex-wrap">
              <button
                onClick={() => { onDelete(); onClose(); }}
                className="flex items-center gap-1.5 text-xs text-rose-500 hover:text-rose-700 border border-rose-200 hover:border-rose-400 px-3 py-2 rounded-lg transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete post
              </button>
              <button
                onClick={() => setIsEditing(true)}
                className="flex items-center gap-1.5 text-xs text-[#8B4A5C] hover:text-[#6B2A3A] border border-[#EAC5CC] hover:border-[#C4788A] px-3 py-2 rounded-lg transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" />
                Edit
              </button>
              <button
                onClick={onClose}
                className="text-xs text-[#1A1A1A]/50 hover:text-[#1A1A1A] px-3 py-2 rounded-lg border border-[#1A1A1A]/10 hover:border-[#1A1A1A]/20 transition-colors"
              >
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Calendar grid ────────────────────────────────────────────────────────────

interface CalendarGridProps {
  plan:             ActionBoardPost[];
  planBase:         Date;
  customPosts:      CustomPost[];
  apiOverrides:     Record<number, ApiOverride>;
  onDeleteApi:      (n: number) => void;
  onDeleteCustom:   (id: string) => void;
  onEditCustom:     (post: CustomPost) => void;
  onPromoteApi:     (postNumber: number, post: CustomPost) => void;
  onMoveApi:        (postNumber: number, date: string, time: string) => void;
  onMoveCustom:     (id: string, date: string, time: string) => void;
  onCellClick:      (date: Date, slot: string) => void;
}

function CalendarGrid({
  plan, planBase, customPosts, apiOverrides,
  onDeleteApi, onDeleteCustom, onEditCustom, onPromoteApi,
  onMoveApi, onMoveCustom, onCellClick,
}: CalendarGridProps) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [calView,    setCalView]    = useState<"week" | "month">("week");
  const [monthOff,   setMonthOff]   = useState(0);
  const [selected,   setSelected]   = useState<SelectedBlock | null>(null);
  const [dragOver,   setDragOver]   = useState<{ colIdx: number; slot: string } | null>(null);
  const dragItem = useRef<DragPayload | null>(null);
  const touchPos  = useRef<{ x: number; y: number } | null>(null);

  const weekStart = addDays(planBase, weekOffset * 7);
  const weekEnd   = addDays(weekStart, 7);
  const colDates  = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const half      = Math.ceil(plan.length / 2);

  function apiPostDate(post: ActionBoardPost, idx: number): Date {
    const ov = apiOverrides[post.post_number];
    if (ov) return isoToLocalDate(ov.date);
    const wk = idx >= half ? 7 : 0;
    return addDays(addDays(planBase, wk), DAY_ORDER.indexOf(post.day));
  }

  function apiPostTime(post: ActionBoardPost): string {
    return apiOverrides[post.post_number]?.time ?? post.time;
  }

  // All API posts with computed dates (used for both views)
  const allApiPosts = plan.map((post, i) => ({
    post,
    date: apiPostDate(post, i),
    time: apiPostTime(post),
  }));

  const visibleApiPosts = allApiPosts.filter(({ date }) => date >= weekStart && date < weekEnd);
  const visibleCustom   = customPosts.filter((p) => {
    const d = isoToLocalDate(p.date);
    return d >= weekStart && d < weekEnd;
  });

  const totalVisible = visibleApiPosts.length + visibleCustom.length;
  const weekLabel    = `${calLabel(weekStart)} — ${calLabel(addDays(weekEnd, -1))}`;

  function postCountForDay(d: Date): number {
    const api    = allApiPosts.filter(({ date }) => sameDay(date, d)).length;
    const custom = customPosts.filter((p) => sameDay(isoToLocalDate(p.date), d)).length;
    return api + custom;
  }

  // Month view
  const monthBase = new Date(weekStart.getFullYear(), weekStart.getMonth() + monthOff, 1);
  const monthYear = monthBase.getFullYear();
  const monthIdx  = monthBase.getMonth();
  const monthDays = getMonthDays(monthYear, monthIdx);

  function goToWeekOf(d: Date) {
    const day    = d.getDay();
    const toMon  = day === 0 ? -6 : 1 - day;
    const monday = addDays(d, toMon);
    const diffDays = Math.round((monday.getTime() - planBase.getTime()) / 86400000);
    setWeekOffset(Math.floor(diffDays / 7));
    setMonthOff(0);
    setCalView("week");
  }

  // Drag handlers
  function handleDragStart(payload: DragPayload) {
    dragItem.current = payload;
  }

  function handleDragOver(e: React.DragEvent, colIdx: number, slot: string) {
    e.preventDefault();
    setDragOver({ colIdx, slot });
  }

  function handleDrop(colDate: Date, slot: string) {
    if (!dragItem.current) return;
    const dateStr = toISODate(colDate);
    const timeStr = slotToTime(slot);
    if (dragItem.current.kind === "api") {
      onMoveApi(dragItem.current.postNumber, dateStr, timeStr);
    } else {
      onMoveCustom(dragItem.current.id, dateStr, timeStr);
    }
    dragItem.current = null;
    setDragOver(null);
  }

  function handleDragEnd() {
    dragItem.current = null;
    setDragOver(null);
  }

  function handleTouchStart(e: React.TouchEvent, payload: DragPayload) {
    dragItem.current = payload;
    const t = e.touches[0];
    touchPos.current = { x: t.clientX, y: t.clientY };
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (!dragItem.current) return;
    e.preventDefault();
    const t = e.touches[0];
    touchPos.current = { x: t.clientX, y: t.clientY };

    const el   = document.elementFromPoint(t.clientX, t.clientY);
    const cell = el?.closest("[data-drop-slot]");
    if (cell) {
      const di = Number(cell.getAttribute("data-col-idx"));
      const sl = cell.getAttribute("data-drop-slot") ?? "";
      // Guard: only update state when the cell actually changes
      if (dragOver?.colIdx !== di || dragOver?.slot !== sl) {
        setDragOver({ colIdx: di, slot: sl });
      }
    } else if (dragOver !== null) {
      setDragOver(null);
    }
  }

  function handleTouchEnd(_e: React.TouchEvent) {
    if (!dragItem.current || !touchPos.current) {
      dragItem.current = null;
      return;
    }
    const { x, y } = touchPos.current;
    const el   = document.elementFromPoint(x, y);
    const cell = el?.closest("[data-drop-slot]");
    if (cell) {
      const dateStr = cell.getAttribute("data-date") ?? "";
      const timeStr = cell.getAttribute("data-time") ?? "";
      if (dateStr && timeStr) {
        if (dragItem.current.kind === "api") {
          onMoveApi(dragItem.current.postNumber, dateStr, timeStr);
        } else {
          onMoveCustom(dragItem.current.id, dateStr, timeStr);
        }
      }
    }
    dragItem.current = null;
    touchPos.current = null;
    setDragOver(null);
  }

  return (
    <>
      {selected && (
        <DetailModal
          block={selected}
          onClose={() => setSelected(null)}
          onDelete={() => {
            if (selected.kind === "api")    onDeleteApi(selected.post.post_number);
            if (selected.kind === "custom") onDeleteCustom(selected.post.id);
          }}
          onEdit={onEditCustom}
          onPromoteApi={onPromoteApi}
        />
      )}

      <div className="bg-white border border-[#1A1A1A]/8 rounded-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#1A1A1A]/6">
          <div className="flex items-center gap-2">
            {calView === "week" ? (
              <>
                <button
                  onClick={() => setWeekOffset((o) => o - 1)}
                  className="p-1 rounded-lg text-[#1A1A1A]/40 hover:text-[#1A1A1A] hover:bg-[#1A1A1A]/5 transition-colors"
                  aria-label="Previous week"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-xs font-medium text-[#1A1A1A]/60">{weekLabel}</span>
                <button
                  onClick={() => setWeekOffset((o) => o + 1)}
                  className="p-1 rounded-lg text-[#1A1A1A]/40 hover:text-[#1A1A1A] hover:bg-[#1A1A1A]/5 transition-colors"
                  aria-label="Next week"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setMonthOff((o) => o - 1)}
                  className="p-1 rounded-lg text-[#1A1A1A]/40 hover:text-[#1A1A1A] hover:bg-[#1A1A1A]/5 transition-colors"
                  aria-label="Previous month"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-xs font-medium text-[#1A1A1A]/60">
                  {FULL_MONTHS[monthIdx]} {monthYear}
                </span>
                <button
                  onClick={() => setMonthOff((o) => o + 1)}
                  className="p-1 rounded-lg text-[#1A1A1A]/40 hover:text-[#1A1A1A] hover:bg-[#1A1A1A]/5 transition-colors"
                  aria-label="Next month"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            {calView === "week" && weekOffset !== 0 && (
              <button
                onClick={() => setWeekOffset(0)}
                className="text-[10px] text-[#8B4A5C] hover:text-[#6B2A3A] transition-colors border border-[#EAC5CC] rounded-full px-2 py-0.5"
              >
                Plan start
              </button>
            )}
            {calView === "week" && (
              <span className="text-[10px] text-[#1A1A1A]/30">
                {totalVisible} post{totalVisible !== 1 ? "s" : ""}
              </span>
            )}
            {/* Week / Month toggle */}
            <div className="flex items-center gap-0.5 bg-[#1A1A1A]/5 p-0.5 rounded-lg">
              <button
                onClick={() => setCalView("week")}
                className={`text-[10px] px-2.5 py-1 rounded-md transition-colors ${
                  calView === "week"
                    ? "bg-white text-[#8B4A5C] shadow-sm font-medium"
                    : "text-[#1A1A1A]/40 hover:text-[#1A1A1A]/70"
                }`}
              >
                Week
              </button>
              <button
                onClick={() => setCalView("month")}
                className={`text-[10px] px-2.5 py-1 rounded-md transition-colors ${
                  calView === "month"
                    ? "bg-white text-[#8B4A5C] shadow-sm font-medium"
                    : "text-[#1A1A1A]/40 hover:text-[#1A1A1A]/70"
                }`}
              >
                Month
              </button>
            </div>
          </div>
        </div>

        {/* ── MONTH VIEW ── */}
        {calView === "month" && (
          <div className="p-4">
            <div className="grid grid-cols-7 gap-1 mb-2">
              {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((d) => (
                <div key={d} className="text-[10px] font-medium text-[#1A1A1A]/40 text-center">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {monthDays.map((d, i) => {
                if (!d) return <div key={i} className="h-10" />;
                const count   = postCountForDay(d);
                const isToday = sameDay(d, new Date());
                return (
                  <button
                    key={i}
                    onClick={() => goToWeekOf(d)}
                    className={`h-10 flex flex-col items-center justify-center rounded-lg text-xs transition-colors hover:bg-[#F5EEF0] ${
                      isToday
                        ? "bg-[#F5EEF0] text-[#8B4A5C] font-semibold"
                        : "text-[#1A1A1A]/60 hover:text-[#8B4A5C]"
                    }`}
                  >
                    <span>{d.getDate()}</span>
                    {count > 0 && (
                      <div className="flex gap-0.5 mt-0.5">
                        {Array.from({ length: Math.min(count, 3) }).map((_, j) => (
                          <div key={j} className="w-1 h-1 rounded-full bg-[#C4788A]" />
                        ))}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── WEEK VIEW ── */}
        {calView === "week" && (
          <div className="overflow-x-auto">
            <div className="min-w-[640px] p-4">
              {/* Column headers */}
              <div className="grid grid-cols-8 gap-2 mb-2">
                <div />
                {colDates.map((d) => {
                  const count = postCountForDay(d);
                  return (
                    <div key={d.toISOString()} className="text-center">
                      <p className="text-[10px] font-semibold text-[#1A1A1A]/50 leading-tight">{calLabel(d)}</p>
                      {count > 1 && (
                        <div className="flex justify-center mt-0.5">
                          <span
                            className="inline-flex items-center justify-center text-[8px] font-semibold rounded-full"
                            style={{ backgroundColor: "#F5EEF0", color: "#8B4A5C", minWidth: 14, height: 14, padding: "0 3px" }}
                          >
                            {count}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Time rows */}
              {CAL_TIMES.map((slot) => (
                <div key={slot} className="grid grid-cols-8 gap-2 mb-2">
                  <div className="text-[10px] text-[#1A1A1A]/30 flex items-center justify-end pr-1">{slot}</div>

                  {colDates.map((colDate, di) => {
                    const apiMatches    = visibleApiPosts.filter(({ date, time }) => sameDay(date, colDate) && matchesSlot(time, slot));
                    const customMatches = visibleCustom.filter((p) => sameDay(isoToLocalDate(p.date), colDate) && matchesSlot(p.time, slot));
                    const isEmpty       = apiMatches.length === 0 && customMatches.length === 0;
                    const isDragOver    = dragOver?.colIdx === di && dragOver?.slot === slot;

                    if (!isEmpty) {
                      return (
                        <div
                          key={di}
                          className={`min-h-[3.5rem] rounded-lg flex flex-col gap-1 p-0.5 transition-colors ${isDragOver ? "ring-2 ring-[#C4788A]/50 bg-[#F5EEF0]/30" : ""}`}
                          onDragOver={(e) => handleDragOver(e, di, slot)}
                          onDrop={() => handleDrop(colDate, slot)}
                          data-drop-slot={slot}
                          data-col-idx={di}
                          data-date={toISODate(colDate)}
                          data-time={slotToTime(slot)}
                        >
                          {apiMatches.map(({ post, date, time }) => {
                            const style: React.CSSProperties = { ...calBlockStyle(post.post_number), border: "1px solid" };
                            return (
                              <div
                                key={post.post_number}
                                style={style}
                                className="relative flex-1 min-h-12 rounded-md text-[10px] flex flex-col items-center justify-center gap-0.5 cursor-grab active:cursor-grabbing hover:opacity-90 transition-opacity group"
                                draggable
                                onDragStart={() => handleDragStart({ kind: "api", postNumber: post.post_number })}
                                onDragEnd={handleDragEnd}
                                onTouchStart={(e) => handleTouchStart(e, { kind: "api", postNumber: post.post_number })}
                                onTouchMove={handleTouchMove}
                                onTouchEnd={handleTouchEnd}
                                onClick={() => setSelected({ kind: "api", post, date, time })}
                              >
                                <span className="text-sm leading-none">{getFormatEmoji(post.format)}</span>
                                <span className="font-semibold leading-none text-center px-1 line-clamp-1 max-w-full">
                                  {shortTitle(post.format)}
                                </span>
                                <button
                                  onClick={(e) => { e.stopPropagation(); onDeleteApi(post.post_number); }}
                                  className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/10 hover:bg-black/25 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                  aria-label="Remove post"
                                >
                                  <X className="w-2.5 h-2.5" />
                                </button>
                              </div>
                            );
                          })}

                          {customMatches.map((p) => (
                            <div
                              key={p.id}
                              className="relative flex-1 min-h-12 rounded-md text-[10px] flex flex-col items-center justify-center gap-0.5 cursor-grab active:cursor-grabbing hover:opacity-90 transition-opacity group"
                              style={{ backgroundColor: "#F5EEF0", color: "#6B2A3A", border: "1px solid #EAC5CC" }}
                              draggable
                              onDragStart={() => handleDragStart({ kind: "custom", id: p.id })}
                              onDragEnd={handleDragEnd}
                              onTouchStart={(e) => handleTouchStart(e, { kind: "custom", id: p.id })}
                              onTouchMove={handleTouchMove}
                              onTouchEnd={handleTouchEnd}
                              onClick={() => setSelected({ kind: "custom", post: p })}
                            >
                              <span className="text-sm leading-none">{getFormatEmoji(p.content_type)}</span>
                              <span className="font-semibold leading-none text-center px-1 line-clamp-1 max-w-full">
                                {shortTitle(p.title)}
                              </span>
                              <span
                                className="text-[8px] font-semibold px-1.5 py-0.5 rounded-full leading-none"
                                style={STATUS_STYLE[p.status]}
                              >
                                {p.status}
                              </span>
                              <button
                                onClick={(e) => { e.stopPropagation(); onDeleteCustom(p.id); }}
                                className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/10 hover:bg-black/25 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                aria-label="Remove post"
                              >
                                <X className="w-2.5 h-2.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      );
                    }

                    // Empty cell
                    return (
                      <div
                        key={di}
                        className={`h-14 rounded-lg border transition-colors cursor-pointer ${
                          isDragOver
                            ? "border-[#C4788A]/60 bg-[#F5EEF0]/60"
                            : "border-[#1A1A1A]/6 bg-[#1A1A1A]/1 hover:border-[#EAC5CC] hover:bg-[#F5EEF0]/30"
                        }`}
                        onClick={() => onCellClick(colDate, slot)}
                        onDragOver={(e) => handleDragOver(e, di, slot)}
                        onDrop={() => handleDrop(colDate, slot)}
                        data-drop-slot={slot}
                        data-col-idx={di}
                        data-date={toISODate(colDate)}
                        data-time={slotToTime(slot)}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ─── Create post modal ────────────────────────────────────────────────────────

interface CreatePostModalProps {
  onClose:      () => void;
  onAdd:        (post: CustomPost) => void;
  planBase:     Date;
  initialDate?: string;
  initialTime?: string;
}

function CreatePostModal({ onClose, onAdd, planBase, initialDate, initialTime }: CreatePostModalProps) {
  const [date,        setDate]        = useState(initialDate ?? planBase.toISOString().slice(0, 10));
  const [time,        setTime]        = useState(initialTime ?? "18:00");
  const [title,       setTitle]       = useState("");
  const [hook,        setHook]        = useState("");
  const [contentType, setContentType] = useState(CONTENT_TYPES[0]);
  const [notes,       setNotes]       = useState("");
  const [status,      setStatus]      = useState<PostStatus>("Idea");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    onAdd({
      id:                   `custom-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      date,
      time,
      title:                title.trim(),
      hook:                 hook.trim(),
      content_type:         contentType,
      notes:                notes.trim(),
      status,
      opening_script:       "",
      products_to_mention:  [],
      hashtags:             [],
      recommended_duration: "",
    });
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl border border-[#1A1A1A]/8 shadow-xl w-full max-w-sm max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1A1A1A]/8">
          <span className="text-sm font-semibold text-[#1A1A1A]">Add Post to Calendar</span>
          <button onClick={onClose} className="text-[#1A1A1A]/40 hover:text-[#1A1A1A] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[#1A1A1A]/50 mb-1">Date</label>
              <input type="date" className={FIELD} value={date} min={todayISO} onChange={(e) => setDate(e.target.value)} required />
            </div>
            <div>
              <label className="block text-xs text-[#1A1A1A]/50 mb-1">Time</label>
              <input type="time" className={FIELD} value={time} onChange={(e) => setTime(e.target.value)} required />
            </div>
          </div>

          <div>
            <label className="block text-xs text-[#1A1A1A]/50 mb-1">Post title / idea <span className="text-rose-400">*</span></label>
            <input
              className={FIELD}
              placeholder="e.g. Morning skincare routine for dry skin"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="block text-xs text-[#1A1A1A]/50 mb-1">Hook idea <span className="text-[#1A1A1A]/30">(opening line)</span></label>
            <input
              className={FIELD}
              placeholder="e.g. This one product changed my entire routine…"
              value={hook}
              onChange={(e) => setHook(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[#1A1A1A]/50 mb-1">Content type</label>
              <select className={FIELD} value={contentType} onChange={(e) => setContentType(e.target.value)}>
                {CONTENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[#1A1A1A]/50 mb-1">Status</label>
              <select className={FIELD} value={status} onChange={(e) => setStatus(e.target.value as PostStatus)}>
                {POST_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs text-[#1A1A1A]/50 mb-1">Notes <span className="text-[#1A1A1A]/30">(optional)</span></label>
            <textarea
              className={`${FIELD} resize-none`}
              rows={2}
              placeholder="Any extra context, references, collab ideas…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-[#1A1A1A]/40 hover:text-[#1A1A1A] transition-colors">
              Cancel
            </button>
            <button type="submit" className="px-4 py-2 text-sm bg-[#A05A6A] hover:bg-[#8B4A5C] text-white rounded-lg transition-colors">
              Add to Calendar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Recommendation card ──────────────────────────────────────────────────────

function RecommendationCard({ post }: { post: ActionBoardPost }) {
  const [expanded, setExpanded] = useState(false);
  const { label, pillClass, icon } = getPostType(post.post_number);

  return (
    <div className="border border-[#1A1A1A]/10 rounded-xl bg-white overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left px-4 py-3.5 flex items-start gap-3 hover:bg-[#1A1A1A]/1 transition-colors"
      >
        <span className="shrink-0 w-6 h-6 rounded-full bg-[#F5EEF0] flex items-center justify-center text-[10px] font-semibold text-[#8B4A5C]">
          {post.post_number}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="font-medium text-sm text-[#1A1A1A]">{post.day}</span>
            <span className="text-xs text-[#1A1A1A]/40 font-mono">{post.time}</span>
            <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border ${pillClass}`}>
              {icon}{label}
            </span>
          </div>
          <p className="text-xs text-[#1A1A1A]/60 truncate">{post.format}</p>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${confidenceBarColor(post.confidence_score)}`} />
            <span className="text-sm font-semibold text-[#1A1A1A]">{post.confidence_score}%</span>
          </div>
          {expanded ? <ChevronUp className="w-4 h-4 text-[#1A1A1A]/30" /> : <ChevronDown className="w-4 h-4 text-[#1A1A1A]/30" />}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-5 space-y-4 border-t border-[#1A1A1A]/6">

          {/* Format type + retailer badges */}
          {(post.format_type || post.retailer_anchor) && (
            <div className="pt-3 flex flex-wrap gap-2">
              {post.format_type && (
                <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-[#F5EEF0] border border-[#EAC5CC] text-[#8B4A5C] uppercase tracking-wide">
                  {{
                    A: "Celebrity ID + Real Product",
                    B: "Celebrity ID + Dupe",
                    C: "Hack Universal",
                    D: "Curation Local",
                    FLEX: "Flex",
                  }[post.format_type]}
                </span>
              )}
              {post.retailer_anchor && post.retailer_anchor !== "None" && (
                <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700">
                  🛍 {post.retailer_anchor}
                </span>
              )}
            </div>
          )}

          <div className={post.format_type || post.retailer_anchor ? "" : "pt-3"}>
            <p className="text-xs font-medium text-[#1A1A1A]/40 uppercase tracking-wide mb-2">Hook Options</p>
            <div className="space-y-2">
              {post.hooks.map((hook, i) => (
                <div key={i} className="flex items-start gap-2.5 bg-[#F5EEF0] border border-[#EAC5CC] rounded-lg px-3 py-2.5">
                  <span className="shrink-0 text-xs font-semibold text-[#C4788A] mt-0.5">{i + 1}</span>
                  <p className="text-sm text-[#1A1A1A]/80 leading-snug">{hook}</p>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-[#1A1A1A]/40 uppercase tracking-wide mb-1.5">Content Angle</p>
            <p className="text-sm text-[#1A1A1A]/80 leading-relaxed">{post.content_angle}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-[#1A1A1A]/40 uppercase tracking-wide mb-1.5">Why It Should Work</p>
            <p className="text-sm text-[#1A1A1A]/60 leading-relaxed italic">{post.why_it_should_work}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-[#1A1A1A]/40 uppercase tracking-wide mb-2">Target Metrics</p>
            <div className="flex gap-3 flex-wrap">
              <div className="flex-1 min-w-[80px] bg-[#1A1A1A]/4 rounded-lg px-3 py-2.5 text-center">
                <p className="text-xs text-[#1A1A1A]/40 mb-0.5">Saves</p>
                <p className="text-lg font-semibold text-emerald-600">{post.target_metrics.saves.toLocaleString()}</p>
              </div>
              <div className="flex-1 min-w-[80px] bg-[#1A1A1A]/4 rounded-lg px-3 py-2.5 text-center">
                <p className="text-xs text-[#1A1A1A]/40 mb-0.5">Shares</p>
                <p className="text-lg font-semibold text-sky-600">{post.target_metrics.shares.toLocaleString()}</p>
              </div>
              <div className="flex-1 min-w-[80px] bg-[#1A1A1A]/4 rounded-lg px-3 py-2.5 text-center">
                <p className="text-xs text-[#1A1A1A]/40 mb-0.5">Reach</p>
                <p className="text-lg font-semibold text-violet-600">{post.target_metrics.reach_multiplier.toFixed(1)}x</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Bottom recommendations ───────────────────────────────────────────────────

const GROWTH_OPPS = [
  "Double down on Reels under 30s — your top-3 posts are all short-form",
  "Post skincare routines on Thursday evenings — peak engagement window",
  "Use trending audio — saves spike 2× when paired with viral sounds",
];
const STOP_ACTIONS = [
  "Avoid promotional-only captions — they tank your organic reach",
  "Stop posting static images without a carousel hook",
];

function BottomRecommendations() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div className="bg-white border border-[#1A1A1A]/8 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-2.5 h-2.5 rounded-full bg-[#C4788A] shrink-0" />
          <span className="text-sm font-semibold text-[#1A1A1A]">Growth Opportunities</span>
        </div>
        <ul className="space-y-2.5">
          {GROWTH_OPPS.map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-[#1A1A1A]/70 leading-snug">
              <span className="w-1.5 h-1.5 rounded-full bg-[#C4788A] mt-1 shrink-0" />{item}
            </li>
          ))}
        </ul>
      </div>
      <div className="bg-white border-l-4 border border-rose-200 border-l-rose-500 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shrink-0" />
          <span className="text-sm font-semibold text-[#1A1A1A]">Stop Doing This</span>
        </div>
        <ul className="space-y-2.5">
          {STOP_ACTIONS.map((item, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-[#1A1A1A]/70 leading-snug">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-400 mt-1 shrink-0" />{item}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ─── Calendar API mapping ─────────────────────────────────────────────────────

function _apiToCustomPost(p: CalendarPostApi): CustomPost {
  let products: string[] = [];
  let hashtags: string[] = [];
  try { if (p.products_to_mention) products = JSON.parse(p.products_to_mention); } catch { /* ignore */ }
  try { if (p.hashtags) hashtags = JSON.parse(p.hashtags); } catch { /* ignore */ }
  return {
    id:                   p.id.toString(),
    date:                 p.date,
    time:                 p.time_slot ?? DEFAULT_TIME_SLOT,
    title:                p.title,
    hook:                 p.hook ?? "",
    content_type:         p.content_type,
    notes:                p.notes ?? "",
    status:               p.status as PostStatus,
    opening_script:       p.opening_script ?? "",
    products_to_mention:  products,
    hashtags:             hashtags,
    recommended_duration: p.recommended_duration ?? "",
  };
}

function _customPostToApiBody(
  p: CustomPost
): Omit<CalendarPostApi, "id" | "created_at" | "updated_at"> {
  return {
    title:               p.title,
    date:                p.date,
    time_slot:           p.time,
    content_type:        p.content_type,
    status:              p.status,
    hook:                p.hook || null,
    notes:               p.notes || null,
    opening_script:      p.opening_script || null,
    products_to_mention: p.products_to_mention.length ? JSON.stringify(p.products_to_mention) : null,
    hashtags:            p.hashtags.length ? JSON.stringify(p.hashtags) : null,
    recommended_duration: p.recommended_duration || null,
  };
}

// ─── Main Tab ─────────────────────────────────────────────────────────────────

export function ActionBoardTab() {
  const fetcher = useCallback(async () => {
    const hit = sessionStorage.getItem("demo_action_board");
    if (hit) return JSON.parse(hit) as WeeklyPlan;
    const data = await getActionBoard();
    sessionStorage.setItem("demo_action_board", JSON.stringify(data));
    return data;
  }, []);
  const { data, loading, error, refetch } = useApi<WeeklyPlan>(fetcher);

  const [view,           setView]           = useState<"table" | "calendar">("table");
  const [modalPreFill,   setModalPreFill]   = useState<{ date: string; time: string } | null>(null);
  const [customPosts,    setCustomPosts]    = useState<CustomPost[]>([]);
  const [deletedApiNums, setDeletedApiNums] = useState<number[]>([]);
  const [apiOverrides,   setApiOverrides]   = useState<Record<number, ApiOverride>>({});
  const [regenerating, setRegenerating] = useState(false);
  const [callsUsed,    setCallsUsed]    = useState<number | null>(null);

  useEffect(() => {
    getCalendarPosts()
      .then((posts) => setCustomPosts(posts.map(_apiToCustomPost)))
      .catch(() => {});
  }, []);

  const planBase = getPlanWeekStart();

  if (loading) return <LoadingOverlay label="Building your 14-day plan..." />;
  if (error)   return <p className="text-rose-500 py-8 text-center">{error}</p>;
  if (!data || !data.weekly_plan?.length) return null;

  const activePlan = data.weekly_plan.filter((p) => !deletedApiNums.includes(p.post_number));

  const displayCallsUsed = callsUsed ?? data?.calls_used ?? null;
  const rateLimitDate    = displayCallsUsed === 3 ? nextMondayDisplay() : null;

  async function handleRegenerate() {
    setRegenerating(true);
    try {
      sessionStorage.removeItem("demo_action_board");
      const result = await forceGenerateActionBoard();
      sessionStorage.setItem("demo_action_board", JSON.stringify(result));
      refetch();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("429")) setCallsUsed(3);
    } finally {
      setRegenerating(false);
    }
  }

  function handleDeleteApi(postNumber: number) {
    setDeletedApiNums((prev) => [...prev, postNumber]);
  }
  function handleDeleteCustom(id: string) {
    setCustomPosts((prev) => prev.filter((p) => p.id !== id));
    const dbId = parseDbId(id);
    if (dbId !== null) deleteCalendarPost(dbId).catch(() => {});
  }
  function handleEditCustom(updated: CustomPost) {
    setCustomPosts((prev) => prev.map((p) => p.id === updated.id ? updated : p));
    const dbId = parseDbId(updated.id);
    if (dbId !== null) updateCalendarPost(dbId, _customPostToApiBody(updated)).catch(() => {});
  }
  function handleMoveApi(postNumber: number, date: string, time: string) {
    setApiOverrides((prev) => ({ ...prev, [postNumber]: { date, time } }));
  }
  function handleMoveCustom(id: string, date: string, time: string) {
    setCustomPosts((prev) => prev.map((p) => p.id === id ? { ...p, date, time } : p));
    const dbId = parseDbId(id);
    if (dbId !== null) updateCalendarPost(dbId, { date, time_slot: time }).catch(() => {});
  }
  function handleAddCustom(post: CustomPost) {
    setCustomPosts((prev) => [...prev, post]);
    createCalendarPost(_customPostToApiBody(post))
      .then((saved) => {
        setCustomPosts((prev) =>
          prev.map((p) => p.id === post.id ? { ...p, id: saved.id.toString() } : p)
        );
      })
      .catch(() => {
        setCustomPosts((prev) => prev.filter((p) => p.id !== post.id));
      });
  }
  function handlePromoteApi(postNumber: number, post: CustomPost) {
    setDeletedApiNums((prev) => [...prev, postNumber]);
    setCustomPosts((prev) => [...prev, post]);
    createCalendarPost(_customPostToApiBody(post))
      .then((saved) => {
        setCustomPosts((prev) =>
          prev.map((p) => p.id === post.id ? { ...p, id: saved.id.toString() } : p)
        );
      })
      .catch(() => {
        setCustomPosts((prev) => prev.filter((p) => p.id !== post.id));
        setDeletedApiNums((prev) => prev.filter((n) => n !== postNumber));
      });
  }
  function handleCellClick(date: Date, slot: string) {
    setModalPreFill({ date: toISODate(date), time: slotToTime(slot) });
  }

  return (
    <>
      {modalPreFill && (
        <CreatePostModal
          onClose={() => setModalPreFill(null)}
          onAdd={handleAddCustom}
          planBase={planBase}
          initialDate={modalPreFill.date}
          initialTime={modalPreFill.time}
        />
      )}

      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-[#1A1A1A]">Action Board</h2>
            <p className="text-xs text-[#1A1A1A]/40 mt-0.5">
              Next 14 days — {activePlan.length} post recommendations
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex flex-col items-end gap-1">
              <button
                onClick={handleRegenerate}
                disabled={regenerating}
                className="flex items-center gap-1.5 text-xs text-[#1A1A1A]/50 hover:text-[#1A1A1A] transition-colors px-3 py-1.5 rounded-lg border border-[#1A1A1A]/10 hover:border-[#1A1A1A]/20 disabled:opacity-40"
              >
                {regenerating ? <Spinner className="w-3 h-3" /> : <RefreshCw className="w-3 h-3" />}
                Regenerate
              </button>
              {data?.generated_at && (
                <span className="text-[10px] text-[#1A1A1A]/30">Last updated: {hoursAgo(data.generated_at)}</span>
              )}
              {displayCallsUsed !== null && (
                <span className="text-[10px] text-[#1A1A1A]/30">{displayCallsUsed}/3 refreshes used this week</span>
              )}
            </div>
            <button
              onClick={() => setModalPreFill({ date: toISODate(planBase), time: "18:00" })}
              className="flex items-center gap-1.5 text-xs text-white px-3 py-1.5 rounded-lg bg-[#A05A6A] hover:bg-[#8B4A5C] transition-colors"
            >
              <Plus className="w-3 h-3" />
              Create post
            </button>
          </div>
        </div>

        {rateLimitDate && (
          <div className="flex items-center gap-2 text-xs text-[#6B2A3A] bg-[#F5EEF0] px-3 py-2.5 rounded-lg border border-[#EAC5CC]">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 text-[#C4788A]" />
            Insights refreshed 3 times this week. Next refresh available {rateLimitDate}.
          </div>
        )}

        {/* Post type legend */}
        <div className="flex gap-2 flex-wrap">
          {POST_TYPE_LEGEND.map(({ label, pillClass, icon }) => (
            <span key={label} className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border ${pillClass}`}>
              {icon}{label}
            </span>
          ))}
        </div>

        {/* View toggle */}
        <div className="flex items-center gap-1 bg-[#1A1A1A]/5 p-1 rounded-lg w-fit">
          {(["table", "calendar"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md transition-colors ${
                view === v
                  ? "bg-white text-[#8B4A5C] shadow-sm font-medium"
                  : "text-[#1A1A1A]/40 hover:text-[#1A1A1A]/70"
              }`}
            >
              {v === "table" ? <Table2 className="w-3.5 h-3.5" /> : <Calendar className="w-3.5 h-3.5" />}
              {v === "table" ? "Schedule" : "Calendar"}
            </button>
          ))}
        </div>

        {view === "table" ? (
          <ScheduleTable plan={activePlan} />
        ) : (
          <CalendarGrid
            plan={activePlan}
            planBase={planBase}
            customPosts={customPosts}
            apiOverrides={apiOverrides}
            onDeleteApi={handleDeleteApi}
            onDeleteCustom={handleDeleteCustom}
            onEditCustom={handleEditCustom}
            onPromoteApi={handlePromoteApi}
            onMoveApi={handleMoveApi}
            onMoveCustom={handleMoveCustom}
            onCellClick={handleCellClick}
          />
        )}

        {/* Recommendations */}
        <div>
          <p className="text-xs font-medium text-[#1A1A1A]/40 uppercase tracking-wide mb-3">Recommendations</p>
          <div className="space-y-3">
            {activePlan.map((post) => (
              <RecommendationCard key={post.post_number} post={post} />
            ))}
          </div>
        </div>

        <BottomRecommendations />
      </div>
    </>
  );
}
