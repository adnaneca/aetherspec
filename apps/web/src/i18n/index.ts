import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import tr from "./locales/tr.json";

// Get saved language from localStorage or default to browser language
function getInitialLanguage(): string {
  const saved = localStorage.getItem("aetherspec.language");
  if (saved === "en" || saved === "tr") {
    return saved;
  }
  const browserLang = navigator.language.toLowerCase();
  if (browserLang.startsWith("tr")) {
    return "tr";
  }
  return "en";
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    tr: { translation: tr },
  },
  lng: getInitialLanguage(),
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
