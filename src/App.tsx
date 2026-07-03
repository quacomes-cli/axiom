import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield,
  Activity,
  Download as DownloadIcon,
  Github,
  ExternalLink,
  Monitor
} from "lucide-react";
import { FiEyeOff, FiCpu, FiMoon } from "react-icons/fi";
import logo from "../public/logo.svg";
import { FaWindows } from "react-icons/fa6";

// Page definition type
type PageId = "home" | "releases" | "download";

interface GitHubRelease {
  id: number;
  name: string;
  tag_name: string;
  published_at: string;
  body: string;
}

interface LatestReleaseInfo {
  tag: string;
  version: string;
  assets: { name: string; url: string }[];
}

export default function App() {
  const [activePage, setActivePage] = useState<PageId>("home");
  const [latestRelease, setLatestRelease] = useState<LatestReleaseInfo | null>(null);

  useEffect(() => {
    async function fetchLatestRelease() {
      try {
        const response = await fetch("https://api.github.com/repos/quacomes-cli/axiom/releases/latest");
        if (response.ok) {
          const data = await response.json();
          const tag = data.tag_name || "v0.1.4";
          const version = tag.startsWith("v") ? tag.substring(1) : tag;
          const assets = (data.assets || []).map((asset: any) => ({
            name: asset.name,
            url: asset.browser_download_url
          }));
          setLatestRelease({ tag, version, assets });
        }
      } catch (err) {
        console.error("Latest release fetch failed: ", err);
      }
    }
    fetchLatestRelease();
  }, []);

  // Smooth scroll to top when page changes
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [activePage]);

  // Framer Motion transition parameters
  const pageVariants = {
    initial: { opacity: 0, y: 15 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -15 }
  };

  const pageTransition = {
    duration: 0.25,
    ease: "easeOut" as const
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <header>
        <div className="container nav-container">
          <a href="#" className="logo-group" onClick={(e) => { e.preventDefault(); setActivePage("home"); }}>
            <div className="logo-icon">
              <img src={logo} alt="Axiom Logo" />
            </div>
            <span className="baslik">
              Axiom
            </span>
          </a>
          <nav>
            <ul>
              <li>
                <a
                  href="#home"
                  className={activePage === "home" ? "active-nav" : ""}
                  onClick={(e) => { e.preventDefault(); setActivePage("home"); }}
                >
                  Anasayfa
                </a>
              </li>
              <li>
                <a
                  href="#releases"
                  className={activePage === "releases" ? "active-nav" : ""}
                  onClick={(e) => { e.preventDefault(); setActivePage("releases"); }}
                >
                  Sürüm Notları
                </a>
              </li>
              <li>
                <a
                  href="#download"
                  className={activePage === "download" ? "active-nav" : ""}
                  onClick={(e) => { e.preventDefault(); setActivePage("download"); }}
                >
                  İndir
                </a>
              </li>
            </ul>
          </nav>
        </div>
      </header>

      {/* Main Content Area */}
      <main style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems :"center" }}>
        <AnimatePresence mode="wait">
          {activePage === "home" && (
            <motion.div
              key="home"
              initial="initial"
              animate="animate"
              exit="exit"
              variants={pageVariants}
              transition={pageTransition}
            >
              <HomePage onNavigate={setActivePage} />
            </motion.div>
          )}
          {activePage === "releases" && (
            <motion.div
              key="releases"
              initial="initial"
              animate="animate"
              exit="exit"
              variants={pageVariants}
              transition={pageTransition}
            >
              <ReleasesPage />
            </motion.div>
          )}
          {activePage === "download" && (
            <motion.div
              key="download"
              initial="initial"
              animate="animate"
              exit="exit"
              variants={pageVariants}
              transition={pageTransition}
            >
              <DownloadPage latestRelease={latestRelease} />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer>
        <div className="container footer-content">
          <div>
            <p>&copy; {new Date().getFullYear()} <a href="https://quacomes.com" target="_blank">Quacomes</a>. Tüm hakları saklıdır.</p>
          </div>
          <ul className="footer-links">
            <li>
              <a href="#home" onClick={(e) => { e.preventDefault(); setActivePage("home"); }}>
                Anasayfa
              </a>
            </li>
            <li>
              <a href="#releases" onClick={(e) => { e.preventDefault(); setActivePage("releases"); }}>
                Sürümler
              </a>
            </li>
            <li>
              <a href="#releases" onClick={(e) => { e.preventDefault(); setActivePage("download"); }}>
                İndir
              </a>
            </li>
          </ul>
        </div>
      </footer>
    </div>
  );
}

/* ---------------- ANIMATED SLEEP CLOCK ---------------- */
function AnimatedSleepClock() {
  return (
    <div style={{ position: "relative", width: "100px", height: "100px", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div className="orbit-line-1"></div>
      <div className="orbit-line-2"></div>
      <FiMoon size={36} strokeWidth={1.2} style={{ color: "var(--text-secondary)", zIndex: 2 }} className="moon-pulse" />
    </div>
  );
}

/* ---------------- HOME PAGE ---------------- */
function HomePage({ onNavigate }: { onNavigate: (page: PageId) => void }) {

  return (
    <section className="hero-section container" >
      <motion.div
        className="hero-grid"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
      >
        <div className="hero-seed-container">
          <img src="/man.gif" height={420} />
        </div>

        <div>
          <h1 className="editorial-title">Axiom</h1>
          <div className="editorial-tagline">Small devices, big results.</div>
          <div className="editorial-subtagline">The age of Personal AI</div>

          <div className="hero-ctas">
            <button onClick={() => onNavigate("download")} className="btn btn-primary">
              <DownloadIcon size={14} />
              Axiom'u İndir
            </button>
          </div>
        </div>
      </motion.div>
    </section >


  );
}

/* ---------------- RELEASES PAGE ---------------- */
function ReleasesPage() {
  const [releases, setReleases] = useState<GitHubRelease[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchReleases() {
      try {
        const response = await fetch("https://api.github.com/repos/quacomes-cli/axiom/releases");
        if (!response.ok) {
          throw new Error("Sürüm notları yüklenirken hata oluştu.");
        }
        const data = await response.json();
        setReleases(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Bilinmeyen hata");
      } finally {
        setLoading(false);
      }
    }
    fetchReleases();
  }, []);

  // Extremely basic parser for release bodies (monochrome markdown notes format helper)
  const renderReleaseBody = (body: string) => {
    if (!body) return <p>Detaylı açıklama bulunmuyor.</p>;

    const lines = body.split("\n");
    let inList = false;
    const elements: React.ReactNode[] = [];
    let listItems: string[] = [];

    lines.forEach((line, index) => {
      const trimmed = line.trim();

      // Headers
      if (trimmed.startsWith("###")) {
        if (inList) {
          elements.push(
            <ul key={`list-${index}`}>
              {listItems.map((item, i) => <li key={i} dangerouslySetInnerHTML={{ __html: formatInline(item) }}></li>)}
            </ul>
          );
          inList = false;
          listItems = [];
        }
        elements.push(<h3 key={`h3-${index}`}>{trimmed.replace("###", "").trim()}</h3>);
      } else if (trimmed.startsWith("##")) {
        if (inList) {
          elements.push(
            <ul key={`list-${index}`}>
              {listItems.map((item, i) => <li key={i} dangerouslySetInnerHTML={{ __html: formatInline(item) }}></li>)}
            </ul>
          );
          inList = false;
          listItems = [];
        }
        elements.push(<h2 key={`h2-${index}`}>{trimmed.replace("##", "").trim()}</h2>);
      }
      // Lists
      else if (trimmed.startsWith("-") || trimmed.startsWith("*")) {
        inList = true;
        listItems.push(trimmed.substring(1).trim());
      }
      // Paragraph or empty line
      else {
        if (trimmed === "") {
          if (inList) {
            elements.push(
              <ul key={`list-${index}`}>
                {listItems.map((item, i) => <li key={i} dangerouslySetInnerHTML={{ __html: formatInline(item) }}></li>)}
              </ul>
            );
            inList = false;
            listItems = [];
          }
        } else {
          if (inList) {
            // Continuation of list or normal line
            listItems.push(trimmed);
          } else {
            elements.push(<p key={`p-${index}`} style={{ marginBottom: "10px" }} dangerouslySetInnerHTML={{ __html: formatInline(trimmed) }}></p>);
          }
        }
      }
    });

    if (inList && listItems.length > 0) {
      elements.push(
        <ul key={`list-end`}>
          {listItems.map((item, i) => <li key={i} dangerouslySetInnerHTML={{ __html: formatInline(item) }}></li>)}
        </ul>
      );
    }

    return <div>{elements}</div>;
  };

  // Helper to format inline code backticks to code tags
  const formatInline = (text: string) => {
    // Escape simple html tags
    let formatted = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Convert `code` to HTML code tags
    const regex = /`([^`]+)`/g;
    formatted = formatted.replace(regex, "<code>$1</code>");

    // Convert **bold** to bold tags
    formatted = formatted.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

    return formatted;
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString("tr-TR", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  };

  return (
    <section className="releases-section container">
      <div className="section-title-wrapper" style={{ textAlign: "left" }}>
        <div className="section-tagline">Güncellemeler</div>
        <h2 className="section-heading" style={{ fontSize: "32px", marginBottom: "8px" }}>Sürüm Notları</h2>
        <p style={{ color: "var(--text-secondary)", fontSize: "14px" }}>GitHub üzerindeki yayınlanan resmi Axiom sürümleri.</p>
      </div>

      {loading && <div className="spinner"></div>}

      {error && (
        <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "16px", color: "var(--text-secondary)" }}>
          <p>Yüklenemedi: {error}</p>
          <a
            href="https://github.com/quacomes-cli/axiom/releases"
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: "4px", color: "var(--accent)", textDecoration: "underline", marginTop: "12px" }}
          >
            GitHub'da Releases Sayfasına Git <ExternalLink size={12} />
          </a>
        </div>
      )}

      {!loading && !error && (
        <div className="releases-container">
          {releases.length === 0 ? (
            <p style={{ color: "var(--text-secondary)" }}>Yayınlanmış herhangi bir sürüm bulunamadı.</p>
          ) : (
            releases.map((release) => (
              <motion.div
                key={release.id}
                className="release-item"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
              >
                <div className="release-header">
                  <div className="release-version">{release.tag_name} {release.tag_name.startsWith("v0.") && "(Beta-Deneysel Sürüm)"}</div>
                  <div className="release-date">{formatDate(release.published_at)}</div>
                </div>
                <div className="release-body">
                  {renderReleaseBody(release.body)}
                </div>
              </motion.div>
            ))
          )}
        </div>
      )}
    </section>
  );
}

/* ---------------- DOWNLOAD PAGE ---------------- */
function DownloadPage({ latestRelease }: { latestRelease: LatestReleaseInfo | null }) {
  const tag = latestRelease?.tag || "v0.1.4";
  const version = latestRelease?.version || "0.1.4";
  const assets = latestRelease?.assets || [];

  // Helper to find asset url or fallback
  const getDownloadUrl = (ext: string, fallbackName: string) => {
    const asset = assets.find(a => a.name.toLowerCase().endsWith(ext));
    if (asset) return asset.url;
    return `https://github.com/quacomes-cli/axiom/releases/download/${tag}/${fallbackName}`;
  };

  const winUrl = getDownloadUrl(".exe", `Axiom_${version}_x64-setup.exe`);
  // const macUrl = getDownloadUrl(".dmg", `Axiom_${version}_universal.dmg`);
  // const linuxUrl = getDownloadUrl(".appimage", `Axiom_${version}_amd64.AppImage`);

  // Filenames to show on the UI
  const getFilename = (ext: string, defaultName: string) => {
    const asset = assets.find(a => a.name.toLowerCase().endsWith(ext));
    return asset ? asset.name : defaultName;
  };

  const winFilename = getFilename(".exe", `Axiom_${version}_x64-setup.exe`);
  // const macFilename = getFilename(".dmg", `Axiom_${version}_universal.dmg`);
  // const linuxFilename = getFilename(".appimage", `Axiom_${version}_amd64.AppImage`);

  return (
    <section className="download-section container">
      <div className="section-title-wrapper">
        <div className="section-tagline">Dağıtımlar</div>
        <h2 className="section-heading">İşletim Sisteminiz İçin Kurun</h2>
      </div>

      <div className="download-cards">
        <motion.div
          className="download-card"
          whileHover={{ y: -2 }}
          transition={{ duration: 0.15 }}
        >
          <div className="download-os-icon"><FaWindows size={36} strokeWidth={1.2} /></div>
          <div className="download-os-name">Windows</div>
          <div className="download-os-file">{winFilename}</div>
          <a href={winUrl} className="btn btn-primary">
            İndir (.exe)
          </a>
        </motion.div>

        {/* <motion.div
          className="download-card"
          whileHover={{ y: -2 }}
          transition={{ duration: 0.15 }}
        >
          <div className="download-os-icon"><Monitor size={36} strokeWidth={1.2} /></div>
          <div className="download-os-name">macOS (Silicon / Intel)</div>
          <div className="download-os-file">{macFilename}</div>
          <a href={macUrl} className="btn btn-secondary">
            İndir (.dmg)
          </a>
        </motion.div> */}

        {/* <motion.div
          className="download-card"
          whileHover={{ y: -2 }}
          transition={{ duration: 0.15 }}
        >
          <div className="download-os-icon"><Monitor size={36} strokeWidth={1.2} /></div>
          <div className="download-os-name">Linux</div>
          <div className="download-os-file">{linuxFilename}</div>
          <a href={linuxUrl} className="btn btn-secondary">
            İndir (.AppImage)
          </a>
        </motion.div> */}
      </div>

      <div className="setup-guide">
        <h3>Hızlı Kurulum Adımları</h3>
        <ul className="setup-steps">
          <li>Yukarıdaki indirme kartlarından işletim sisteminize uygun olan paketi indirin.</li>
          <li>
            Yerel yapay zeka modellerinin çalışabilmesi için bilgisayarınızda <strong>Ollama</strong>'nın kurulu ve arka planda çalışır durumda olduğundan emin olun.
          </li>
          <li>Axiom'u başlatın. Donanım tarama motorumuz sisteminizi analiz edecek ve uygun modeli otomatik olarak indirme/çalıştırma önerisi getirecektir.</li>
          <li>Uygulama üzerinden otonom izin ayarlarını düzenleyerek ajanın bilgisayarınızı asiste etmesine izin verin.</li>
        </ul>
      </div>
    </section>
  );
}
