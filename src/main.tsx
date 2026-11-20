import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import {GithubLoginQaApp} from "./components/GithubLoginQaApp";
import { I18nProvider } from "./i18n";
import "./styles.css";
import "./experiencePolish.css";
import "./uxCockpit40.css";
import "./uxFacelift4.css";

// Apply the selected theme before React paints to avoid a dark flash on first light launch.
const savedTheme = localStorage.getItem("katosync.theme");
document.documentElement.dataset.theme =
  savedTheme === "dark" || (savedTheme === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches)
    ? "dark" : "light";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <I18nProvider>
      {import.meta.env.VITE_GITHUB_LOGIN_QA==="1"?<GithubLoginQaApp/>:<App/>}
    </I18nProvider>
  </React.StrictMode>
);
