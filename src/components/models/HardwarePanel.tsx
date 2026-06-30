import { useEffect, useState } from "react";
import { Box, CircuitBoard, Monitor, RefreshCw } from "lucide-react";
import { ipc } from "../../lib/ipc";
import type { HardwareProfile } from "../../types";

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-surface-2 p-3.5 transition-colors duration-200 hover:bg-surface-3">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-hover text-text-faint">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[0.7857rem] uppercase tracking-widest text-text-faint">{label}</div>
        <div className="mt-0.5 truncate text-sm text-text-secondary">{value}</div>
      </div>
    </div>
  );
}

export function HardwarePanel() {
  const [profile, setProfile] = useState<HardwareProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setProfile(await ipc.hardwareProfile());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  const gb = (mb: number) => `${(mb / 1024).toFixed(1)} GB`;

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[0.7857rem] uppercase tracking-widest text-text-faint">
          Donanım
        </h2>
        <button
          onClick={load}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-text-faint transition-all duration-200 hover:bg-hover hover:text-text-secondary"
        >
          <RefreshCw size={12} strokeWidth={1.4} className={loading ? "animate-spin" : ""} />
          Yenile
        </button>
      </div>

      {error && (
        <div className="rounded-xl bg-[rgba(248,113,113,0.06)] p-3 text-sm text-danger">
          Profil alınamadı: {error}
        </div>
      )}

      {!profile && !error && (
        <div className="grid grid-cols-2 gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-xl bg-surface-2 p-3.5">
              <div className="h-8 w-8 animate-pulse rounded-lg bg-hover" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="h-2.5 w-10 animate-pulse rounded bg-hover" />
                <div className="h-3.5 w-24 animate-pulse rounded bg-hover" />
              </div>
            </div>
          ))}
        </div>
      )}

      {profile && (
        <div className="grid grid-cols-2 gap-2">
          <Stat
            icon={<CircuitBoard size={15} strokeWidth={1.3} />}
            label="CPU"
            value={`${profile.cpuBrand} (${profile.cpuCoresPhysical}C/${profile.cpuCoresLogical}T)`}
          />
          <Stat
            icon={<Box size={15} strokeWidth={1.3} />}
            label="RAM"
            value={`${gb(profile.availableRamMb)} boş / ${gb(profile.totalRamMb)}`}
          />
          <Stat
            icon={<Monitor size={15} strokeWidth={1.3} />}
            label="GPU"
            value={
              profile.gpuName
                ? `${profile.gpuName}${profile.gpuVramMb ? ` — ${gb(profile.gpuVramMb)}` : ""}`
                : "Tespit edilmedi"
            }
          />
          <Stat
            icon={<Monitor size={15} strokeWidth={1.3} />}
            label="İşletim Sistemi"
            value={profile.osName}
          />
        </div>
      )}
    </section>
  );
}
