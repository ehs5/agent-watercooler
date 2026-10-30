import { mount } from "svelte";
import App from "./App.svelte";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/600.css";
import "./app.css";

const target = document.getElementById("app");
if (!target) throw new Error("Missing #app element");

mount(App, { target });
