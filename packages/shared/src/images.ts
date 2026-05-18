export type SandboxImage = {
  id: string
  label: string
  image: string
  description: string
  languages: string[]
  defaultFiles?: Array<{
    path: string
    content: string
  }>
  preview: {
    webCommand: string
    terminalCommand: string
    port: number
  }
}

export const SANDBOX_IMAGES = [
  {
    id: "node-22",
    label: "Node.js 22",
    image: "node:22-bookworm-slim",
    description: "TypeScript, JavaScript, Vite, tooling",
    languages: ["typescript", "javascript", "json", "html", "css"],
    defaultFiles: [
      {
        path: "index.js",
        content: `console.log("Hello from Whaler")\n`
      },
      {
        path: "package.json",
        content: `{"type":"module","scripts":{"start":"node index.js"}}\n`
      }
    ],
    preview: {
      webCommand: "if [ -f package.json ] && grep -q 'vite' package.json; then printf 'import { defineConfig } from \"vite\"\\nexport default defineConfig({ server: { hmr: false } })\\n' > vite.config.whaler-preview.js && npm install && npx vite --host 0.0.0.0 --port ${PORT} --strictPort --config vite.config.whaler-preview.js; elif [ -f index.html ]; then npx --yes vite --host 0.0.0.0 --port ${PORT} --strictPort; else node --version && python3 -m http.server ${PORT} --bind 0.0.0.0; fi",
      terminalCommand: "if [ -n \"$FILE\" ]; then node \"$FILE\"; elif [ -f package.json ]; then npm install && npm run start; else node --version && ls -la; fi",
      port: 4173
    }
  },
  {
    id: "vite-vue",
    label: "Vite Vue",
    image: "whaler/sandbox-vite-vue:latest",
    description: "Vue starter with Vite preview defaults",
    languages: ["typescript", "javascript", "vue", "json", "html", "css"],
    defaultFiles: [
      {
        path: "package.json",
        content: `{"type":"module","scripts":{"dev":"vite","build":"vue-tsc --noEmit && vite build","preview":"vite preview"},"dependencies":{"@vitejs/plugin-vue":"^6.0.2","typescript":"^5.9.3","vite":"^7.2.4","vue":"^3.5.24","vue-tsc":"^3.1.4"},"devDependencies":{}}\n`
      },
      {
        path: "index.html",
        content: `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Whaler Vue Preview</title></head><body><div id="app"></div><script type="module" src="/src/main.ts"></script></body></html>\n`
      },
      {
        path: "src/main.ts",
        content: `import { createApp } from "vue"\nimport App from "./App.vue"\nimport "./style.css"\n\ncreateApp(App).mount("#app")\n`
      },
      {
        path: "src/App.vue",
        content: `<script setup lang="ts">\nconst message = "Whaler Vite Vue preview"\n</script>\n\n<template>\n  <main class="page">\n    <h1>{{ message }}</h1>\n    <p>Edit <code>src/App.vue</code> and press Play.</p>\n  </main>\n</template>\n`
      },
      {
        path: "src/style.css",
        content: `body{margin:0;font-family:Inter,system-ui,sans-serif;background:#101418;color:#f7fafc}.page{min-height:100vh;display:grid;place-content:center;text-align:center;gap:12px}h1{font-size:42px;margin:0}code{background:#26313a;padding:2px 6px;border-radius:6px}\n`
      },
      {
        path: "vite.config.ts",
        content: `import { defineConfig } from "vite"\nimport vue from "@vitejs/plugin-vue"\n\nexport default defineConfig({ plugins: [vue()], server: { hmr: false } })\n`
      },
      {
        path: "tsconfig.json",
        content: `{"compilerOptions":{"target":"ES2022","module":"ESNext","moduleResolution":"Bundler","strict":true,"jsx":"preserve","skipLibCheck":true},"include":["src/**/*.ts","src/**/*.vue"]}\n`
      }
    ],
    preview: {
      webCommand: "printf 'import base from \"./vite.config\"\\nimport { mergeConfig } from \"vite\"\\nexport default mergeConfig(base, { server: { hmr: false } })\\n' > vite.config.whaler-preview.ts && npm install && npx vite --host 0.0.0.0 --port ${PORT} --strictPort --config vite.config.whaler-preview.ts",
      terminalCommand: "if [ -n \"$FILE\" ] && [ \"${FILE##*.}\" = \"js\" ]; then node \"$FILE\"; else npm install && npm run build; fi",
      port: 4173
    }
  },
  {
    id: "vite-react",
    label: "Vite React",
    image: "whaler/sandbox-vite-react:latest",
    description: "React starter with Vite preview defaults",
    languages: ["typescript", "javascript", "tsx", "jsx", "json", "html", "css"],
    defaultFiles: [
      {
        path: "package.json",
        content: `{"type":"module","scripts":{"dev":"vite","build":"tsc -b && vite build","preview":"vite preview"},"dependencies":{"@vitejs/plugin-react":"^5.1.1","typescript":"^5.9.3","vite":"^7.2.4","react":"^19.2.1","react-dom":"^19.2.1","@types/react":"^19.2.7","@types/react-dom":"^19.2.3"},"devDependencies":{}}\n`
      },
      {
        path: "index.html",
        content: `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Whaler React Preview</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>\n`
      },
      {
        path: "src/main.tsx",
        content: `import React from "react"\nimport { createRoot } from "react-dom/client"\nimport "./style.css"\n\ncreateRoot(document.getElementById("root")!).render(<h1>Whaler Vite React preview</h1>)\n`
      },
      {
        path: "src/style.css",
        content: `body{margin:0;font-family:Inter,system-ui,sans-serif;background:#101418;color:#f7fafc;min-height:100vh;display:grid;place-content:center}h1{font-size:42px}\n`
      },
      {
        path: "vite.config.ts",
        content: `import { defineConfig } from "vite"\nimport react from "@vitejs/plugin-react"\n\nexport default defineConfig({ plugins: [react()], server: { hmr: false } })\n`
      },
      {
        path: "tsconfig.json",
        content: `{"compilerOptions":{"target":"ES2022","module":"ESNext","moduleResolution":"Bundler","jsx":"react-jsx","strict":true,"skipLibCheck":true},"include":["src"]}\n`
      }
    ],
    preview: {
      webCommand: "printf 'import base from \"./vite.config\"\\nimport { mergeConfig } from \"vite\"\\nexport default mergeConfig(base, { server: { hmr: false } })\\n' > vite.config.whaler-preview.ts && npm install && npx vite --host 0.0.0.0 --port ${PORT} --strictPort --config vite.config.whaler-preview.ts",
      terminalCommand: "if [ -n \"$FILE\" ] && [ \"${FILE##*.}\" = \"js\" ]; then node \"$FILE\"; else npm install && npm run build; fi",
      port: 4173
    }
  },
  {
    id: "vite-angular",
    label: "Angular 21+",
    image: "whaler/sandbox-vite-angular:latest",
    description: "Angular 21+ project image for browser previews",
    languages: ["typescript", "javascript", "html", "css", "json"],
    preview: {
      webCommand: "npm install && npm start -- --host 0.0.0.0 --port ${PORT}",
      terminalCommand: "npm install && npm run build",
      port: 4173
    }
  },
  {
    id: "vite-js",
    label: "Vite JavaScript",
    image: "whaler/sandbox-vite-js:latest",
    description: "Native JavaScript Vite project",
    languages: ["javascript", "json", "html", "css"],
    defaultFiles: [
      {
        path: "package.json",
        content: `{"type":"module","scripts":{"dev":"vite","build":"vite build","preview":"vite preview"},"dependencies":{"vite":"^7.2.4"},"devDependencies":{}}\n`
      },
      {
        path: "index.html",
        content: `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Whaler JS Preview</title></head><body><div id="app"></div><script type="module" src="/src/main.js"></script></body></html>\n`
      },
      {
        path: "src/main.js",
        content: `document.querySelector("#app").innerHTML = "<h1>Whaler Vite JavaScript preview</h1>"\n`
      }
    ],
    preview: {
      webCommand: "printf 'import { defineConfig } from \"vite\"\\nexport default defineConfig({ server: { hmr: false } })\\n' > vite.config.whaler-preview.js && npm install && npx vite --host 0.0.0.0 --port ${PORT} --strictPort --config vite.config.whaler-preview.js",
      terminalCommand: "if [ -n \"$FILE\" ]; then node \"$FILE\"; else npm install && npm run build; fi",
      port: 4173
    }
  },
  {
    id: "vite-ts",
    label: "Vite TypeScript",
    image: "whaler/sandbox-vite-ts:latest",
    description: "Native TypeScript Vite project",
    languages: ["typescript", "javascript", "json", "html", "css"],
    defaultFiles: [
      {
        path: "package.json",
        content: `{"type":"module","scripts":{"dev":"vite","build":"tsc && vite build","preview":"vite preview"},"dependencies":{"typescript":"^5.9.3","vite":"^7.2.4"},"devDependencies":{}}\n`
      },
      {
        path: "index.html",
        content: `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Whaler TS Preview</title></head><body><div id="app"></div><script type="module" src="/src/main.ts"></script></body></html>\n`
      },
      {
        path: "src/main.ts",
        content: `document.querySelector<HTMLDivElement>("#app")!.innerHTML = "<h1>Whaler Vite TypeScript preview</h1>"\n`
      },
      {
        path: "tsconfig.json",
        content: `{"compilerOptions":{"target":"ES2022","module":"ESNext","moduleResolution":"Bundler","strict":true,"skipLibCheck":true},"include":["src"]}\n`
      }
    ],
    preview: {
      webCommand: "printf 'import { defineConfig } from \"vite\"\\nexport default defineConfig({ server: { hmr: false } })\\n' > vite.config.whaler-preview.js && npm install && npx vite --host 0.0.0.0 --port ${PORT} --strictPort --config vite.config.whaler-preview.js",
      terminalCommand: "if [ -n \"$FILE\" ] && [ \"${FILE##*.}\" = \"js\" ]; then node \"$FILE\"; else npm install && npm run build; fi",
      port: 4173
    }
  },
  {
    id: "php-fpm",
    label: "PHP FPM",
    image: "php:8.4-fpm-alpine",
    description: "PHP scripts and FPM-compatible projects",
    languages: ["php", "html", "css", "javascript", "json"],
    defaultFiles: [
      {
        path: "index.php",
        content: `<?php\n$message = "Whaler PHP preview";\n?><h1><?= htmlspecialchars($message, ENT_QUOTES) ?></h1>\n`
      }
    ],
    preview: {
      webCommand: "php -S 0.0.0.0:${PORT} -t .",
      terminalCommand: "if [ -n \"$FILE\" ]; then php \"$FILE\"; else php -v && find . -name '*.php' -maxdepth 3 -print -exec php -l {} \\;; fi",
      port: 4173
    }
  },
  {
    id: "python-313",
    label: "Python 3.13",
    image: "python:3.13-slim",
    description: "Python scripts and small services",
    languages: ["python", "toml", "yaml", "json"],
    preview: {
      webCommand: "python -m http.server ${PORT} --bind 0.0.0.0",
      terminalCommand: "python --version && find . -maxdepth 2 -type f",
      port: 4173
    }
  },
  {
    id: "bun-12",
    label: "Bun 1.2",
    image: "oven/bun:1.2",
    description: "Bun runtime and package tooling",
    languages: ["typescript", "javascript", "json"],
    preview: {
      webCommand: "bun install && bun run dev --host 0.0.0.0 --port ${PORT}",
      terminalCommand: "bun install && bun run build",
      port: 4173
    }
  },
  {
    id: "deno-2",
    label: "Deno 2",
    image: "denoland/deno:2.3.5",
    description: "Deno runtime with TypeScript-first workflow",
    languages: ["typescript", "javascript", "json"],
    preview: {
      webCommand: "deno task dev --host 0.0.0.0 --port ${PORT}",
      terminalCommand: "deno task build || deno check .",
      port: 4173
    }
  }
] as const satisfies readonly SandboxImage[]

export type SandboxImageId = (typeof SANDBOX_IMAGES)[number]["id"]

export function getSandboxImage(id: string): SandboxImage | undefined {
  return SANDBOX_IMAGES.find((image) => image.id === id)
}
