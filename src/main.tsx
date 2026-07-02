import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import { PalettePage } from "./components/palette/PalettePage";
import { ErrorBoundary } from "./components/shared/ErrorBoundary";
import "./styles/index.css";

// Çoklu pencere yönlendirmesi: aynı bundle her pencerede yüklenir, pencere
// etiketi hangi kökün render edileceğini seçer. Palet penceresi App'i (ve
// onun arka plan hook'larını — updater, telegram, scheduler...) YÜKLEMEZ;
// aksi halde her hook iki pencerede birden çalışırdı.
const isPalette = getCurrentWindow().label === "palette";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      {isPalette ? <PalettePage /> : <App />}
    </ErrorBoundary>
  </React.StrictMode>,
);
