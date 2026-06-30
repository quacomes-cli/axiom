import { AnimatePresence, motion } from "framer-motion";
import { useUiStore } from "../../stores/uiStore";
import { ChatPanel } from "../chat/ChatPanel";
import { TaskBoard } from "../tasks/TaskBoard";
import { ModelExplore } from "../models/ModelExplore";
import { ModelManage } from "../models/ModelManage";
import { AcceleratePage } from "../models/AcceleratePage";
import { CodeToolPage } from "../code/CodeToolPage";
import { SkillsPanel } from "../skills/SkillsPanel";
import { AppsHub } from "../apps/AppsHub";
import { TelegramInbox } from "../telegram/TelegramInbox";
import { PriceTrackerPage } from "../price/PriceTrackerPage";
import { SettingsPage } from "../settings/SettingsPage";
import type { ViewId } from "../../types";

const VIEWS: Record<ViewId, React.FC> = {
  chat: ChatPanel,
  code: CodeToolPage,
  models: ModelExplore,
  "models-manage": ModelManage,
  accelerate: AcceleratePage,
  apps: AppsHub,
  skills: SkillsPanel,
  tasks: TaskBoard,
  telegram: TelegramInbox,
  "price-tracker": PriceTrackerPage,
  settings: SettingsPage,
};

const variants = {
  enter: (d: number) => ({ y: `${d * 100}%` }),
  center: { y: 0 },
  exit: (d: number) => ({ y: `${d * -100}%` }),
};

export function AnimatedView() {
  const view = useUiStore((s) => s.view);
  const direction = useUiStore((s) => s.direction);
  const Component = VIEWS[view];

  return (
    <div className="relative h-full overflow-hidden">
      <AnimatePresence initial={false} mode="popLayout" custom={direction}>
        <motion.div
          key={view}
          custom={direction}
          variants={variants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: 0.35, ease: [0.32, 0.72, 0, 1] }}
          className="absolute inset-0"
        >
          <Component />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
