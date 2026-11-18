#!/usr/bin/env node
import { spawn } from "node:child_process";
import process from "node:process";

const args = process.argv.slice(2);
const remoteUrl = args.find((arg) => !arg.startsWith("-"));
const localPort = process.env.SMOKE_PORT ?? "8787";
const base = (remoteUrl ?? `http://127.0.0.1:${localPort}`).replace(/\/+$/, "");

const checks = [
  {
    path: "/",
    contentType: "text/html",
    contains: ["<title>", 'rel="canonical"'],
  },
  { path: "/es/", contentType: "text/html", contains: ['lang="es"'] },
  { path: "/posts/", contentType: "text/html" },
  { path: "/es/posts/", contentType: "text/html" },
  { path: "/about/", contentType: "text/html" },
  { path: "/projects/", contentType: "text/html" },
  { path: "/rss.xml", contains: ["<rss"] },
  { path: "/es/rss.xml", contains: ["<rss"] },
  { path: "/sitemap.xml", contains: ["<sitemapindex"] },
  { path: "/robots.txt", contains: ["Sitemap:"] },
  { path: "/llms.txt" },
  {
    path: "/og/en/default.png",
    contentType: "image/png",
    magic: [0x89, 0x50, 0x4e, 0x47],
  },
  {
    path: "/og/es/default.png",
    contentType: "image/png",
    magic: [0x89, 0x50, 0x4e, 0x47],
  },
];

let server;
const serverLogs = [];
const stopServer = () => {
  if (server && server.exitCode === null) server.kill("SIGTERM");
};
process.on("exit", stopServer);
process.on("SIGINT", () => {
  stopServer();
  process.exit(130);
});

async function waitForServer() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`wrangler dev exited with code ${server.exitCode}`);
    }
    try {
      const response = await fetch(`${base}/`, {
        signal: AbortSignal.timeout(3_000),
      });
      if (response.ok) return;
    } catch {
      // Server not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("wrangler dev did not become ready within 60s");
}

async function runCheck(check, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${base}${check.path}`, {
        redirect: "follow",
        signal: AbortSignal.timeout(15_000),
      });
      const problems = [];
      if (response.status !== 200) problems.push(`status ${response.status}`);
      const contentType = response.headers.get("content-type") ?? "";
      if (check.contentType && !contentType.startsWith(check.contentType)) {
        problems.push(`content-type ${contentType || "(none)"}`);
      }
      const body = new Uint8Array(await response.arrayBuffer());
      if (check.magic) {
        const matches = check.magic.every(
          (byte, index) => body[index] === byte,
        );
        if (!matches) problems.push("unexpected file signature");
      }
      if (check.contains) {
        const text = new TextDecoder().decode(body);
        for (const needle of check.contains) {
          if (!text.includes(needle))
            problems.push(`missing ${JSON.stringify(needle)}`);
        }
      }
      if (problems.length === 0) return { ok: true };
      lastError = problems.join(", ");
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
  return { ok: false, error: lastError };
}

try {
  if (!remoteUrl) {
    console.log(`Building Worker preview on port ${localPort}...`);
    server = spawn("pnpm", ["exec", "wrangler", "dev", "--port", localPort], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout.on("data", (chunk) => serverLogs.push(chunk.toString()));
    server.stderr.on("data", (chunk) => serverLogs.push(chunk.toString()));
    await waitForServer();
    console.log(`wrangler dev ready at ${base}`);
  }

  console.log(`Smoke testing ${base}\n`);
  let failures = 0;
  for (const check of checks) {
    const result = await runCheck(check);
    if (result.ok) {
      console.log(`  ok   ${check.path}`);
    } else {
      failures += 1;
      console.log(`  FAIL ${check.path} -> ${result.error}`);
    }
  }
  console.log(`\n${checks.length - failures}/${checks.length} checks passed`);
  if (failures > 0) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  if (serverLogs.length > 0) console.error(serverLogs.join(""));
  process.exitCode = 1;
} finally {
  stopServer();
}
