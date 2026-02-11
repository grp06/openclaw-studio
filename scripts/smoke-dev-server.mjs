import { spawn } from "node:child_process";
import net from "node:net";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const getFreePort = async () => {
  for (let i = 0; i < 30; i++) {
    const port = 20000 + Math.floor(Math.random() * 20000);
    const ok = await new Promise((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.listen(port, "127.0.0.1", () => {
        server.close(() => resolve(true));
      });
    });
    if (ok) return port;
  }
  throw new Error("Failed to find a free port for smoke test.");
};

const main = async () => {
  const port = await getFreePort();
  const url = `http://127.0.0.1:${port}/`;

  const child = spawn(process.execPath, ["server/index.js", "--dev"], {
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const lines = [];
  const pushLines = (chunk) => {
    const text = String(chunk ?? "");
    for (const line of text.split(/\r?\n/)) {
      if (!line) continue;
      lines.push(line);
      if (lines.length > 80) lines.shift();
    }
  };
  child.stdout.on("data", pushLines);
  child.stderr.on("data", pushLines);

  const deadline = Date.now() + 60_000;
  let lastErr = null;

  try {
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        throw new Error(`Dev server exited early with code ${child.exitCode}.`);
      }

      try {
        const res = await fetch(url, { redirect: "manual" });
        if (res.status >= 200 && res.status < 500) {
          process.stdout.write(`OK ${res.status} ${url}\n`);
          return;
        }
        lastErr = new Error(`Unexpected status ${res.status} for ${url}`);
      } catch (err) {
        lastErr = err;
      }

      await sleep(500);
    }

    throw new Error(
      `Timed out waiting for dev server to respond at ${url}. Last error: ${lastErr?.message || "unknown"}`
    );
  } finally {
    child.kill("SIGTERM");
    await Promise.race([new Promise((r) => child.once("exit", r)), sleep(2000)]);
  }
};

main().catch((err) => {
  process.stderr.write(String(err?.stack || err) + "\n");
  process.exitCode = 1;
});

