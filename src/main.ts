import { Application } from "pixi.js";
import { TrucoGameApp } from "./ui/TrucoGameApp";

async function waitForFonts(timeoutMs = 550): Promise<void> {
  if (typeof document === "undefined" || !("fonts" in document)) return;
  try {
    await Promise.race([
      document.fonts.ready,
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  } catch {
    // Fallback silencioso a fuentes del sistema si no hay red
  }
}

(async () => {
  const root = document.getElementById("app") ?? document.body;
  await waitForFonts();

  const app = new Application();
  await app.init({
    resizeTo: window,
    background: "#140a06",
    antialias: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
  });

  root.appendChild(app.canvas);
  new TrucoGameApp(app);
})();
