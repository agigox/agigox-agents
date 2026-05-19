import { Bot } from "grammy";
import {
  createAgent,
  assignMission,
  listAgents,
  removeAgent,
} from "./agentManager";

export function initTelegramBot(): void {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn("TELEGRAM_BOT_TOKEN not set — bot disabled");
    return;
  }

  const bot = new Bot(token);

  bot.command("start", (ctx) =>
    ctx.reply(
      "Agent Dashboard\n\n/create <name>\n/mission <id> <task>\n/list\n/delete <id>",
    ),
  );
  bot.command("create", async (ctx) => {
    const name = ctx.match.trim();
    if (!name) return ctx.reply("Usage: /create <name>");
    const agent = await createAgent(name);
    ctx.reply(`Created\nID: ${agent.id}\nName: ${agent.name}`);
  });
  bot.command("mission", async (ctx) => {
    const [agentId, ...rest] = ctx.match.trim().split(" ");
    const mission = rest.join(" ");
    if (!agentId || !mission) return ctx.reply("Usage: /mission <id> <task>");
    await assignMission(agentId, mission);
    ctx.reply(`Mission assigned to ${agentId}`);
  });
  bot.command("list", async (ctx) => {
    const agents = await listAgents();
    if (!agents.length) return ctx.reply("No agents.");
    ctx.reply(
      agents.map((a) => `• [${a.status}] ${a.name}\n  ${a.id}`).join("\n\n"),
    );
  });
  bot.command("delete", async (ctx) => {
    const agentId = ctx.match.trim();
    if (!agentId) return ctx.reply("Usage: /delete <id>");
    await removeAgent(agentId);
    ctx.reply(`Deleted ${agentId}`);
  });

  bot.start();
  console.log("Telegram bot started");
}
