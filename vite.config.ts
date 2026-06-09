import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { viteSingleFile } from "vite-plugin-singlefile";
import license from "rollup-plugin-license";

// Where the generated notices land. Absolute (resolved from this file) so the
// report always lands in the UI build dir regardless of the cwd the build runs
// from. extension.ts imports this file and embeds it in the shipped bundle.
const licenseReport = fileURLToPath(
  new URL("./ui/dist/third-party-licenses.txt", import.meta.url),
);

export default defineConfig({
  root: "ui",
  plugins: [viteSingleFile()],
  server: { port: 5173, fs: { allow: [".."] } },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "esnext",
    rollupOptions: {
      // rollup-plugin-license is an output-phase Rollup plugin, so it lives here
      // (not in top-level `plugins`) and runs only on `vite build`. It inspects
      // exactly the modules that end up in the bundle — tutts, jspdf, and jspdf's
      // transitive deps like fflate — and reproduces each one's copyright + full
      // license text. That's what makes the shipped .ablx satisfy the MIT terms;
      // an in-app credit link alone would not.
      plugins: [
        license({
          thirdParty: {
            includePrivate: false,
            output: {
              file: licenseReport,
              template(dependencies) {
                const rule = `\n\n${"=".repeat(72)}\n\n`;
                const header =
                  "AbleTab — third-party open-source licenses\n\n" +
                  "This extension bundles the open-source packages listed below. Each\n" +
                  "package's copyright notice and full license text is reproduced here, as\n" +
                  "required by those licenses (e.g. MIT).";
                const blocks = dependencies.map((d) => {
                  const repo =
                    d.homepage ||
                    (typeof d.repository === "string" ? d.repository : d.repository?.url) ||
                    "";
                  const head = [`${d.name}@${d.version} — ${d.license ?? "UNKNOWN"}`];
                  if (repo) head.push(repo);
                  const body =
                    d.licenseText?.trim() ||
                    d.noticeText?.trim() ||
                    `(No license text was shipped with this package. SPDX: ${d.license ?? "UNKNOWN"}.)`;
                  return `${head.join("\n")}\n\n${body}`;
                });
                return [header, ...blocks].join(rule) + "\n";
              },
            },
          },
        }),
      ],
    },
  },
});
