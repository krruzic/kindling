// BRAWL entry: builds the App with its screens and starts the frame loop.
import { Dialog } from "@kindling/ui";
import { App, type AppScreens } from "./app/app.ts";
import {
  confirmScreen,
  creditsScreen,
  dialogScreen,
  menuScreen,
  messageScreen,
  titleScreen,
} from "./ui/screens/front.ts";
import { matchScreen, pauseScreen, resultsScreen } from "./ui/screens/match.ts";
import { onlineScreen } from "./ui/screens/online.ts";
import { selectScreen } from "./ui/screens/select.ts";
import { controlsScreen, optionsScreen } from "./ui/screens/settings.ts";

const screens = (app: App): AppScreens => ({
  title: () => titleScreen(app),
  menu: () => menuScreen(app),
  options: () => optionsScreen(app),
  controls: () => controlsScreen(app),
  select: () => selectScreen(app),
  match: () => matchScreen(app),
  pause: () => pauseScreen(app, 0, () => {}),
  results: () => resultsScreen(app),
  online: () => onlineScreen(app),
  credits: () => creditsScreen(app),
  confirm: (title, body, yes, o) => confirmScreen(app, title, body, yes, o),
  message: (title, body, ok) => messageScreen(app, title, body, ok),
});
void Dialog;
void dialogScreen;

const app = new App(document.getElementById("game")!, screens);
app.start().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML("beforeend", `<pre class="err">${String(e?.stack ?? e)}</pre>`);
});
