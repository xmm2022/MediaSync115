/**
 * 主题切换 hook —— 持久化到 localStorage，默认深色玻璃拟态。
 * 切换会在 <html data-theme> 上挂 'dark' | 'light'，index.css 据此重渲全部主题 token。
 */
import { useEffect, useState } from "react";

export type ThemeMode = "dark" | "light";

const STORAGE_KEY = "mediasync115-theme";

function readInitial(): ThemeMode {
  if (typeof window === "undefined") return "light";
  const saved = window.localStorage.getItem(STORAGE_KEY);
  return saved === "light" || saved === "dark" ? saved : "light";
}

export function useTheme() {
  const [theme, setTheme] = useState<ThemeMode>(readInitial);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", theme);
    try { window.localStorage.setItem(STORAGE_KEY, theme); } catch { /* ignore */ }
  }, [theme]);

  const toggle = () => setTheme((t) => (t === "dark" ? "light" : "dark"));
  return { theme, setTheme, toggle };
}