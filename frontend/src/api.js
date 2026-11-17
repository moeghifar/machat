// The ONLY module that talks to the backend. Shapes follow PLAN.md section 3.
// Thin wrapper over the generated Wails bindings (bindings/.../app.js).
import { Events } from "@wailsio/runtime";
import * as B from "../bindings/github.com/moeghifar/machat/app.js";

export const api = {
  status: () => B.Status(),
  logout: () => B.Logout(),
  chats: (includeArchived = true) => B.Chats(includeArchived),
  messages: (chat, beforeID = "", limit = 50) => B.Messages(chat, beforeID, limit),
  search: (q) => B.Search(q),
  sendText: (chat, text, quoteID = "") => B.SendText(chat, text, quoteID),
  pickAndSendFile: (chat, caption = "") => B.PickAndSendFile(chat, caption),
  react: (chat, msgID, emoji) => B.React(chat, msgID, emoji),
  markRead: (chat) => B.MarkRead(chat),
  setTyping: (chat, typing) => B.SetTyping(chat, typing),
  openChat: (chat) => B.OpenChat(chat),
  groupInfo: (chat) => B.GroupInfo(chat),
  downloadMedia: (chat, msgID) => B.DownloadMedia(chat, msgID),
  saveMedia: (chat, msgID) => B.SaveMedia(chat, msgID),
  getSettings: () => B.GetSettings(),
  setSettings: (s) => B.SetSettings(s),
};

/** Subscribe to a backend event (status|chat|message|typing|presence|sync). Returns unsubscribe. */
export const on = (name, cb) => Events.On(name, (e) => cb(e.data));
