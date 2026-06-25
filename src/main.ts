import { createApp } from "vue";
import App from "./App.vue";
import { i18n } from "./i18n";
import "highlight.js/styles/github.css";
import "./styles.css";
import "./theme-dark.css";

createApp(App).use(i18n).mount("#app");