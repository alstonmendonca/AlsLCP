const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");

const requiredPaths = [
  "src/main/main.js",
  "src/main/backup.js",
  "src/main/restore.js",
  "src/renderer/modules/renderer.js",
  "src/renderer/modules/ui.js",
  "src/renderer/styles/styles.css",
  "src/public/index.html",
  "main.js",
  "backup.js",
  "restore.js",
  "package.json",
];

const forbiddenRootFiles = [
  "getOnline.js",
  "startMongoExpress.js",
  "startMongoExpress.exe",
];

const forbiddenOnlineDeps = [
  "axios",
  "dotenv",
  "electron-log",
  "electron-updater",
  "express",
  "googleapis",
  "mongodb",
  "mongodb-memory-server",
  "mongoose",
  "ws",
];

const forbiddenOnlineResources = [
  ".env",
  "getOnline.js",
  "startMongoExpress.js",
  "startMongoExpress.exe",
];

function fail(message) {
  console.error(`Project structure verification failed: ${message}`);
  process.exit(1);
}

function ensureRequiredPathsExist() {
  const missing = requiredPaths.filter((relativePath) => {
    return !fs.existsSync(path.join(projectRoot, relativePath));
  });

  if (missing.length > 0) {
    fail(`Missing required files:\n- ${missing.join("\n- ")}`);
  }
}

function ensureRootIsClean() {
  const rootEntries = fs.readdirSync(projectRoot, { withFileTypes: true });
  const rootFiles = new Set(
    rootEntries.filter((entry) => entry.isFile()).map((entry) => entry.name)
  );

  const moduleFiles = fs
    .readdirSync(path.join(projectRoot, "src", "renderer", "modules"))
    .filter((name) => name.endsWith(".js"));

  const styleFiles = fs
    .readdirSync(path.join(projectRoot, "src", "renderer", "styles"))
    .filter((name) => name.endsWith(".css"));

  const duplicateRootModules = moduleFiles.filter((name) => rootFiles.has(name));
  const duplicateRootStyles = styleFiles.filter((name) => rootFiles.has(name));

  if (duplicateRootModules.length > 0 || duplicateRootStyles.length > 0) {
    const lines = [];

    if (duplicateRootModules.length > 0) {
      lines.push(
        `Root contains moved renderer modules:\n- ${duplicateRootModules.join("\n- ")}`
      );
    }

    if (duplicateRootStyles.length > 0) {
      lines.push(
        `Root contains moved renderer styles:\n- ${duplicateRootStyles.join("\n- ")}`
      );
    }

    fail(lines.join("\n"));
  }

  const forbiddenPresent = forbiddenRootFiles.filter((name) => rootFiles.has(name));
  if (forbiddenPresent.length > 0) {
    fail(`Forbidden online-only files found in root:\n- ${forbiddenPresent.join("\n- ")}`);
  }
}

function ensureHtmlUsesSrcPaths() {
  const indexHtml = fs.readFileSync(path.join(projectRoot, "src/public/index.html"), "utf8");

  const scriptMatch = /<script\s+src="([^"]+)"/g;
  const linkMatch = /<link\s+[^>]*href="([^"]+)"/g;

  const scriptPaths = [];
  const cssPaths = [];

  let scriptResult;
  while ((scriptResult = scriptMatch.exec(indexHtml)) !== null) {
    scriptPaths.push(scriptResult[1]);
  }

  let linkResult;
  while ((linkResult = linkMatch.exec(indexHtml)) !== null) {
    cssPaths.push(linkResult[1]);
  }

  const invalidScriptPaths = scriptPaths.filter((p) => {
    if (p.startsWith("http://") || p.startsWith("https://")) {
      return false;
    }

    return p.endsWith(".js") && !p.startsWith("src/renderer/modules/");
  });

  const invalidCssPaths = cssPaths.filter((p) => {
    if (p.startsWith("http://") || p.startsWith("https://")) {
      return false;
    }

    return p.endsWith(".css") && !p.startsWith("src/renderer/styles/");
  });

  if (invalidScriptPaths.length > 0) {
    fail(`index.html references non-src renderer scripts:\n- ${invalidScriptPaths.join("\n- ")}`);
  }

  if (invalidCssPaths.length > 0) {
    fail(`index.html references non-src renderer styles:\n- ${invalidCssPaths.join("\n- ")}`);
  }
}

function ensureOfflineDependencyPolicy() {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(projectRoot, "package.json"), "utf8")
  );

  const deps = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };

  const forbiddenDepsFound = forbiddenOnlineDeps.filter((name) => deps[name]);
  if (forbiddenDepsFound.length > 0) {
    fail(`Forbidden online dependencies found:\n- ${forbiddenDepsFound.join("\n- ")}`);
  }

  const extraResources = Array.isArray(packageJson.build?.extraResources)
    ? packageJson.build.extraResources
    : [];

  const forbiddenResourcesFound = extraResources
    .map((item) => item?.from)
    .filter((value) => typeof value === "string")
    .filter((fromPath) =>
      forbiddenOnlineResources.some((name) =>
        fromPath.toLowerCase().includes(name.toLowerCase())
      )
    );

  if (forbiddenResourcesFound.length > 0) {
    fail(`Forbidden online build resources found:\n- ${forbiddenResourcesFound.join("\n- ")}`);
  }
}

function main() {
  ensureRequiredPathsExist();
  ensureRootIsClean();
  ensureHtmlUsesSrcPaths();
  ensureOfflineDependencyPolicy();
  console.log("Project structure verification passed.");
}

main();
