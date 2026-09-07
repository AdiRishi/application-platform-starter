import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const repository = resolve(import.meta.dirname, "../..");

const copyStarter = () => {
  const root = mkdtempSync(join(tmpdir(), "starter-rename-"));
  for (const file of [
    "package.json",
    "README.md",
    "scripts/src",
    "infra/src",
    "infra/tests/resource-names.test.ts",
    "infra/vitest.config.ts",
  ]) {
    cpSync(join(repository, file), join(root, file), { recursive: true });
  }
  symlinkSync(join(repository, "scripts/node_modules"), join(root, "scripts/node_modules"), "dir");
  symlinkSync(join(repository, "infra/node_modules"), join(root, "infra/node_modules"), "dir");
  return root;
};

await test("renaming a fresh starter preserves its infrastructure checks", (context) => {
  const root = copyStarter();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync(process.execPath, [join(root, "scripts/src/rename-project.ts"), "acme-platform"]);
  assert.match(
    readFileSync(join(root, "infra/src/project.ts"), "utf8"),
    /stackName: "AcmePlatform"/,
  );
  assert.match(readFileSync(join(root, "package.json"), "utf8"), /"name": "acme-platform"/);
  execFileSync(
    join(repository, "infra/node_modules/.bin/vitest"),
    ["run", "tests/resource-names.test.ts"],
    { cwd: join(root, "infra"), stdio: "pipe" },
  );
});

await test("invalid names or missing replacement targets do not partially rename a project", (context) => {
  const root = copyStarter();
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const original = readFileSync(join(root, "package.json"), "utf8");
  for (const name of ["Bad Name", "a".repeat(33)]) {
    assert.throws(() =>
      execFileSync(process.execPath, [join(root, "scripts/src/rename-project.ts"), name], {
        stdio: "pipe",
      }),
    );
    assert.equal(readFileSync(join(root, "package.json"), "utf8"), original);
  }
  writeFileSync(join(root, "README.md"), "# Already edited\n");
  assert.throws(() =>
    execFileSync(process.execPath, [join(root, "scripts/src/rename-project.ts"), "acme-platform"], {
      stdio: "pipe",
    }),
  );
  assert.equal(readFileSync(join(root, "package.json"), "utf8"), original);
});
