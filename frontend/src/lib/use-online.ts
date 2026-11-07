import { useEffect, useState } from "react";

const PROBE_URL = "https://connectivitycheck.gstatic.com/generate_204";
const PROBE_MS = 15_000;
const TIMEOUT_MS = 4_000;

async function canReachInternet() {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return false;
  }

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    await fetch(PROBE_URL, {
      method: "GET",
      cache: "no-store",
      mode: "no-cors",
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

export function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    let cancelled = false;
    let generation = 0;
    let checking = false;

    const check = async () => {
      if (checking) {
        return;
      }
      checking = true;
      const id = ++generation;
      try {
        const next = await canReachInternet();
        if (!cancelled && id === generation) {
          setOnline(next);
        }
      } finally {
        checking = false;
      }
    };

    const markOffline = () => {
      generation += 1;
      setOnline(false);
    };

    void check();
    const interval = window.setInterval(() => {
      void check();
    }, PROBE_MS);
    window.addEventListener("offline", markOffline);
    window.addEventListener("online", check);
    window.addEventListener("focus", check);

    return () => {
      cancelled = true;
      generation += 1;
      window.clearInterval(interval);
      window.removeEventListener("offline", markOffline);
      window.removeEventListener("online", check);
      window.removeEventListener("focus", check);
    };
  }, []);

  return online;
}
