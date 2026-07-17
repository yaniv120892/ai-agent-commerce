import { createServer } from "node:net";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const DEFAULT_DATABASE_PORT = 5432;
const PORT_RANGE_START = 5433;
const PORT_RANGE_END = 5533;
const PORT_RANGE_SIZE = PORT_RANGE_END - PORT_RANGE_START + 1;

interface WorktreeDescriptor {
  path: string;
  isMain: boolean;
}

async function main(): Promise<void> {
  const currentWorktreePath = getGitToplevel(process.cwd());
  const worktrees = listWorktrees();
  const mainWorktree = worktrees.find((worktree) => worktree.isMain);

  if (!mainWorktree) {
    throw new Error(
      `Could not determine the main checkout from 'git worktree list' output (looked for a non-worktree entry among: ${worktrees.map((worktree) => worktree.path).join(", ")})`,
    );
  }

  if (currentWorktreePath === mainWorktree.path) {
    console.log(
      `${currentWorktreePath} is the main checkout, not a linked worktree. It keeps port ${DEFAULT_DATABASE_PORT} and is left untouched.`,
    );
    return;
  }

  const envPath = join(currentWorktreePath, ".env");
  const composePath = join(currentWorktreePath, "compose.yaml");
  const existingEnvContent = existsSync(envPath)
    ? await readFile(envPath, "utf8")
    : null;
  const existingComposeContent = existsSync(composePath)
    ? await readFile(composePath, "utf8")
    : null;

  const alreadyAssignedPort = getConsistentAssignedPort(
    existingEnvContent,
    existingComposeContent,
  );

  const port =
    alreadyAssignedPort ??
    (await allocatePort(
      currentWorktreePath,
      collectReservedPorts(worktrees, currentWorktreePath),
    ));

  await writeEnvFile(
    currentWorktreePath,
    mainWorktree.path,
    existingEnvContent,
    port,
  );
  await writeComposeFile(currentWorktreePath, existingComposeContent, port);

  console.log(
    `Worktree ${currentWorktreePath} is configured with Postgres host port ${port}.`,
  );
  console.log(`  .env: ${envPath}`);
  console.log(`  compose.yaml: ${composePath}`);
}

function getGitToplevel(cwd: string): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    encoding: "utf8",
  }).trim();
}

/**
 * `git worktree list --porcelain` always lists the main checkout first,
 * with every subsequent entry a linked worktree. That ordering is the only
 * reliable, directory-naming-agnostic way to tell them apart (worktrees in
 * this repo live under both .claude/worktrees/ and .worktrees/).
 */
function listWorktrees(): WorktreeDescriptor[] {
  const output = execFileSync("git", ["worktree", "list", "--porcelain"], {
    encoding: "utf8",
  });
  const descriptors: WorktreeDescriptor[] = [];

  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      descriptors.push({
        path: line.slice("worktree ".length).trim(),
        isMain: descriptors.length === 0,
      });
    }
  }

  return descriptors;
}

function collectReservedPorts(
  worktrees: WorktreeDescriptor[],
  currentWorktreePath: string,
): Set<number> {
  const reservedPorts = new Set<number>([DEFAULT_DATABASE_PORT]);

  for (const worktree of worktrees) {
    if (worktree.path === currentWorktreePath) {
      continue;
    }

    const composePath = join(worktree.path, "compose.yaml");
    if (!existsSync(composePath)) {
      continue;
    }

    const port = extractComposePort(readFileSync(composePath, "utf8"));
    if (port !== null) {
      reservedPorts.add(port);
    }
  }

  return reservedPorts;
}

function getConsistentAssignedPort(
  envContent: string | null,
  composeContent: string | null,
): number | null {
  if (envContent === null || composeContent === null) {
    return null;
  }

  const envPort = extractEnvPort(envContent);
  const composePort = extractComposePort(composeContent);

  if (
    envPort !== null &&
    composePort !== null &&
    envPort === composePort &&
    envPort !== DEFAULT_DATABASE_PORT
  ) {
    return envPort;
  }

  return null;
}

function extractEnvPort(envContent: string): number | null {
  const match = envContent.match(/DATABASE_URL=.*?localhost:(\d+)/);
  return match ? Number(match[1]) : null;
}

function extractComposePort(composeContent: string): number | null {
  const match = composeContent.match(/"(\d+):5432"/);
  return match ? Number(match[1]) : null;
}

async function allocatePort(
  worktreePath: string,
  reservedPorts: Set<number>,
): Promise<number> {
  const basePortOffset = hashStringToRange(worktreePath, PORT_RANGE_SIZE);

  for (let attempt = 0; attempt < PORT_RANGE_SIZE; attempt += 1) {
    const candidatePort =
      PORT_RANGE_START + ((basePortOffset + attempt) % PORT_RANGE_SIZE);

    if (reservedPorts.has(candidatePort)) {
      continue;
    }

    if (await isPortFree(candidatePort)) {
      return candidatePort;
    }
  }

  throw new Error(
    `No free Postgres host port found in range ${PORT_RANGE_START}-${PORT_RANGE_END} for worktree ${worktreePath} (reserved: ${[...reservedPorts].join(", ")})`,
  );
}

function hashStringToRange(input: string, range: number): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % range;
}

async function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => {
      resolve(false);
    });
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function writeEnvFile(
  worktreePath: string,
  mainWorktreePath: string,
  existingEnvContent: string | null,
  port: number,
): Promise<void> {
  const envPath = join(worktreePath, ".env");

  if (existingEnvContent !== null) {
    await writeFile(envPath, applyPortToEnvContent(existingEnvContent, port));
    return;
  }

  const mainEnvPath = join(mainWorktreePath, ".env");
  const mainEnvExamplePath = join(mainWorktreePath, ".env.example");
  const sourcePath = existsSync(mainEnvPath) ? mainEnvPath : mainEnvExamplePath;

  if (!existsSync(sourcePath)) {
    throw new Error(
      `Neither ${mainEnvPath} nor ${mainEnvExamplePath} exists; cannot seed ${envPath}`,
    );
  }

  const sourceContent = await readFile(sourcePath, "utf8");
  await writeFile(envPath, applyPortToEnvContent(sourceContent, port));
  console.log(`  seeded .env from ${sourcePath}`);
}

async function writeComposeFile(
  worktreePath: string,
  existingComposeContent: string | null,
  port: number,
): Promise<void> {
  const composePath = join(worktreePath, "compose.yaml");

  if (existingComposeContent === null) {
    throw new Error(
      `${composePath} does not exist. compose.yaml is a tracked file, so every worktree should already have a copy from 'git worktree add'; something is wrong with this checkout.`,
    );
  }

  await writeFile(
    composePath,
    applyPortToComposeContent(existingComposeContent, port),
  );
}

function applyPortToEnvContent(content: string, port: number): string {
  return content.replace(/localhost:\d+/g, `localhost:${port}`);
}

function applyPortToComposeContent(content: string, port: number): string {
  return content.replace(/"(\d+):5432"/g, `"${port}:5432"`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
