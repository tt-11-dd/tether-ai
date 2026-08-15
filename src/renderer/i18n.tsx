import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_LOCALE, t as translate, type Locale, type MessageKey } from "../shared/i18n";
import { setConversationLocale } from "./conversation";

type I18nValue = {
  locale: Locale;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  setLocale: (locale: Locale) => Promise<void>;
};

const I18nContext = createContext<I18nValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    void window.harness.app.getLocale().then((next) => {
      setLocaleState(next);
      setConversationLocale(next);
    });
  }, []);

  const setLocale = useCallback(async (next: Locale) => {
    setLocaleState(next);
    setConversationLocale(next);
    await window.harness.app.setLocale(next);
  }, []);

  const t = useCallback(
    (key: MessageKey, vars?: Record<string, string | number>) => translate(locale, key, vars),
    [locale],
  );

  useEffect(() => {
    setConversationLocale(locale);
  }, [locale]);

  const value = useMemo(() => ({ locale, t, setLocale }), [locale, t, setLocale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used within LocaleProvider");
  return value;
}
