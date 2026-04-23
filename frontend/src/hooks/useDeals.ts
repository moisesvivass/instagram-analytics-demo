import { useState } from "react";
import type { Deal } from "@/types";

const STORAGE_KEY = "demo_deals";

function loadDeals(): Deal[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Deal[]) : [];
  } catch {
    return [];
  }
}

function saveDeals(deals: Deal[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(deals));
}

export function useDeals() {
  const [deals, setDeals] = useState<Deal[]>(loadDeals);

  function addDeal(deal: Omit<Deal, "id" | "created_at">): void {
    const next: Deal = {
      ...deal,
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
    };
    const updated = [next, ...deals];
    saveDeals(updated);
    setDeals(updated);
  }

  function updateDeal(id: string, patch: Omit<Deal, "id" | "created_at">): void {
    const updated = deals.map((d) => (d.id === id ? { ...d, ...patch } : d));
    saveDeals(updated);
    setDeals(updated);
  }

  function deleteDeal(id: string): void {
    const updated = deals.filter((d) => d.id !== id);
    saveDeals(updated);
    setDeals(updated);
  }

  return { deals, addDeal, updateDeal, deleteDeal };
}
