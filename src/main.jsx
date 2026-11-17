import { render } from "solid-js/web";
import "@fontsource-variable/geist";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
import "./style.css";
import App from "./App.jsx";
import { applyTheme } from "./theme.js";

applyTheme();
render(() => <App />, document.getElementById("root"));
