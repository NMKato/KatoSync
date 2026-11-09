import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import {GithubLoginQaApp} from "./components/GithubLoginQaApp";
import { I18nProvider } from "./i18n";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <I18nProvider>
      {import.meta.env.VITE_GITHUB_LOGIN_QA==="1"?<GithubLoginQaApp/>:<App/>}
    </I18nProvider>
  </React.StrictMode>
);
