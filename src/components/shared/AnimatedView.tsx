import { lazy, Suspense } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { useUiStore } from "../../stores/uiStore";
// Varsayılan görünüm — açılışta anında lazım, eager kalır.
import { ChatPanel } from "../chat/ChatPanel";
import type { ViewId } from "../../types";

// Diğer sayfalar lazy: ilk yük chunk'ına girmezler, ilk ziyarette inerler
// (sonrası cache). Named export'lar default'a sarılır.
const CodeToolPage = lazy(() =>
  import("../code/CodeToolPage").then((m) => ({ default: m.CodeToolPage })),
);
const ModelExplore = lazy(() =>
  import("../models/ModelExplore").then((m) => ({ default: m.ModelExplore })),
);
const ModelManage = lazy(() =>
  import("../models/ModelManage").then((m) => ({ default: m.ModelManage })),
);
const AcceleratePage = lazy(() =>
  import("../models/AcceleratePage").then((m) => ({ default: m.AcceleratePage })),
);
const AppsHub = lazy(() => import("../apps/AppsHub").then((m) => ({ default: m.AppsHub })));
const SkillsPanel = lazy(() =>
  import("../skills/SkillsPanel").then((m) => ({ default: m.SkillsPanel })),
);
const TaskBoard = lazy(() =>
  import("../tasks/TaskBoard").then((m) => ({ default: m.TaskBoard })),
);
const TelegramInbox = lazy(() =>
  import("../telegram/TelegramInbox").then((m) => ({ default: m.TelegramInbox })),
);
const PriceTrackerPage = lazy(() =>
  import("../price/PriceTrackerPage").then((m) => ({ default: m.PriceTrackerPage })),
);
const SettingsPage = lazy(() =>
  import("../settings/SettingsPage").then((m) => ({ default: m.SettingsPage })),
);

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

function ViewFallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <Loader2 size={22} className="animate-spin text-text-faint" />
    </div>
  );
}

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
          <Suspense fallback={<ViewFallback />}>
            <Component />
          </Suspense>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
