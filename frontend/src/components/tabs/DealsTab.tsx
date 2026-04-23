import { useMemo, useState } from "react";
import { Plus, Pencil, Trash2, X, DollarSign, Handshake, CheckCircle2 } from "lucide-react";
import { Card, CardTitle } from "@/components/ui/card";
import { cn, formatDate } from "@/lib/utils";
import { useDeals } from "@/hooks/useDeals";
import type { Deal, DealStatus, DeliverableType } from "@/types";

// Map existing statuses to spec colors
const STATUS_STYLES: Record<DealStatus, string> = {
  Negotiating: "bg-[#F5EEF0] text-[#8B4A5C] border-[#EAC5CC]",       // New — mauve
  Confirmed:   "bg-amber-500/15 text-amber-700 border-amber-500/25",  // In review — amber
  Delivered:   "bg-emerald-500/15 text-emerald-700 border-emerald-500/25", // Completed — green
  Paid:        "bg-emerald-500/15 text-emerald-700 border-emerald-500/25", // Completed — green
};

// Display labels per status
const STATUS_LABELS: Record<DealStatus, string> = {
  Negotiating: "New",
  Confirmed:   "In review",
  Delivered:   "Completed",
  Paid:        "Paid",
};

const STATUSES:     DealStatus[]     = ["Negotiating", "Confirmed", "Delivered", "Paid"];
const DELIVERABLES: DeliverableType[] = ["Instagram Post", "Reel", "Story", "Package"];

const EMPTY_FORM = {
  brand:       "",
  value:       "",
  status:      "Negotiating" as DealStatus,
  deliverable: "Reel" as DeliverableType,
  due_date:    "",
  notes:       "",
};

const INPUT_CLASS =
  "w-full bg-white border border-[#1A1A1A]/12 rounded-lg px-3 py-2 text-sm text-[#1A1A1A] placeholder-[#1A1A1A]/30 focus:outline-none focus:border-[#C4788A]/50 focus:ring-1 focus:ring-[#C4788A]/15";
const LABEL_CLASS = "block text-xs text-[#1A1A1A]/50 mb-1";

function StatusBadge({ status }: { status: DealStatus }) {
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border", STATUS_STYLES[status])}>
      {STATUS_LABELS[status]}
    </span>
  );
}

interface SummaryCardProps {
  title: string;
  value: string;
  icon: React.ReactNode;
}

function SummaryCard({ title, value, icon }: SummaryCardProps) {
  return (
    <Card>
      <div className="flex items-start justify-between">
        <div>
          <CardTitle>{title}</CardTitle>
          <p className="text-2xl font-bold text-[#1A1A1A] mt-1">{value}</p>
        </div>
        {icon}
      </div>
    </Card>
  );
}

interface SelectFieldProps {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}

function SelectField({ label, value, options, onChange }: SelectFieldProps) {
  return (
    <div>
      <label className={LABEL_CLASS}>{label}</label>
      <select className={INPUT_CLASS} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

interface FormState {
  brand:       string;
  value:       string;
  status:      DealStatus;
  deliverable: DeliverableType;
  due_date:    string;
  notes:       string;
}

export function DealsTab() {
  const { deals, addDeal, updateDeal, deleteDeal } = useDeals();
  const [showForm, setShowForm]   = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm]           = useState<FormState>(EMPTY_FORM);

  const { confirmedTotal, pendingTotal, activeCount } = useMemo(() => ({
    confirmedTotal: deals.filter((d) => d.status === "Confirmed").reduce((s, d) => s + d.value, 0),
    pendingTotal:   deals.filter((d) => d.status === "Negotiating").reduce((s, d) => s + d.value, 0),
    activeCount:    deals.filter((d) => d.status !== "Paid").length,
  }), [deals]);

  function openAdd() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setShowForm(true);
  }

  function openEdit(deal: Deal) {
    setForm({
      brand:       deal.brand,
      value:       String(deal.value),
      status:      deal.status,
      deliverable: deal.deliverable,
      due_date:    deal.due_date,
      notes:       deal.notes,
    });
    setEditingId(deal.id);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = Number(form.value);
    if (!form.brand.trim() || isNaN(parsed) || parsed < 0) return;

    const payload = {
      brand:       form.brand.trim(),
      value:       parsed,
      status:      form.status,
      deliverable: form.deliverable,
      due_date:    form.due_date,
      notes:       form.notes.trim(),
    };

    if (editingId) {
      updateDeal(editingId, payload);
    } else {
      addDeal(payload);
    }
    closeForm();
  }

  return (
    <div className="space-y-6">
      {/* Page title */}
      <div>
        <h2 className="text-lg font-semibold text-[#1A1A1A]">Deals</h2>
        <p className="text-xs text-[#1A1A1A]/40 mt-0.5">Brand partnership opportunities</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <SummaryCard
          title="Confirmed"
          value={`$${confirmedTotal.toLocaleString()} CAD`}
          icon={<CheckCircle2 className="w-5 h-5 text-sky-500 opacity-60" />}
        />
        <SummaryCard
          title="Pending"
          value={`$${pendingTotal.toLocaleString()} CAD`}
          icon={<Handshake className="w-5 h-5 text-amber-500 opacity-60" />}
        />
        <SummaryCard
          title="Active Deals"
          value={String(activeCount)}
          icon={<DollarSign className="w-5 h-5 text-emerald-500 opacity-60" />}
        />
      </div>

      {!showForm ? (
        <button
          onClick={openAdd}
          className="flex items-center gap-2 text-sm text-white bg-[#A05A6A] hover:bg-[#8B4A5C] rounded-xl px-4 py-3 w-full justify-center transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add New Deal
        </button>
      ) : (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <CardTitle>{editingId ? "Edit Deal" : "New Deal"}</CardTitle>
            <button onClick={closeForm} className="text-[#1A1A1A]/40 hover:text-[#1A1A1A] transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={LABEL_CLASS}>Brand Name</label>
                <input
                  className={INPUT_CLASS}
                  placeholder="e.g. CeraVe Canada"
                  value={form.brand}
                  onChange={(e) => setForm({ ...form, brand: e.target.value })}
                  required
                />
              </div>
              <div>
                <label className={LABEL_CLASS}>Value (CAD)</label>
                <input
                  className={INPUT_CLASS}
                  type="number"
                  min="0"
                  placeholder="500"
                  value={form.value}
                  onChange={(e) => setForm({ ...form, value: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <SelectField
                label="Status"
                value={form.status}
                options={STATUSES}
                onChange={(v) => setForm({ ...form, status: v as DealStatus })}
              />
              <SelectField
                label="Deliverable"
                value={form.deliverable}
                options={DELIVERABLES}
                onChange={(v) => setForm({ ...form, deliverable: v as DeliverableType })}
              />
            </div>

            <div>
              <label className={LABEL_CLASS}>Due Date</label>
              <input
                className={INPUT_CLASS}
                type="date"
                value={form.due_date}
                onChange={(e) => setForm({ ...form, due_date: e.target.value })}
              />
            </div>

            <div>
              <label className={LABEL_CLASS}>Notes</label>
              <textarea
                className={`${INPUT_CLASS} resize-none`}
                rows={2}
                placeholder="Usage rights, posting window, etc."
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={closeForm}
                className="px-4 py-2 text-sm text-[#1A1A1A]/40 hover:text-[#1A1A1A] transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-sm bg-[#A05A6A] hover:bg-[#8B4A5C] text-white rounded-lg transition-colors"
              >
                {editingId ? "Save Changes" : "Add Deal"}
              </button>
            </div>
          </form>
        </Card>
      )}

      {deals.length === 0 ? (
        <p className="text-[#1A1A1A]/30 text-sm text-center py-8">No deals yet. Add your first one above.</p>
      ) : (
        <div className="space-y-3">
          {deals.map((deal) => (
            <div key={deal.id} className="bg-white border border-[#1A1A1A]/8 rounded-xl p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <span className="text-[#1A1A1A] font-semibold text-sm">{deal.brand}</span>
                    <StatusBadge status={deal.status} />
                    <span className="text-[#1A1A1A]/40 text-xs border border-[#1A1A1A]/10 rounded-full px-2 py-0.5">
                      {deal.deliverable}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-[#1A1A1A]/50">
                    <span className="text-[#1A1A1A] font-semibold text-sm">
                      ${deal.value.toLocaleString()} CAD
                    </span>
                    {deal.due_date && (
                      <span>Due {formatDate(deal.due_date + "T00:00:00")}</span>
                    )}
                  </div>
                  {deal.notes && (
                    <p className="text-[#1A1A1A]/40 text-xs mt-1.5 line-clamp-2">{deal.notes}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => openEdit(deal)}
                    className="p-1.5 text-[#1A1A1A]/30 hover:text-[#1A1A1A] transition-colors rounded-lg hover:bg-[#1A1A1A]/5"
                    aria-label="Edit deal"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => deleteDeal(deal.id)}
                    className="p-1.5 text-[#1A1A1A]/30 hover:text-rose-500 transition-colors rounded-lg hover:bg-[#1A1A1A]/5"
                    aria-label="Delete deal"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
