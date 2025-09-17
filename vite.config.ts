import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import path from "path";

export default defineConfig(() => {
  const projectRoot = __dirname;
  const rendererRoot = path.resolve(projectRoot, "src/renderer");
  const windowsRoot = path.resolve(rendererRoot, "windows");

  return {
    // Vite 개발 서버 루트: /main/index.html, /overlay/index.html 경로로 접근 가능
    root: windowsRoot,
    base: "./",
    plugins: [
      react(),
      svgr({
        include: "**/*.svg",
        svgrOptions: {
          // named export: { ReactComponent }
          exportType: "default",
        },
      }),
    ],
    server: {
      port: 3000,
      strictPort: true,
      open: false,
      fs: {
        // 루트 상위(src/renderer 등) 경로 import 허용
        allow: [projectRoot, rendererRoot, windowsRoot],
      },
    },
    resolve: {
      alias: {
        "@components": path.resolve(rendererRoot, "components"),
        "@styles": path.resolve(rendererRoot, "styles"),
        "@windows": path.resolve(rendererRoot, "windows"),
        "@hooks": path.resolve(rendererRoot, "hooks"),
        "@assets": path.resolve(rendererRoot, "assets"),
        "@utils": path.resolve(rendererRoot, "utils"),
        "@stores": path.resolve(rendererRoot, "stores"),
        "@constants": path.resolve(rendererRoot, "constants"),
      },
      extensions: [".mjs", ".js", ".ts", ".jsx", ".tsx", ".json"],
    },
    build: {
      outDir: path.resolve(projectRoot, "dist/renderer"),
      emptyOutDir: true,
      rollupOptions: {
        input: {
          main: path.resolve(windowsRoot, "main/index.html"),
          overlay: path.resolve(windowsRoot, "overlay/index.html"),
        },
      },
    },
  };
});
