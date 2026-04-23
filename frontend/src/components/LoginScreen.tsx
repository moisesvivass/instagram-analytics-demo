import { FormEvent, useState } from "react";
import { Lock } from "lucide-react";
import { setCredentials } from "@/services/api";

interface LoginScreenProps {
  onSuccess: () => void;
}

export function LoginScreen({ onSuccess }: LoginScreenProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!username || !password) return;

    setLoading(true);
    setError(null);

    try {
      const baseUrl = import.meta.env.VITE_API_BASE_URL as string;
      const encoded = btoa(`${username}:${password}`);
      const res = await fetch(`${baseUrl}/api/instagram/overview`, {
        headers: { Authorization: `Basic ${encoded}` },
      });

      if (res.status === 401) {
        setError("Invalid credentials. Please try again.");
      } else if (!res.ok) {
        setError("Cannot connect to server. Check that the backend is running.");
      } else {
        setCredentials(username, password);
        onSuccess();
      }
    } catch {
      setError("Cannot reach the server. Is the backend running?");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F5F5F5] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo + titles */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[#F5EEF0] border border-[#EAC5CC] mb-4">
            <Lock className="w-5 h-5 text-[#C4788A]" />
          </div>
          <h1
            className="text-2xl font-semibold text-[#6B2A3A]"
            style={{ fontFamily: "'Playfair Display', Georgia, serif" }}
          >
            Demo Creator
          </h1>
          <p className="text-xs tracking-[0.18em] uppercase text-[#1A1A1A]/40 font-light mt-1">
            Command Center
          </p>
        </div>

        {/* Form card */}
        <div className="bg-white rounded-2xl border border-[#1A1A1A]/8 p-6 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs text-[#1A1A1A]/50 mb-1.5">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-white border border-[#1A1A1A]/15 rounded-full px-4 py-2.5 text-[#1A1A1A] text-sm placeholder-[#1A1A1A]/30 focus:outline-none focus:border-[#C4788A]/60 focus:ring-1 focus:ring-[#C4788A]/20"
                placeholder="username"
                autoComplete="username"
                required
              />
            </div>

            <div>
              <label className="block text-xs text-[#1A1A1A]/50 mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-white border border-[#1A1A1A]/15 rounded-full px-4 py-2.5 text-[#1A1A1A] text-sm placeholder-[#1A1A1A]/30 focus:outline-none focus:border-[#C4788A]/60 focus:ring-1 focus:ring-[#C4788A]/20"
                placeholder="••••••••"
                autoComplete="current-password"
                required
              />
            </div>

            {error && (
              <p className="text-rose-500 text-xs">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#A05A6A] hover:bg-[#8B4A5C] disabled:opacity-50 text-white font-medium py-2.5 rounded-full text-sm transition-colors mt-2"
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>

        </div>

        {/* Footer */}
        <p className="text-center text-[10px] text-[#1A1A1A]/30 mt-6 tracking-wide">
          Secured node · Curated environment · Analytics HQ
        </p>
      </div>
    </div>
  );
}
