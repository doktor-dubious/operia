import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import da from './locales/da.json'
import en from './locales/en.json'

// Dansk først, engelsk som fallback (spec §multi-language).
// Fælles kilde til understøttede sprog — bruges også af PreferencesSync,
// så et nyt sprog kun skal tilføjes ét sted.
export const SUPPORTED_LANGUAGES = ['da', 'en'] as const

// Per-tenant tekst-overrides (app_labels) lægges som et lag OVENPÅ disse
// bundter ved kørsel — se lib/text-overrides.ts + hooks/use-text-overrides.ts.
// Sprogfilerne redigeres aldrig.
i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      da: { translation: da },
      en: { translation: en },
    },
    fallbackLng: 'da',
    supportedLngs: SUPPORTED_LANGUAGES,
    interpolation: { escapeValue: false },
  })

export default i18n
