import { createDiscordChannelForAgent } from "../src/lib/discord/discordChannel";

const args = new Map<string, string>();
for (const entry of process.argv.slice(2)) {
  const [key, value] = entry.split("=");
  if (!key || value === undefined) continue;
  args.set(key.replace(/^--/, ""), value);
}

const agentName = args.get("agent-name");
const agentId = args.get("agent-id");
if (!agentName || !agentId) {
  console.error(
    "Usage: node scripts/create-discord-channel.ts --agent-name=<name> --agent-id=<id> [--guild-id=<id>]"
  );
  process.exit(1);
}

const guildId = args.get("guild-id");

createDiscordChannelForAgent({ agentName, agentId, guildId })
  .then((result) => {
    console.log(
      JSON.stringify(
        {
          channelId: result.channelId,
          channelName: result.channelName,
          guildId: result.guildId,
        },
        null,
        2
      )
    );
  })
  .catch((err) => {
    const message = err instanceof Error ? err.message : "Failed to create Discord channel.";
    console.error(message);
    process.exit(1);
  });
