import { mkdir, copyFile, readFile, writeFile, cp } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const directory of ["cmaps", "standard_fonts", "wasm"]) {
  await cp(
    resolve(root, "node_modules/pdfjs-dist", directory),
    resolve(root, "public/pdfjs", directory),
    { recursive: true },
  );
}
await mkdir(resolve(root, "public/schema"), { recursive: true });
await copyFile(
  resolve(root, "schema/study-document.schema.json"),
  resolve(root, "public/schema/study-document.schema.json"),
);
const lock = JSON.parse(
  await readFile(resolve(root, "package-lock.json"), "utf8"),
);
const dependencies = [];
for (const [path, pkg] of Object.entries(lock.packages)) {
  if (!path || !pkg.version) continue;
  const name = path.split("node_modules/").at(-1);
  dependencies.push({
    name,
    version: pkg.version,
    license: pkg.license ?? "See upstream distribution notice",
    development: !!pkg.dev,
    integrity: pkg.integrity ?? null,
  });
}
await mkdir(resolve(root, "public/notices"), { recursive: true });
const fontAssets = [
  {
    path: "../fonts/InterVariable.woff2",
    use: "Browser interface",
    sha256: "693b77d4f32ee9b8bfc995589b5fad5e99adf2832738661f5402f9978429a8e3",
  },
  {
    path: "../fonts/Inter-Regular.ttf",
    use: "Embedded PDF report text",
    sha256: "40d692fce188e4471e2b3cba937be967878f631ad3ebbbdcd587687c7ebe0c82",
  },
];
for (const font of fontAssets) {
  const actual = createHash("sha256")
    .update(await readFile(resolve(root, "public/notices", font.path)))
    .digest("hex");
  if (actual !== font.sha256)
    throw new Error(`Bundled font integrity check failed: ${font.path}`);
}
await writeFile(
  resolve(root, "public/notices/dependencies.json"),
  JSON.stringify(
    {
      application: "MIT",
      font: {
        name: "Inter",
        version: "4.1",
        license: "OFL-1.1",
        notice: "Inter-LICENSE.txt",
        source: "https://github.com/rsms/inter/releases/tag/v4.1",
        files: fontAssets,
      },
      javascript: dependencies,
      numerical_runtime: "../runtime/runtime-manifest.json",
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Prepared canonical schema and ${dependencies.length} package licence records.`,
);
