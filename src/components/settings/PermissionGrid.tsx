import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { LevelControl } from "./LevelControl";
import { ChipList } from "./ChipList";
import { ipc } from "../../lib/ipc";
import type { PermissionConfig, PermissionLevel } from "../../types";

type SaveState = "idle" | "saving" | "saved";

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-surface p-4">
      <div className="mb-3 text-[0.7857rem] uppercase tracking-widest text-text-faint">
        {title}
      </div>
      <div className="space-y-1">{children}</div>
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
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <div className="font-mono text-[0.9286rem] text-text-secondary">{label}</div>
          {hint && <div className="mt-0.5 text-xs text-text-faint">{hint}</div>}
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

  useEffect(() => {
    ipc
      .permissionsGet()
      .then(setConfig)
      .catch((e) => setError(String(e)));
  }, []);

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
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-text-faint">
          Whitelist-first: varsayılan her şey kapalı, sen açarsın.
        </p>
        <div className="flex h-6 items-center gap-1.5 text-xs text-text-faint">
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
        <Group title="Filesystem">
          <Row
            label="read"
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
            label="write"
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
            label="delete"
            hint="Yıkıcı işlem — varsayılan engelli"
            level={config.filesystem.delete}
            onLevel={(l) => patch((d) => (d.filesystem.delete = l))}
          />
          <Row
            label="watch"
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

        <Group title="Process">
          <Row
            label="launch"
            hint="Whitelist boşsa tüm uygulamalar (seviyeye göre) izinli"
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
            label="kill"
            level={config.process.kill}
            onLevel={(l) => patch((d) => (d.process.kill = l))}
          />
          <Row
            label="list"
            level={config.process.list}
            onLevel={(l) => patch((d) => (d.process.list = l))}
          />
        </Group>

        <Group title="Network">
          <Row
            label="outbound"
            level={config.network.outbound}
            onLevel={(l) => patch((d) => (d.network.outbound = l))}
          />
          <Row
            label="localhost"
            level={config.network.localhost}
            onLevel={(l) => patch((d) => (d.network.localhost = l))}
          />
          <div className="rounded-xl bg-surface-2 px-3.5 py-2.5">
            <div className="font-mono text-[0.9286rem] text-text-secondary">
              blocked_domains
            </div>
            <ChipList
              items={config.network.blocked_domains}
              onChange={(b) => patch((d) => (d.network.blocked_domains = b))}
              placeholder="example.com"
              mono
            />
          </div>
        </Group>

        <Group title="Shell">
          <Row
            label="execute"
            level={config.shell.execute}
            onLevel={(l) => patch((d) => (d.shell.execute = l))}
          />
          <div className="rounded-xl bg-surface-2 px-3.5 py-2.5">
            <div className="font-mono text-[0.9286rem] text-text-secondary">
              blocked_commands
            </div>
            <ChipList
              items={config.shell.blocked_commands}
              onChange={(b) => patch((d) => (d.shell.blocked_commands = b))}
              placeholder="rm -rf"
              mono
            />
          </div>
        </Group>

        <Group title="Screen">
          <Row
            label="capture"
            level={config.screen.capture}
            onLevel={(l) => patch((d) => (d.screen.capture = l))}
          />
          <Row
            label="continuous_watch"
            level={config.screen.continuous_watch}
            onLevel={(l) => patch((d) => (d.screen.continuous_watch = l))}
          />
        </Group>
      </div>
    </div>
  );
}
