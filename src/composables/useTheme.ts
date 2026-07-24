/**
 * Global theme management module, providing features like light/dark mode switching and system theme awareness.
 */

import { ref, computed, watch } from "vue";
import type { Ref, ComputedRef } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";

const STORAGE_FILE = "settings.json";
const THEME_STORAGE_KEY = "md-reader-theme";

// Initialize Tauri Store
const store = await load(STORAGE_FILE, { autoSave: false });

// Enumeration for the actual rendered theme color
export type Theme = "light" | "dark";

// Enumeration for the user-configured theme mode, including the system follow option
export type ThemeMode = Theme | "system";

// Environment flag: whether it is running in the browser client
const isClient = typeof window !== "undefined";

// Environment flag: whether it is running in development mode
const isDev = import.meta.env?.DEV ?? false;

// Internally maintained current theme mode.
const internalThemeMode: Ref<ThemeMode> = ref("system");

// Asynchronously load the user's theme preference from the Store and update the internal state
async function initStoredThemeMode() {
  if (!isClient) return;
  try {
    const stored = await store.get<string>(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") {
      internalThemeMode.value = stored;
    }
  } catch (error) {
    if (isDev) console.warn("[Theme] Failed to read from Tauri Store:", error);
  }
}

// Persist the theme mode to the Tauri Store and save it to disk
async function writeStoredThemeMode(mode: ThemeMode) {
  if (!isClient) return;
  try {
    if (mode === "system") {
      await store.delete(THEME_STORAGE_KEY);
      window.localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      await store.set(THEME_STORAGE_KEY, mode);
      window.localStorage.setItem(THEME_STORAGE_KEY, mode);
    }
    // Since autoSave is disabled, save must be called manually
    await store.save();
  } catch (error) {
    if (isDev) console.warn("[Theme] Failed to write to Tauri Store:", error);
  }
}

// Asynchronously load the stored theme on startup
initStoredThemeMode();

// perating system level theme state
const systemTheme: Ref<Theme> = ref("light");

// Native media query object for operating system theme preferences
const mediaQuery = isClient
  ? window.matchMedia("(prefers-color-scheme: dark)")
  : undefined;

// Initialize system theme state
if (mediaQuery) {
  systemTheme.value = mediaQuery.matches ? "dark" : "light";
}

// eme preference changes
const handleSystemThemeChange = (event: MediaQueryListEvent) => {
  const newTheme = event.matches ? "dark" : "light";
  if (isDev) console.info(`[Theme] System theme changed to: ${newTheme}`);
  systemTheme.value = newTheme;
};

// The final effective theme calculated based on the user's mode selection.
const effectiveTheme: ComputedRef<Theme> = computed(() => {
  return internalThemeMode.value === "system"
    ? systemTheme.value
    : internalThemeMode.value;
});

// Two-way binding theme mode interface provided for component layer use.
const themeMode = computed({
  get: () => internalThemeMode.value,
  set: (mode: ThemeMode) => {
    if (isDev) console.info(`[Theme] User set theme mode to: ${mode}`);
    internalThemeMode.value = mode;
  },
});

// Watch for changes to internalThemeMode
watch(internalThemeMode, (mode) => {
  writeStoredThemeMode(mode);

  invoke("set_theme_mode", { themeMode: mode }).catch((error) => {
    if (isDev) console.error("[Theme] IPC error on 'set_theme_mode':", error);
  });
});

// Watch for changes to effectiveTheme
watch(
  effectiveTheme,
  (theme) => {
    if (!isClient) return;

    const root = document.documentElement;
    root.setAttribute("data-theme", theme);
    root.style.setProperty("color-scheme", theme);

    invoke("set_effective_theme", { theme }).catch((error) => {
      if (isDev)
        console.error("[Theme] IPC error on 'set_effective_theme':", error);
    });
  },
  { immediate: true }
);

// Mount system-level listeners
if (isClient) {
  mediaQuery?.addEventListener("change", handleSystemThemeChange);
}

// In the development environment, prevent memory leaks caused by Vite Hot Module Replacement (HMR)
if (import.meta.hot && isClient) {
  import.meta.hot.dispose(() => {
    mediaQuery?.removeEventListener("change", handleSystemThemeChange);
  });
}

// Vue Composable providing theme access and manipulation
export function useTheme() {
  return {
    themeMode,
    effectiveTheme,
  };
}
