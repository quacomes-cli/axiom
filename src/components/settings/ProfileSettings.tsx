import { useState, useRef } from "react";
import { motion } from "framer-motion";
import { User, Trash2, ShieldCheck, Plus, X, Download } from "lucide-react";
import { useUserProfileStore } from "../../stores/userProfileStore";

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 rounded-full transition-colors duration-200 ${checked ? "bg-blue-400" : "bg-surface-3"
        }`}
    >
      <motion.span
        animate={{ x: checked ? 15 : 1 }}
        transition={{ type: "spring", stiffness: 400, damping: 28 }}
        className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow"
      />
    </button>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-surface-3 px-2.5 py-1 text-[0.7857rem] text-text-secondary">
      {children}
    </span>
  );
}

function ChipRow({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mb-2.5">
      <div className="mb-1.5 text-[0.7857rem] uppercase tracking-wider text-text-faint">
        {label}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item, i) => (
          <Chip key={i}>{item}</Chip>
        ))}
      </div>
    </div>
  );
}

function FieldInput({
  label,
  value,
  placeholder,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <div className="mb-2.5">
      <div className="mb-1 text-[0.7857rem] uppercase tracking-wider text-text-faint">
        {label}
      </div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg bg-surface-3 px-3 py-1.5 text-[0.9286rem] text-text outline-none placeholder:text-text-faint/50 focus:ring-1 focus:ring-blue-400/40"
      />
    </div>
  );
}

function CustomFieldRow({
  field,
  onUpdate,
  onRemove,
}: {
  field: { key: string; value: string };
  onUpdate: (key: string, value: string) => void;
  onRemove: () => void;
}) {
  return (
    <div className="mb-1.5 flex items-center gap-1.5">
      <input
        value={field.key}
        onChange={(e) => onUpdate(e.target.value, field.value)}
        placeholder="Anahtar"
        className="w-[35%] rounded-lg bg-surface-3 px-2.5 py-1.5 text-[0.8571rem] text-text outline-none placeholder:text-text-faint/50 focus:ring-1 focus:ring-blue-400/40"
      />
      <input
        value={field.value}
        onChange={(e) => onUpdate(field.key, e.target.value)}
        placeholder="Değer"
        className="flex-1 rounded-lg bg-surface-3 px-2.5 py-1.5 text-[0.8571rem] text-text outline-none placeholder:text-text-faint/50 focus:ring-1 focus:ring-blue-400/40"
      />
      <button
        onClick={onRemove}
        className="rounded-lg p-1 text-text-faint hover:bg-surface-3 hover:text-red-400 transition-colors"
      >
        <X size={13} strokeWidth={1.5} />
      </button>
    </div>
  );
}

export function ProfileSettings() {
  const profile = useUserProfileStore((s) => s.profile);
  const enabled = useUserProfileStore((s) => s.enabled);
  const setEnabled = useUserProfileStore((s) => s.setEnabled);
  const resetProfile = useUserProfileStore((s) => s.resetProfile);
  const updateManualField = useUserProfileStore((s) => s.updateManualField);
  const addCustomField = useUserProfileStore((s) => s.addCustomField);
  const removeCustomField = useUserProfileStore((s) => s.removeCustomField);
  const updateCustomField = useUserProfileStore((s) => s.updateCustomField);
  const exportProfile = useUserProfileStore((s) => s.exportProfile);

  const [confirming, setConfirming] = useState(false);
  const downloadRef = useRef<HTMLAnchorElement>(null);

  const lastUpdatedText =
    profile.lastUpdated > 0
      ? new Date(profile.lastUpdated).toLocaleString("tr-TR")
      : "henüz güncellenmedi";

  function handleReset() {
    if (!confirming) {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 3000);
      return;
    }
    resetProfile();
    setConfirming(false);
  }

  function handleExport() {
    const json = exportProfile();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = downloadRef.current;
    if (a) {
      a.href = url;
      a.download = "axiom-profile.json";
      a.click();
      URL.revokeObjectURL(url);
    }
  }

  function handleAddCustom() {
    addCustomField("", "");
  }

  const customFields = profile.customFields ?? [];

  return (
    <div className="flex flex-col gap-3">
      {/* Hidden download anchor */}
      <a ref={downloadRef} className="hidden" />

      {/* Header card */}
      <div className="rounded-xl bg-surface-2 px-4 py-3.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <User size={16} strokeWidth={1.5} className="text-text-faint shrink-0" />
            <div className="min-w-0">
              <div className="text-[0.9286rem] text-text">Identification Engine</div>
              <div className="mt-0.5 text-xs text-text-faint">
                Konuşmalardan otomatik öğrenir, sohbetlere kişiselleştirme ekler.
              </div>
            </div>
          </div>
          <Toggle checked={enabled} onChange={setEnabled} />
        </div>
      </div>

      {/* Privacy note */}
      <div className="flex items-start gap-2.5 rounded-xl bg-surface-2 px-4 py-3">
        <ShieldCheck
          size={18}
          strokeWidth={1.5}
          className="mt-0.5 shrink-0 text-emerald-400/80"
        />
        <div className="text-xs leading-relaxed text-text-faint">
          Profil verileri sadece bu cihazda yerel olarak tutulur. Çıkarım yapılırken
          local Ollama (<code className="text-text-secondary">llama3.2:1b</code>)
          kullanılır, hiçbir uzak sunucuya gönderilmez.
        </div>
      </div>

      {/* Manual fields */}
      <div className="rounded-xl bg-surface-2 px-4 py-3.5">
        <div className="mb-3 text-[0.9286rem] text-text">Kişisel Bilgiler</div>
        <div className="grid grid-cols-2 gap-x-3">
          <FieldInput
            label="Ad"
            value={profile.name ?? ""}
            placeholder="Adınız"
            onChange={(v) => updateManualField("name", v)}
          />
          <FieldInput
            label="Soyad"
            value={profile.surname ?? ""}
            placeholder="Soyadınız"
            onChange={(v) => updateManualField("surname", v)}
          />
        </div>
        <FieldInput
          label="E-posta"
          value={profile.email ?? ""}
          placeholder="örnek@mail.com"
          type="email"
          onChange={(v) => updateManualField("email", v)}
        />
        <div className="grid grid-cols-2 gap-x-3">
          <FieldInput
            label="Konum"
            value={profile.location ?? ""}
            placeholder="İstanbul, Türkiye"
            onChange={(v) => updateManualField("location", v)}
          />
          <FieldInput
            label="Doğum Günü"
            value={profile.birthDate || ""}
            placeholder="01.01.2000"
            onChange={(val) => {
              let value = val.replace(/\D/g, "");

              if (value.length > 2 && value.length <= 4) {
                value = `${value.slice(0, 2)}.${value.slice(2)}`;
              } else if (value.length > 4) {
                value = `${value.slice(0, 2)}.${value.slice(2, 4)}.${value.slice(4, 8)}`;
              }

              updateManualField("birthDate", value);
            }}
          />
        </div>
        <FieldInput
          label="Meslek"
          value={profile.profession ?? ""}
          placeholder="Yazılım Mühendisi"
          onChange={(v) => updateManualField("profession", v)}
        />
      </div>

      {/* Custom key-value fields */}
      <div className="rounded-xl bg-surface-2 px-4 py-3.5">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[0.9286rem] text-text">Özel Alanlar</div>
          <button
            onClick={handleAddCustom}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-[0.7857rem] text-text-faint hover:bg-surface-3 hover:text-text-secondary transition-colors"
          >
            <Plus size={12} strokeWidth={1.5} />
            Ekle
          </button>
        </div>

        {customFields.length === 0 ? (
          <div className="py-4 text-center text-xs text-text-faint">
            Özel anahtar-değer ikilileri ekleyebilirsiniz.
          </div>
        ) : (
          customFields.map((field, i) => (
            <CustomFieldRow
              key={i}
              field={field}
              onUpdate={(key, value) => updateCustomField(i, key, value)}
              onRemove={() => removeCustomField(i)}
            />
          ))
        )}
      </div>

      {/* Auto-extracted profile content */}
      <div className="rounded-xl bg-surface-2 px-4 py-3.5">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[0.9286rem] text-text">Otomatik Çıkarılan</div>
          <div className="text-xs text-text-faint">
            {profile.factCount} fact &middot; {lastUpdatedText}
          </div>
        </div>

        {!profile.languagePreference && profile.interests.length === 0 && profile.jargon.length === 0 && profile.recurringTopics.length === 0 && profile.notes.length === 0 && !profile.responseStyle ? (
          <div className="py-4 text-center text-xs text-text-faint">
            Henüz otomatik bilgi çıkarılmadı. Birkaç sohbet sonrası burada görünür.
          </div>
        ) : (
          <div>
            {profile.languagePreference && (
              <div className="mb-2.5 flex items-baseline gap-2">
                <span className="text-[0.7857rem] uppercase tracking-wider text-text-faint">Dil:</span>
                <span className="text-[0.9286rem] text-text-secondary">{profile.languagePreference}</span>
              </div>
            )}
            {profile.responseStyle && (
              <div className="mb-2.5 flex items-baseline gap-2">
                <span className="text-[0.7857rem] uppercase tracking-wider text-text-faint">Yanıt tarzı:</span>
                <span className="text-[0.9286rem] text-text-secondary">{profile.responseStyle}</span>
              </div>
            )}
            <ChipRow label="İlgi alanları" items={profile.interests} />
            <ChipRow label="Jargon" items={profile.jargon} />
            <ChipRow label="Sık konular" items={profile.recurringTopics} />
            {profile.notes.length > 0 && (
              <div className="mt-2">
                <div className="mb-1.5 text-[0.7857rem] uppercase tracking-wider text-text-faint">
                  Notlar
                </div>
                <div className="space-y-1">
                  {profile.notes.map((note, i) => (
                    <div
                      key={i}
                      className="rounded-lg bg-surface-3 px-2.5 py-1.5 text-xs text-text-secondary"
                    >
                      {note}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          onClick={handleExport}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-surface-2 px-4 py-2.5 text-[0.9286rem] font-medium text-text-faint transition-colors hover:bg-surface-3 hover:text-text-secondary"
        >
          <Download size={13} strokeWidth={1.5} />
          JSON Olarak Dışa Aktar
        </button>

        {profile.factCount > 0 && (
          <button
            onClick={handleReset}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[0.9286rem] font-medium transition-colors ${confirming
              ? "bg-red-500/15 text-red-400 hover:bg-red-500/25"
              : "bg-surface-2 text-text-faint hover:bg-surface-3 hover:text-red-400"
              }`}
          >
            <Trash2 size={13} strokeWidth={1.5} />
            {confirming ? "Onaylamak için tekrar tıkla" : "Profili Sıfırla"}
          </button>
        )}
      </div>
    </div>
  );
}
