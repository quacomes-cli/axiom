import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { ipc } from "../lib/ipc";
import type { InstalledSkill, SkillInfo } from "../types";

interface SkillState {
  availableSkills: SkillInfo[];
  installedSkills: InstalledSkill[];
  loading: boolean;
  searchQuery: string;
  activeTab: "discover" | "installed";

  setActiveTab: (tab: "discover" | "installed") => void;
  setSearchQuery: (q: string) => void;
  fetchSkills: (query?: string) => Promise<void>;
  installSkill: (skill: SkillInfo) => Promise<void>;
  uninstallSkill: (id: string) => void;
  toggleSkill: (id: string) => void;
  getActivePrompts: () => string[];
}

export const useSkillStore = create<SkillState>()(
  persist(
    (set, get) => ({
      availableSkills: [],
      installedSkills: [],
      loading: false,
      searchQuery: "",
      activeTab: "discover",

      setActiveTab: (tab) => set({ activeTab: tab }),
      setSearchQuery: (q) => set({ searchQuery: q }),

      fetchSkills: async (query) => {
        set({ loading: true });
        try {
          const skills = await ipc.skillsDiscover(query);
          set({ availableSkills: skills });
        } catch {
          // silently fail
        } finally {
          set({ loading: false });
        }
      },

      installSkill: async (skill) => {
        const parts = skill.id.split("/");
        if (parts.length !== 2) return;
        try {
          const content = await ipc.skillsFetchContent(parts[0], parts[1]);
          const installed: InstalledSkill = {
            id: skill.id,
            name: skill.name,
            description: skill.description,
            author: skill.author,
            systemPrompt: content.prompt,
            enabled: true,
            installedAt: Date.now(),
            sourceUrl: skill.url,
          };
          set((s) => ({
            installedSkills: [...s.installedSkills, installed],
          }));
        } catch (e) {
          throw e;
        }
      },

      uninstallSkill: (id) => {
        set((s) => ({
          installedSkills: s.installedSkills.filter((sk) => sk.id !== id),
        }));
      },

      toggleSkill: (id) => {
        set((s) => ({
          installedSkills: s.installedSkills.map((sk) =>
            sk.id === id ? { ...sk, enabled: !sk.enabled } : sk
          ),
        }));
      },

      getActivePrompts: () => {
        return get()
          .installedSkills.filter((sk) => sk.enabled)
          .map((sk) => sk.systemPrompt);
      },
    }),
    {
      name: "axiom-skills",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) =>
        ({
          installedSkills: state.installedSkills,
        }) as unknown as SkillState,
    }
  )
);
