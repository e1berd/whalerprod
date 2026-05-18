import { createRoute, createRouter } from "@kitbag/router"
import WorkspacesList from "@/pages/WorkspacesList.vue"
import WorkspaceCreate from "@/pages/WorkspaceCreate.vue"
import WorkspaceDetail from "@/pages/WorkspaceDetail.vue"
import SettingsPage from "@/pages/SettingsPage.vue"

const home = createRoute({
  name: "home",
  path: "/",
  component: WorkspacesList
})

const create = createRoute({
  name: "workspace-create",
  path: "/workspaces/new",
  component: WorkspaceCreate
})

const detail = createRoute({
  name: "workspace-detail",
  path: "/workspaces/[workspaceId]",
  component: WorkspaceDetail
})

const detailFile = createRoute({
  name: "workspace-file",
  path: "/workspaces/[workspaceId]/[filePath*]",
  component: WorkspaceDetail
})

const settings = createRoute({
  name: "settings",
  path: "/settings",
  component: SettingsPage
})

export const routes = [home, create, detail, detailFile, settings] as const

export const router = createRouter(routes, { historyMode: "browser" })

declare module "@kitbag/router" {
  interface Register {
    router: typeof router
  }
}
