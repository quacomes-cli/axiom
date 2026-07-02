import { useCallback, useEffect, useState } from "react";
import { Check, FolderOpen, Globe, Loader2, Monitor, Play, ShieldCheck, Terminal } from "lucide-react";
import { LevelControl } from "./LevelControl";
import { ChipList } from "./ChipList";
import { ipc } from "../../lib/ipc";
import type { PermissionConfig, PermissionLevel } from "../../types";

type SaveState = "idle" | "saving" | "saved";

function Group({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-surface p-4">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-2 text-text-secondary">
          {icon}
        </span>
        <div>
          <div className="text-[0.8571rem] font-medium text-text">{title}</div>
          {subtitle && <div className="text-xs text-text-faint">{subtitle}</div>}
        </div>
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Row({
  label,
  hint,
  level,
  onLevel,
  children,
}: {
  label: string;
  hint?: string;
  level: PermissionLevel;
  onLevel: (l: PermissionLevel) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl bg-surface-2 px-3.5 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[0.9286rem] text-text-secondary">{label}</div>
          {hint && <div className="mt-0.5 text-xs leading-snug text-text-faint">{hint}</div>}
        </div>
        <LevelControl value={level} onChange={onLevel} />
      </div>
      {children}
    </div>
  );
}

export function PermissionGrid() {
  const [config, setConfig] = useState<PermissionConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>("idle");

  const load = useCallback(() => {
    ipc
      .permissionsGet()
      .then(setConfig)
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    load();
    // Onay kartından "Her zaman izin ver" seçildiğinde config Rust tarafında
    // değişir — pencere odağa dönünce yeniden yükle ki sayfa taze kalsın.
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, [load]);

  function patch(mutator: (draft: PermissionConfig) => void) {
    setConfig((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      mutator(next);
      setSave("saving");
      ipc
        .permissionsSet(next)
        .then(() => {
          setSave("saved");
          setTimeout(() => setSave("idle"), 1500);
        })
        .catch((e) => setError(String(e)));
      return next;
    });
  }

  if (error) {
    return (
      <div className="rounded-xl bg-[rgba(248,113,113,0.06)] p-3 text-sm text-danger">
        İzinler yüklenemedi: {error}
      </div>
    );
  }

  if (!config) {
    return (
      <div className="flex items-center justify-center py-8 text-text-faint">
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-start justify-between gap-4">
        <div className="flex items-start gap-2 text-xs leading-relaxed text-text-faint">
          <ShieldCheck size={14} className="mt-0.5 shrink-0" />
          <p>
            Varsayılan her şey kapalıdır; sen açarsın. "Sor" seviyesindeki işlemler
            sağ altta onay kartı çıkarır — karttaki <span className="text-text-secondary">"Her zaman"</span> seçimi
            buradaki kuralı kalıcı günceller.
          </p>
        </div>
        <div className="flex h-6 shrink-0 items-center gap-1.5 text-xs text-text-faint">
          {save === "saving" && <Loader2 size={13} className="animate-spin" />}
          {save === "saved" && (
            <>
              <Check size={13} className="text-success" />
              Kaydedildi
            </>
          )}
        </div>
      </div>

      <div className="space-y-2.5">
        <Group
          icon={<FolderOpen size={15} strokeWidth={1.6} />}
          title="Dosya Sistemi"
          subtitle="Listedeki dizinler sınırdır — dışındaki yollar her zaman sorulur"
        >
          <Row
            label="Okuma"
            hint="Modelin dosya ve dizin okuyabildiği kökler"
            level={config.filesystem.read.level}
            onLevel={(l) => patch((d) => (d.filesystem.read.level = l))}
          >
            <ChipList
              items={config.filesystem.read.paths}
              onChange={(p) => patch((d) => (d.filesystem.read.paths = p))}
              placeholder="~/Documents"
              mono
            />
          </Row>
          <Row
            label="Yazma"
            hint="Dosya oluşturma ve üzerine yazma kökleri"
            level={config.filesystem.write.level}
            onLevel={(l) => patch((d) => (d.filesystem.write.level = l))}
          >
            <ChipList
              items={config.filesystem.write.paths}
              onChange={(p) => patch((d) => (d.filesystem.write.paths = p))}
              placeholder="~/Documents/axiom-out"
              mono
            />
          </Row>
          <Row
            label="Silme"
            hint="Yıkıcı işlem — varsayılan engelli"
            level={config.filesystem.delete}
            onLevel={(l) => patch((d) => (d.filesystem.delete = l))}
          />
          <Row
            label="İzleme"
            hint="Dizin değişikliklerini takip etme"
            level={config.filesystem.watch.level}
            onLevel={(l) => patch((d) => (d.filesystem.watch.level = l))}
          >
            <ChipList
              items={config.filesystem.watch.paths}
              onChange={(p) => patch((d) => (d.filesystem.watch.paths = p))}
              placeholder="~/Downloads"
              mono
            />
          </Row>
        </Group>

        <Group
          icon={<Play size={15} strokeWidth={1.6} />}
          title="Süreçler"
          subtitle="Uygulama başlatma ve süreç yönetimi"
        >
          <Row
            label="Başlatma"
            hint="Whitelist boşsa tüm uygulamalar seviyeye tabidir"
            level={config.process.launch}
            onLevel={(l) => patch((d) => (d.process.launch = l))}
          >
            <ChipList
              items={config.process.launch_whitelist}
              onChange={(w) => patch((d) => (d.process.launch_whitelist = w))}
              placeholder="code"
              mono
            />
          </Row>
          <Row
            label="Sonlandırma"
            level={config.process.kill}
            onLevel={(l) => patch((d) => (d.process.kill = l))}
          />
          <Row
            label="Listeleme"
            level={config.process.list}
            onLevel={(l) => patch((d) => (d.process.list = l))}
          />
        </Group>

        <Group
          icon={<Globe size={15} strokeWidth={1.6} />}
          title="Ağ"
          subtitle="Web araması, hava durumu, döviz gibi araçların internet erişimi"
        >
          <Row
            label="Dış bağlantı"
            hint="İnternete giden istekler (web_search, weather, currency…)"
            level={config.network.outbound}
            onLevel={(l) => patch((d) => (d.network.outbound = l))}
          />
          <Row
            label="Localhost"
            hint="Yerel servislere erişim (Ollama vb.)"
            level={config.network.localhost}
            onLevel={(l) => patch((d) => (d.network.localhost = l))}
          />
          <div className="rounded-xl bg-surface-2 px-3.5 py-2.5">
            <div className="text-[0.9286rem] text-text-secondary">Engelli alan adları</div>
            <div className="mt-0.5 text-xs text-text-faint">Bu alanlara istek her koşulda reddedilir</div>
            <ChipList
              items={config.network.blocked_domains}
              onChange={(b) => patch((d) => (d.network.blocked_domains = b))}
              placeholder="example.com"
              mono
            />
          </div>
        </Group>

        <Group
          icon={<Terminal size={15} strokeWidth={1.6} />}
          title="Kabuk"
          subtitle="Modelin komut satırı çalıştırması"
        >
          <Row
            label="Komut çalıştırma"
            hint='"Sor" önerilir — her komut onay kartına düşer'
            level={config.shell.execute}
            onLevel={(l) => patch((d) => (d.shell.execute = l))}
          />
          <div className="rounded-xl bg-surface-2 px-3.5 py-2.5">
            <div className="text-[0.9286rem] text-text-secondary">Engelli komut kalıpları</div>
            <div className="mt-0.5 text-xs text-text-faint">
              Bu kalıpları içeren komutlar seviye ne olursa olsun reddedilir
            </div>
            <ChipList
              items={config.shell.blocked_commands}
              onChange={(b) => patch((d) => (d.shell.blocked_commands = b))}
              placeholder="rm -rf"
              mono
            />
          </div>
        </Group>

        <Group
          icon={<Monitor size={15} strokeWidth={1.6} />}
          title="Ekran"
          subtitle="Ekran görüntüsü ve izleme"
        >
          <Row
            label="Ekran yakalama"
            level={config.screen.capture}
            onLevel={(l) => patch((d) => (d.screen.capture = l))}
          />
          <Row
            label="Sürekli izleme"
            hint="Ekranın periyodik takibi — varsayılan engelli"
            level={config.screen.continuous_watch}
            onLevel={(l) => patch((d) => (d.screen.continuous_watch = l))}
          />
        </Group>
      </div>
    </div>
  );
}
