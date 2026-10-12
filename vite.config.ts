import { agentNative } from "@agent-native/core/vite";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

const reactRouterPlugins = reactRouter as unknown as () => any[];

const agentNativePlugins = agentNative as unknown as (
  options?: Parameters<typeof agentNative>[0],
) => any[];

const isVercel = process.env.VERCEL === "1";

export default defineConfig({
  server: {
    hmr: {
      overlay: false,
    },
  },

  optimizeDeps: {
    entries: [
      "app/entry.client.tsx",
      "app/root.tsx",
      "app/components/layout/{Layout,Sidebar}.tsx",
      "app/components/chat/ChatRouteContent.tsx",
      "app/routes/{home,chat.$threadId}.tsx",
    ],
  },

  plugins: [
    ...reactRouterPlugins(),

    ...agentNativePlugins({
      ssrStubs: ["shiki"],
<<<<<<< HEAD

      ...(isVercel
        ? { nitro: { preset: "vercel" } }
        : {}),
=======
      nitro: { preset: "vercel" },
>>>>>>> 32f7d900d89d6a646efacad584b498dc9c8b8914
    }),
  ],
});
