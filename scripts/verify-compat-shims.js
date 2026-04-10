const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");

const jsShimPattern = /^module\.exports = require\("\.\/src\/renderer\/modules\/(.+)"\);\s*$/;
const cssShimPattern = /^@import url\("\.\/src\/renderer\/styles\/(.+)"\);\s*$/;
const mainLauncherPattern = /^require\("\.\/src\/main\/main\.js"\);\s*$/;
const mainShimPattern = /^module\.exports = require\("\.\/src\/main\/(.+)"\);\s*$/;

function listRootFiles() {
  return fs
    .readdirSync(projectRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
}

function verifyShims() {
  const files = listRootFiles();
  const jsFiles = files.filter((name) => name.endsWith(".js"));
  const cssFiles = files.filter((name) => name.endsWith(".css"));

  const missingTargets = [];

  for (const fileName of jsFiles) {
    const filePath = path.join(projectRoot, fileName);
    const content = fs.readFileSync(filePath, "utf8").trim();

    const mainLauncherMatch = content.match(mainLauncherPattern);
    if (mainLauncherMatch) {
      const target = path.join(projectRoot, "src", "main", "main.js");
      if (!fs.existsSync(target)) {
        missingTargets.push({ fileName, target });
      }
      continue;
    }

    const mainShimMatch = content.match(mainShimPattern);
    if (mainShimMatch) {
      const target = path.join(projectRoot, "src", "main", mainShimMatch[1]);
      if (!fs.existsSync(target)) {
        missingTargets.push({ fileName, target });
      }
      continue;
    }

    const match = content.match(jsShimPattern);

    if (!match) {
      continue;
    }

    const target = path.join(projectRoot, "src", "renderer", "modules", match[1]);
    if (!fs.existsSync(target)) {
      missingTargets.push({ fileName, target });
    }
  }

  for (const fileName of cssFiles) {
    const filePath = path.join(projectRoot, fileName);
    const content = fs.readFileSync(filePath, "utf8").trim();
    const match = content.match(cssShimPattern);

    if (!match) {
      continue;
    }

    const target = path.join(projectRoot, "src", "renderer", "styles", match[1]);
    if (!fs.existsSync(target)) {
      missingTargets.push({ fileName, target });
    }
  }

  if (missingTargets.length > 0) {
    console.error("Compatibility shim verification failed.");
    for (const item of missingTargets) {
      console.error(`- ${item.fileName} -> missing target ${item.target}`);
    }
    process.exit(1);
  }

  console.log("Compatibility shim verification passed.");
}

verifyShims();
