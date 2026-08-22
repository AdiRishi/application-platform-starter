#!/usr/bin/env node
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const root = NodePath.resolve(import.meta.dirname, "..");
const oldName = "application-platform-starter";

const name = process.argv[2];
if (name === undefined || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name)) {
  process.stderr.write("Usage: pnpm rename <kebab-case-name>\n");
  process.exit(1);
}

const title = name
  .split("-")
  .map((part) => `${part[0]?.toUpperCase()}${part.slice(1)}`)
  .join(" ");
const stackName = title.replaceAll(" ", "");

const packagePath = NodePath.join(root, "package.json");
const packageJson: unknown = JSON.parse(NodeFS.readFileSync(packagePath, "utf8"));
if (typeof packageJson !== "object" || packageJson === null || !("name" in packageJson)) {
  throw new Error("package.json does not contain a name.");
}
const renamedPackage = { ...packageJson, name };
NodeFS.writeFileSync(packagePath, `${JSON.stringify(renamedPackage, null, 2)}\n`);

const projectPath = NodePath.join(root, "infra/src/project.ts");
const projectSource = NodeFS.readFileSync(projectPath, "utf8");
NodeFS.writeFileSync(
  projectPath,
  projectSource.replace(oldName, name).replace("ApplicationPlatformStarter", stackName),
);

const readmePath = NodePath.join(root, "README.md");
const readme = NodeFS.readFileSync(readmePath, "utf8");
NodeFS.writeFileSync(readmePath, readme.replace("# Application Platform Starter", `# ${title}`));

process.stdout.write(`Renamed the project to ${name}. Run pnpm install to refresh the lockfile.\n`);
