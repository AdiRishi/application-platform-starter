import { access, readFile, readdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const workersRoot = join(repositoryRoot, "workers");
const failures: Array<string> = [];

const exists = async (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

const filesUnder = async (root: string): Promise<Array<string>> => {
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(root, entry.name);
      return entry.isDirectory() ? filesUnder(path) : Promise.resolve([path]);
    }),
  );
  return files.flat();
};

const requireFile = async (worker: string, path: string) => {
  if (!(await exists(path))) failures.push(`${worker}: missing ${relative(repositoryRoot, path)}`);
};

const workerDirectories = (await readdir(workersRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

for (const worker of workerDirectories) {
  const root = join(workersRoot, worker);
  const sourceRoot = join(root, "src");
  const testsRoot = join(root, "tests");
  const configPath = join(root, "vitest.config.ts");
  const packagePath = join(root, "package.json");

  await Promise.all([
    requireFile(worker, join(sourceRoot, "index.ts")),
    requireFile(worker, join(testsRoot, "env.d.ts")),
    requireFile(worker, join(testsRoot, "setup.ts")),
    requireFile(worker, join(testsRoot, "tsconfig.json")),
    requireFile(worker, configPath),
  ]);
  if (!(await exists(sourceRoot)) || !(await exists(testsRoot))) continue;

  const sourceFiles = (await filesUnder(sourceRoot)).filter((path) => path.endsWith(".ts"));
  for (const sourceFile of sourceFiles) {
    const sourcePath = relative(sourceRoot, sourceFile);
    if (sourcePath !== "index.ts" && dirname(sourcePath) === ".") {
      failures.push(
        `${worker}: production module must belong to a capability folder: ${sourcePath}`,
      );
    }
  }

  const testFiles = (await filesUnder(testsRoot)).filter((path) =>
    /\.(?:integration\.)?test\.ts$/.test(path),
  );
  for (const testFile of testFiles) {
    const testPath = relative(testsRoot, testFile);
    if (dirname(testPath) === ".") {
      failures.push(`${worker}: test must mirror a capability folder: ${testPath}`);
      continue;
    }
    const sourcePath = testPath.replace(/\.(?:integration\.)?test\.ts$/, ".ts");
    if (!(await exists(join(sourceRoot, sourcePath)))) {
      failures.push(`${worker}: ${testPath} does not mirror src/${sourcePath}`);
    }
  }

  if (await exists(configPath)) {
    const config = await readFile(configPath, "utf8");
    if (!config.includes("@cloudflare/vitest-plugin")) {
      failures.push(`${worker}: vitest.config.ts must use @cloudflare/vitest-plugin`);
    }
    if (!config.includes('setupFiles: ["./tests/setup.ts"]')) {
      failures.push(`${worker}: vitest.config.ts must register tests/setup.ts`);
    }
  }
  if (await exists(packagePath)) {
    const manifest = await readFile(packagePath, "utf8");
    if (manifest.includes("@cloudflare/vitest-pool-workers")) {
      failures.push(`${worker}: package.json still uses @cloudflare/vitest-pool-workers`);
    }
  }
}

if (failures.length > 0) {
  throw new Error(
    `Worker layout check failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`,
  );
}
