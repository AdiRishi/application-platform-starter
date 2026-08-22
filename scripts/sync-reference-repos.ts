#!/usr/bin/env node
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { Schema } from "effect";
import * as YAML from "yaml";

import { referenceRepos, type ReferenceRepo } from "./lib/reference-repos.ts";

const repoRoot = NodePath.resolve(import.meta.dirname, "..");
const WorkspaceCatalog = Schema.Struct({
  catalog: Schema.Record(Schema.String, Schema.String),
});
const decodeWorkspaceCatalog = Schema.decodeUnknownSync(WorkspaceCatalog);

interface CliOptions {
  readonly dryRun: boolean;
  readonly latest: boolean;
  readonly repoId: string | undefined;
}

const parseOptions = (args: ReadonlyArray<string>): CliOptions => {
  const repoFlag = args.indexOf("--repo");
  return {
    dryRun: args.includes("--dry-run"),
    latest: args.includes("--latest"),
    repoId: repoFlag === -1 ? undefined : args[repoFlag + 1],
  };
};

const selectedRepos = (repoId: string | undefined) => {
  if (repoId === undefined) return referenceRepos;
  const selected = referenceRepos.find((repo) => repo.id === repoId);
  if (selected === undefined) {
    throw new Error(`Unknown reference repo "${repoId}".`);
  }
  return [selected];
};

const pinnedVersion = (repo: ReferenceRepo) => {
  const source = NodeFS.readFileSync(NodePath.join(repoRoot, repo.versionSourcePath), "utf8");
  const workspace = decodeWorkspaceCatalog(YAML.parse(source));
  const version = workspace.catalog[repo.catalogPackage];
  if (version === undefined) {
    throw new Error(`catalog.${repo.catalogPackage} is missing from ${repo.versionSourcePath}.`);
  }
  return version;
};

const assertCleanWorkingTree = () => {
  const status = NodeChildProcess.execFileSync("git", ["status", "--porcelain"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (status.trim().length > 0) {
    throw new Error("Commit or stash changes before syncing reference repositories.");
  }
};

const main = () => {
  const options = parseOptions(process.argv.slice(2));
  if (!options.dryRun) assertCleanWorkingTree();

  for (const repo of selectedRepos(options.repoId)) {
    const action = NodeFS.existsSync(NodePath.join(repoRoot, repo.prefix)) ? "pull" : "add";
    const ref = options.latest ? repo.latestRef : `${repo.versionTagPrefix}${pinnedVersion(repo)}`;
    const args = ["subtree", action, `--prefix=${repo.prefix}`, repo.repository, ref, "--squash"];
    process.stdout.write(`[sync:repos] ${repo.id}: git ${args.join(" ")}\n`);
    if (options.dryRun) continue;

    const result = NodeChildProcess.spawnSync("git", args, { cwd: repoRoot, stdio: "inherit" });
    if (result.status !== 0) {
      throw new Error(`git subtree ${action} failed with exit code ${result.status}.`);
    }
  }
};

try {
  main();
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
