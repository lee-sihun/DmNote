const fs = require("fs");
const path = require("path");

const pkgPath = path.resolve(__dirname, "../package.json");
const tauriConfPath = path.resolve(__dirname, "../src-tauri/tauri.conf.json");
const cargoTomlPath = path.resolve(__dirname, "../src-tauri/Cargo.toml");
const readmePaths = [
  path.resolve(__dirname, "../README.md"),
  path.resolve(__dirname, "../docs/readme_en.md"),
  path.resolve(__dirname, "../docs/readme_zh-cn.md"),
];

const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const version = pkg.version;

console.log(`Syncing version to ${version}...`);

// 1. Update tauri.conf.json
if (fs.existsSync(tauriConfPath)) {
  const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, "utf8"));
  tauriConf.version = version;
  fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + "\n");
  console.log("Updated tauri.conf.json");
}

// 2. Update Cargo.toml
if (fs.existsSync(cargoTomlPath)) {
  let cargoToml = fs.readFileSync(cargoTomlPath, "utf8");
  cargoToml = cargoToml.replace(/^version = ".*"$/m, `version = "${version}"`);
  fs.writeFileSync(cargoTomlPath, cargoToml);
  console.log("Updated Cargo.toml");
}

// 3. Update README download labels/links
for (const readmePath of readmePaths) {
  if (!fs.existsSync(readmePath)) continue;

  let content = fs.readFileSync(readmePath, "utf8");
  content = content.replace(
    /releases\/download\/\d+\.\d+\.\d+\/DM\.NOTE\.v\.\d+\.\d+\.\d+\.zip/g,
    `releases/download/${version}/DM.NOTE.v.${version}.zip`,
  );
  content = content.replace(/DM NOTE v\d+\.\d+\.\d+/g, `DM NOTE v${version}`);

  fs.writeFileSync(readmePath, content);
  console.log(`Updated ${path.basename(readmePath)}`);
}

console.log("Done!");
