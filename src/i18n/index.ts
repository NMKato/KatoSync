// Created by NMKato on 2026-06-29
// Leichte i18n-Schicht ohne Framework: Provider + useT() + t(key, vars).
// Sprache: navigator.language beim ersten Start, manuell umschaltbar (persistiert in localStorage).
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import de, { type TKey } from "./locales/de";
import en from "./locales/en";
import es from "./locales/es";
import ru from "./locales/ru";

export type Lang = "de" | "en" | "es" | "ru";
export const LANGUAGES: Lang[] = ["de", "en", "es", "ru"];
const STORAGE_KEY = "katosync.lang";

const catalogs: Record<Lang, Record<TKey, string>> = { de, en, es, ru };

export function detectLang(): Lang {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && (LANGUAGES as string[]).includes(stored)) return stored as Lang;
  const nav = (navigator.language || "de").slice(0, 2).toLowerCase();
  return (LANGUAGES as string[]).includes(nav) ? (nav as Lang) : "de";
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? String(vars[key]) : match));
}

export type TFunc = (key: TKey, vars?: Record<string, string | number>) => string;

function makeT(lang: Lang): TFunc {
  return (key, vars) => interpolate(catalogs[lang][key] ?? de[key] ?? key, vars);
}

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: TFunc;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => detectLang());
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    localStorage.setItem(STORAGE_KEY, next);
  }, []);
  const t = useMemo(() => makeT(lang), [lang]);
  const value = useMemo<I18nContextValue>(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return createElement(I18nContext.Provider, { value }, children);
}

export function useT(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useT must be used within I18nProvider");
  return ctx;
}

export type { TKey };
