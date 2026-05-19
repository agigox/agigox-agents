import { WebSocket } from "ws";
import { WSMessage } from "./types";

let clients: Set<WebSocket> = new Set();

export function registerClients(set: Set<WebSocket>) {
  clients = set;
}

export function broadcast(message: WSMessage): void {
  const data = JSON.stringify(message);
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  });
}
