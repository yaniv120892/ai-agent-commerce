import { createServer } from "node:net";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

interface WorktreeDescriptor {
  path: string;
  isMain: boolean;
}

interface EnvVarPortBinding {
  name: string;
  format: "url" | "bare";
}

interface ServicePortSpec {
  id: string;
  defaultPort: number;
  rangeStart: number;
  rangeEnd: number;
  envVars: EnvVarPortBinding[];
  composeContainerPort: number | null;
}

interface ServicePortAssignment {
  spec: ServicePortSpec;
  port: number;
}

const SERVICE_PORT_SPECS: ServicePortSpec[] = [
  {
    id: "postgres",
    defaultPort: 5432,
    rangeStart: 5433,
    rangeEnd: 5533,
    envVars: [
      { name: "DATABASE_URL", format: "url" },
      { name: "TEST_DATABASE_URL", format: "url" },
    ],
    composeContainerPort: 5432,
  },
  {
    id: "redis",
    defaultPort: 6379,
    rangeStart: 6380,
    rangeEnd: 6480,
    envVars: [{ name: "REDIS_URL", format: "url" }],
    composeContainerPort: 6379,
  },
  {
    id: "api",
    defaultPort: 3000,
    rangeStart: 3001,
    rangeEnd: 3101,
    envVars: [{ name: "PORT", format: "bare" }],
    composeContainerPort: null,
  },
];

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
      `${currentWorktreePath} is the main checkout, not a linked worktree. It keeps every service's default port and is left untouched.`,
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

  if (existingComposeContent === null) {
    throw new Error(
      `${composePath} does not exist. compose.yaml is a tracked file, so every worktree should already have a copy from 'git worktree add'; something is wrong with this checkout.`,
    );
  }

  const seededFromMain = existingEnvContent === null;
  let envContent =
    existingEnvContent ?? (await seedEnvContent(mainWorktree.path));
  let composeContent = existingComposeContent;
  const assignments: ServicePortAssignment[] = [];

  for (const spec of SERVICE_PORT_SPECS) {
    if (!isServiceActive(spec, existingComposeContent)) {
      continue;
    }

    const port =
      getConsistentAssignedPort(
        spec,
        existingEnvContent,
        existingComposeContent,
      ) ??
      (await allocatePort(
        spec,
        currentWorktreePath,
        collectReservedPorts(spec, worktrees, currentWorktreePath),
      ));

    envContent = applyPortToEnvContent(envContent, spec, port);
    composeContent = applyPortToComposeContent(composeContent, spec, port);
    assignments.push({ spec, port });
  }

  await writeFile(envPath, envContent);
  await writeFile(composePath, composeContent);

  if (seededFromMain) {
    console.log(`  seeded .env from ${mainWorktree.path}`);
  }
  console.log(`Worktree ${currentWorktreePath} is configured with:`);
  for (const { spec, port } of assignments) {
    console.log(`  ${spec.id}: port ${port}`);
  }
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

/**
 * A service is only ever port-managed here if it's actually present:
 * compose-backed services (postgres, redis) are active only once their
 * block exists in this worktree's own compose.yaml, so redis stays a no-op
 * until a future branch (e.g. YAN-12) adds it. The api dev server has no
 * compose entry and is always active, since `npm run dev` applies to every
 * worktree regardless of Docker services.
 */
function isServiceActive(
  spec: ServicePortSpec,
  composeContent: string,
): boolean {
  if (spec.composeContainerPort === null) {
    return true;
  }
  return extractComposePort(composeContent, spec.composeContainerPort) !== null;
}

function collectReservedPorts(
  spec: ServicePortSpec,
  worktrees: WorktreeDescriptor[],
  currentWorktreePath: string,
): Set<number> {
  const reservedPorts = new Set<number>([spec.defaultPort]);

  for (const worktree of worktrees) {
    if (worktree.path === currentWorktreePath) {
      continue;
    }

    if (spec.composeContainerPort !== null) {
      const composePath = join(worktree.path, "compose.yaml");
      if (!existsSync(composePath)) {
        continue;
      }
      const port = extractComposePort(
        readFileSync(composePath, "utf8"),
        spec.composeContainerPort,
      );
      if (port !== null) {
        reservedPorts.add(port);
      }
      continue;
    }

    const envPath = join(worktree.path, ".env");
    if (!existsSync(envPath)) {
      continue;
    }
    const port = extractEnvVarPort(
      readFileSync(envPath, "utf8"),
      spec.envVars[0],
    );
    if (port !== null) {
      reservedPorts.add(port);
    }
  }

  return reservedPorts;
}

/**
 * Reuses the currently assigned port only when every one of the service's
 * env vars and (if compose-backed) its compose.yaml mapping already agree
 * on the same non-default port. Any drift (a hand edit, a partially applied
 * previous run) is treated as "not consistent" and forces a fresh
 * allocation rather than trusting stale state.
 */
function getConsistentAssignedPort(
  spec: ServicePortSpec,
  existingEnvContent: string | null,
  existingComposeContent: string,
): number | null {
  if (existingEnvContent === null) {
    return null;
  }

  const envPort = extractEnvPort(existingEnvContent, spec);
  if (envPort === null || envPort === spec.defaultPort) {
    return null;
  }

  if (spec.composeContainerPort === null) {
    return envPort;
  }

  const composePort = extractComposePort(
    existingComposeContent,
    spec.composeContainerPort,
  );
  return composePort === envPort ? envPort : null;
}

function extractEnvPort(
  envContent: string,
  spec: ServicePortSpec,
): number | null {
  const ports = spec.envVars
    .map((binding) => extractEnvVarPort(envContent, binding))
    .filter((port): port is number => port !== null);

  if (ports.length === 0) {
    return null;
  }

  const [firstPort, ...restPorts] = ports;
  return restPorts.every((port) => port === firstPort) ? firstPort : null;
}

function extractEnvVarPort(
  envContent: string,
  binding: EnvVarPortBinding,
): number | null {
  const pattern =
    binding.format === "url"
      ? new RegExp(`^${binding.name}=.*?localhost:(\\d+)`, "m")
      : new RegExp(`^${binding.name}=(\\d+)`, "m");
  const match = envContent.match(pattern);
  return match ? Number(match[1]) : null;
}

function extractComposePort(
  composeContent: string,
  containerPort: number,
): number | null {
  const match = composeContent.match(new RegExp(`"(\\d+):${containerPort}"`));
  return match ? Number(match[1]) : null;
}

async function allocatePort(
  spec: ServicePortSpec,
  worktreePath: string,
  reservedPorts: Set<number>,
): Promise<number> {
  const rangeSize = spec.rangeEnd - spec.rangeStart + 1;
  const basePortOffset = hashStringToRange(
    `${spec.id}:${worktreePath}`,
    rangeSize,
  );

  for (let attempt = 0; attempt < rangeSize; attempt += 1) {
    const candidatePort =
      spec.rangeStart + ((basePortOffset + attempt) % rangeSize);

    if (reservedPorts.has(candidatePort)) {
      continue;
    }

    if (await isPortFree(candidatePort)) {
      return candidatePort;
    }
  }

  throw new Error(
    `No free ${spec.id} host port found in range ${spec.rangeStart}-${spec.rangeEnd} for worktree ${worktreePath} (reserved: ${[...reservedPorts].join(", ")})`,
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

async function seedEnvContent(mainWorktreePath: string): Promise<string> {
  const mainEnvPath = join(mainWorktreePath, ".env");
  const mainEnvExamplePath = join(mainWorktreePath, ".env.example");
  const sourcePath = existsSync(mainEnvPath) ? mainEnvPath : mainEnvExamplePath;

  if (!existsSync(sourcePath)) {
    throw new Error(
      `Neither ${mainEnvPath} nor ${mainEnvExamplePath} exists; cannot seed .env`,
    );
  }

  return readFile(sourcePath, "utf8");
}

function applyPortToEnvContent(
  content: string,
  spec: ServicePortSpec,
  port: number,
): string {
  return spec.envVars.reduce(
    (accumulatedContent, binding) =>
      applyPortToEnvVar(accumulatedContent, binding, port),
    content,
  );
}

function applyPortToEnvVar(
  content: string,
  binding: EnvVarPortBinding,
  port: number,
): string {
  if (binding.format === "url") {
    const pattern = new RegExp(`(^${binding.name}=.*?localhost:)\\d+`, "m");
    return pattern.test(content)
      ? content.replace(pattern, `$1${port}`)
      : content;
  }

  const pattern = new RegExp(`^${binding.name}=\\d*$`, "m");
  if (pattern.test(content)) {
    return content.replace(pattern, `${binding.name}=${port}`);
  }
  return `${content.replace(/\n+$/, "")}\n${binding.name}=${port}\n`;
}

function applyPortToComposeContent(
  content: string,
  spec: ServicePortSpec,
  port: number,
): string {
  if (spec.composeContainerPort === null) {
    return content;
  }
  return content.replace(
    new RegExp(`"\\d+:${spec.composeContainerPort}"`, "g"),
    `"${port}:${spec.composeContainerPort}"`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
