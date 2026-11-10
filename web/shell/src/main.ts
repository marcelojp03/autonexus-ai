import "./style.css";
import {
  addErrorHandler,
  getAppStatus,
  MOUNTED,
  navigateToUrl,
  registerApplication,
  start,
  triggerAppChange,
} from "single-spa";
import Keycloak from "keycloak-js";
import {
  browserOidcConfig,
  createBrowserSession,
} from "../../browser-auth/session";
import type { IntegratedProps } from "../../../contracts/auth/session";
import type { AppProps, LifeCycles } from "single-spa";
import {
  authorizedModules,
  matchesModule,
  moduleForPath,
  moduleProps,
  modules,
  moduleEntryPermissions,
} from "./routes";
import type { ModuleId } from "./routes";
import { OfflineWorkspace } from "./offline/workspace";
import { employeeEntryPath, sessionLabel } from "./navigation";

type IntegrationProps = IntegratedProps;
declare const __MF_BUILD_VERSION__: string;
type Props = AppProps & IntegrationProps;
type Lifecycle = (props: Props) => Promise<unknown>;
type Remote = Record<
  "bootstrap" | "mount" | "unmount",
  Lifecycle | Lifecycle[]
>;
const status = document.querySelector<HTMLElement>("#load-status")!;
const errors = new Map<string, string>();
const hosts = Object.fromEntries(
  modules.map((module) => [module, document.getElementById("mf-" + module)!]),
) as Record<ModuleId, HTMLElement>;
const sdk = new Keycloak(browserOidcConfig("shell"));
const logoutFromProvider = sdk.logout.bind(sdk);
sdk.logout = async (options) => {
  await triggerAppChange();
  await logoutFromProvider(options);
};
const owner = createBrowserSession(sdk, {
  origin: location.origin,
  application: "shell",
});
const session = owner.session;
const offlineHost = document.querySelector<HTMLElement>("#offline-workspace")!;
const offlineWorkspace = new OfflineWorkspace(offlineHost, session);
let offlineStarted: Promise<void> | undefined;
const isOfflineRoute = () => location.pathname === "/offline.html";
const canMount = () => session.snapshot().authenticated;
const loginButton =
  document.querySelector<HTMLButtonElement>("#session-login")!;
const logoutButton =
  document.querySelector<HTMLButtonElement>("#session-logout")!;
const technicalOutput =
  document.querySelector<HTMLElement>("#technical-result")!;
let diagnosticEpoch = 0;
let permissionSubject: string | undefined;
let navigationPermissions: readonly string[] = [];
let permissionEpoch = 0;
type GatedAccess = "loading" | "allowed" | "forbidden" | "unavailable";
/** Modules whose entry needs a permission beyond "some workshop role" (CU10 quotes, CU23 analysis). */
const MODULE_PERMISSION = moduleEntryPermissions;
const moduleAccess: Record<ModuleId, GatedAccess> = Object.fromEntries(
  modules.map((id) => [id, "loading"]),
) as Record<ModuleId, GatedAccess>;
const canAccess = (module: ModuleId) =>
  canMount() && moduleAccess[module] === "allowed";
async function loadModuleAccess(subject: string): Promise<void> {
  const epoch = ++permissionEpoch;
  try {
    const result = await session.requestBusiness(
      "query ModuleAccess { securityCatalog { effective } }",
    );
    if (permissionSubject !== subject || epoch !== permissionEpoch) return;
    const data = result.data as
      { securityCatalog?: { effective?: string[] } } | undefined;
    navigationPermissions =
      !result.errors?.length && Array.isArray(data?.securityCatalog?.effective)
        ? data.securityCatalog.effective
        : [];
    const effective =
      !result.errors?.length && Array.isArray(data?.securityCatalog?.effective)
        ? data.securityCatalog.effective
        : undefined;
    for (const id of modules) {
      const permissions = MODULE_PERMISSION[id];
      moduleAccess[id] =
        effective === undefined
          ? "unavailable"
          : permissions.some((permission) => effective.includes(permission))
            ? "allowed"
            : "forbidden";
    }
  } catch {
    if (permissionSubject !== subject || epoch !== permissionEpoch) return;
    for (const id of modules) moduleAccess[id] = "unavailable";
  }
  renderNavigation();
  await triggerAppChange();
  reconcileWorkspaceRoute();
}

function reconcileWorkspaceRoute(): void {
  if (
    !session.snapshot().authenticated ||
    modules.some((id) => moduleAccess[id] === "loading")
  )
    return;
  const allowed = authorizedModules(navigationPermissions);
  const active = moduleForPath(location.pathname);
  if (active && allowed.includes(active)) return;
  if (
    location.pathname === "/auth/callback" ||
    location.pathname === "/offline.html"
  )
    return;
  if (allowed.length === 1) {
    const module = allowed[0]!;
    const landing =
      module === "employees"
        ? employeeEntryPath(navigationPermissions)
        : module === "operations"
          ? "/operations/" +
            (navigationPermissions.includes("appointments:read")
              ? "appointments"
              : "customers")
          : "/" + module;
    navigateToUrl(
      location.pathname === "/" || location.pathname === "/workspace"
        ? landing
        : "/" + module,
    );
  } else if (
    location.pathname === "/" ||
    location.pathname === "/workspace" ||
    (active && !allowed.includes(active))
  ) {
    navigateToUrl("/workspace");
  }
}

function renderNavigation(): void {
  const module = moduleForPath(location.pathname);
  const snapshot = session.snapshot();
  const allowed = canMount();
  const authorized = authorizedModules(navigationPermissions);
  const chooser = document.getElementById("workspace-chooser");
  if (chooser)
    chooser.hidden =
      !allowed ||
      location.pathname !== "/workspace" ||
      authorized.length < 2 ||
      modules.some(
        (id) =>
          moduleAccess[id] === "loading" || moduleAccess[id] === "unavailable",
      );
  const permissionError = document.getElementById("permission-error");
  if (permissionError)
    permissionError.hidden =
      !allowed || !modules.some((id) => moduleAccess[id] === "unavailable");
  const noWorkspaces = document.getElementById("no-workspaces");
  if (noWorkspaces)
    noWorkspaces.hidden =
      !allowed ||
      modules.some(
        (id) =>
          moduleAccess[id] === "loading" || moduleAccess[id] === "unavailable",
      ) ||
      authorized.length !== 0;
  const workspaceList = document.getElementById("workspace-list");
  if (workspaceList) {
    workspaceList.replaceChildren();
    const labels: Record<ModuleId, [string, string]> = {
      employees: ["Empleados", "Agenda, ejecución y coordinación del equipo"],
      operations: [
        "Operaciones",
        "Clientes, vehículos, citas y órdenes de servicio",
      ],
      finance: ["Finanzas", "Cotizaciones, cobros y gastos del taller"],
      intelligence: [
        "Inteligencia",
        "Inspecciones visuales y análisis autorizados",
      ],
    };
    for (const id of authorized) {
      const choice = document.createElement("button");
      choice.className = "workspace-choice";
      choice.type = "button";
      const [title, description] = labels[id];
      choice.textContent = `${title} — ${description}`;
      choice.addEventListener("click", () => navigateToUrl("/" + id));
      workspaceList.append(choice);
    }
  }
  offlineHost.hidden = !isOfflineRoute();
  if (isOfflineRoute() && !offlineStarted)
    offlineStarted = offlineWorkspace.start().catch(() => {
      offlineHost.textContent =
        "No se pudo abrir el almacenamiento local. No borres los datos del navegador: reintentá recargando.";
    });
  document.title =
    (module === "employees"
      ? "Empleados"
      : module === "operations"
        ? "Operaciones"
        : module === "finance"
          ? "Finanzas"
          : module === "intelligence"
            ? "Inteligencia"
            : "Sesión") + " · AutoNexus";
  document.getElementById("route-error")!.hidden =
    isOfflineRoute() ||
    !allowed ||
    !!module ||
    location.pathname === "/" ||
    location.pathname === "/workspace";
  for (const id of modules) hosts[id].hidden = !canAccess(id) || id !== module;
  const accessNotice = document.querySelector<HTMLElement>("#module-access")!;
  const gated =
    module !== undefined && MODULE_PERMISSION[module] !== undefined
      ? module
      : undefined;
  const access = gated ? moduleAccess[gated] : "allowed";
  const label = gated === "finance" ? "Finanzas" : "Inteligencia";
  const denied =
    gated === "finance"
      ? "los módulos de Finanzas."
      : "análisis de Inteligencia.";
  accessNotice.hidden = !allowed || !gated || access === "allowed";
  accessNotice.textContent =
    access === "forbidden"
      ? "Acceso insuficiente: no tenés permiso para consultar " + denied
      : access === "unavailable"
        ? "No se pudieron verificar los permisos de " +
          label +
          ". Recargá para reintentar."
        : "Comprobando permisos de " + label + "…";
  document.querySelector<HTMLElement>("#session-identity")!.textContent =
    snapshot.identity ? sessionLabel(snapshot.identity.roles) : "";
  document.querySelector<HTMLElement>("#session-status")!.textContent =
    snapshot.notice ??
    (snapshot.phase === "initializing"
      ? "Comprobando sesión…"
      : snapshot.authenticated
        ? allowed
          ? "Tu espacio de trabajo"
          : "Esta cuenta no tiene acceso al taller. Cerrá sesión para cambiar de cuenta."
        : "Ingresá con tu cuenta para organizar el trabajo del taller.");
  document.querySelector<HTMLElement>("#welcome-panel")!.hidden =
    snapshot.authenticated ||
    snapshot.phase === "initializing" ||
    isOfflineRoute();
  loginButton.hidden =
    snapshot.authenticated || snapshot.phase === "initializing";
  document.getElementById("welcome-panel")!.hidden =
    snapshot.authenticated ||
    snapshot.phase === "initializing" ||
    isOfflineRoute();
  if (isOfflineRoute() && !navigator.onLine && !snapshot.authenticated) {
    document.querySelector<HTMLElement>("#session-status")!.textContent =
      "Sin red: copia local disponible. Restablecé sesión con conexión para sincronizar.";
    loginButton.hidden = false;
  }
  logoutButton.hidden = !snapshot.authenticated;
  document.querySelector<HTMLElement>("#technical-controls")!.hidden =
    !allowed ||
    !navigationPermissions.includes("security:read") ||
    new URLSearchParams(location.search).get("diagnostics") !== "1";
  document
    .querySelectorAll<HTMLAnchorElement>("[data-module]")
    .forEach((link) => {
      link.hidden =
        !allowed || moduleAccess[link.dataset.module as ModuleId] !== "allowed";
      if (link.dataset.module === "employees")
        link.href = employeeEntryPath(navigationPermissions);
      if (link.dataset.module === module)
        link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    });
  document
    .querySelectorAll<HTMLElement>("[data-employee-link]")
    .forEach((link) => {
      link.hidden =
        !allowed ||
        module !== "employees" ||
        (!!link.dataset.permission &&
          !navigationPermissions.includes(link.dataset.permission));
    });
  document
    .querySelectorAll<HTMLElement>("[data-operations-link]")
    .forEach((link) => {
      link.hidden =
        !allowed ||
        module !== "operations" ||
        (!!link.dataset.permission &&
          !navigationPermissions.includes(link.dataset.permission));
    });
  document
    .querySelectorAll<HTMLElement>("[data-finance-link]")
    .forEach((link) => {
      link.hidden = !allowed || module !== "finance";
    });
  document
    .querySelectorAll<HTMLElement>("[data-intelligence-link]")
    .forEach((link) => {
      link.hidden = !allowed || module !== "intelligence";
    });
  document
    .querySelectorAll<HTMLElement>("[data-mcp-integration-link]")
    .forEach((link) => {
      link.hidden =
        !allowed || !navigationPermissions.includes("mcp-clients:manage");
    });
  document
    .querySelectorAll<HTMLAnchorElement>("#demo-nav a")
    .forEach((link) => {
      if (
        location.pathname.replace(/\/$/, "") ===
        new URL(link.href).pathname.replace(/\/$/, "")
      )
        link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  document
    .querySelectorAll<HTMLAnchorElement>("[data-page]")
    .forEach((link) => {
      link.hidden = !module || !allowed || module === "finance";
      if (!module) return;
      link.href = "/" + module + "/" + link.dataset.page;
      if (location.pathname === new URL(link.href).pathname)
        link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  const name = "@autonexus/" + module;
  const message = module ? errors.get(name) : undefined;
  status.textContent =
    !module || !canAccess(module)
      ? ""
      : (message ?? (getAppStatus(name) === MOUNTED ? "" : "Cargando módulo…"));
  status.hidden = !status.textContent;
  if (module)
    hosts[module].setAttribute(
      "aria-busy",
      String(!message && getAppStatus(name) !== MOUNTED),
    );
  // El aviso de plantilla y las páginas de demostración describen el template, no el trabajo del
  // taller: sólo se muestran en sus propias rutas. Una pantalla empresarial no los repite.
  const templateDemo =
    /^\/(?:employees|operations)\/(?:widgets|dashboard(?:\/|$))/.test(
      location.pathname,
    );
  const banner = document.getElementById("template-demo-banner");
  if (banner) banner.hidden = !templateDemo;
  const demoNav = document.getElementById("demo-nav");
  if (demoNav)
    demoNav.hidden = !Array.from(demoNav.children).some(
      (child) => !(child as HTMLElement).hidden,
    );
}

function instrument(app: string, remote: Remote): LifeCycles<IntegrationProps> {
  let mounted = false;
  const wrap =
    (phase: "bootstrap" | "mount" | "unmount") => async (props: Props) => {
      window.dispatchEvent(
        new CustomEvent("autonexus:lifecycle", {
          detail: {
            app,
            phase: phase + ":start",
            host: props.domElement?.id,
            connected: props.domElement?.isConnected,
            basePath: props.basePath,
          },
        }),
      );
      try {
        if (phase === "mount" && !canMount()) return;
        if (phase === "unmount" && !mounted) return;
        const steps = remote[phase];
        for (const step of Array.isArray(steps) ? steps : [steps])
          await step(props);
        if (phase === "mount") mounted = true;
        if (phase === "unmount") mounted = false;
        if (phase === "mount" && !canMount()) {
          const cleanup = remote.unmount;
          for (const step of Array.isArray(cleanup) ? cleanup : [cleanup])
            await step(props);
          mounted = false;
        }
        if (phase === "mount") errors.delete(app);
        window.dispatchEvent(
          new CustomEvent("autonexus:lifecycle", {
            detail: { app, phase: phase + ":end" },
          }),
        );
      } catch (error) {
        window.dispatchEvent(
          new CustomEvent("autonexus:lifecycle", {
            detail: { app, phase: phase + ":error" },
          }),
        );
        throw error;
      }
    };
  return {
    bootstrap: wrap("bootstrap"),
    mount: wrap("mount"),
    unmount: wrap("unmount"),
  };
}

for (const module of modules) {
  const name = "@autonexus/" + module;
  registerApplication<IntegrationProps>({
    name,
    app: async () => {
      errors.delete(name);
      renderNavigation();
      const source = "/mfs/" + module + "/main.js?v=" + __MF_BUILD_VERSION__;
      const remote: Remote = await import(/* @vite-ignore */ source);
      for (const phase of ["bootstrap", "mount", "unmount"] as const) {
        const steps = remote[phase];
        if (!(
          typeof steps === "function" ||
          (Array.isArray(steps) &&
            steps.length &&
            steps.every((step) => typeof step === "function"))
        ))
          throw new Error(
            "El módulo " + module + " no exporta el ciclo " + phase,
          );
      }
      return instrument(name, remote);
    },
    activeWhen: (url) =>
      canAccess(module) && matchesModule(url.pathname, module),
    customProps: { domElement: hosts[module], ...moduleProps(module), session },
  });
}
document
  .querySelectorAll<HTMLAnchorElement>("[data-shell-link]")
  .forEach((link) => {
    link.addEventListener("click", (event) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      event.preventDefault();
      if (new URL(link.href).pathname === "/offline.html") {
        navigateToUrl(link.href);
        return;
      }
      if (!session.snapshot().authenticated) {
        void session.login(new URL(link.href).pathname);
        return;
      }
      const targetModule = moduleForPath(new URL(link.href).pathname);
      if (targetModule && !canAccess(targetModule)) {
        navigateToUrl("/workspace");
        return;
      }
      navigateToUrl(link.href);
    });
  });
addErrorHandler((error) => {
  console.error("Error al cargar el microfrontend:", error);
  errors.set(
    error.appOrParcelName,
    "No se pudo cargar el módulo. Podés navegar a otro módulo o recargar para reintentar.",
  );
  renderNavigation();
});
window.addEventListener("single-spa:before-routing-event", renderNavigation);
window.addEventListener("single-spa:routing-event", renderNavigation);
loginButton.addEventListener("click", () => {
  loginButton.disabled = true;
  void owner
    .start()
    .then(() => session.login(isOfflineRoute() ? "/offline.html" : undefined))
    .finally(() => {
      loginButton.disabled = false;
    });
});
logoutButton.addEventListener("click", () => {
  void offlineWorkspace.clearForLogout().then((ok) => {
    if (ok) return session.logout();
  });
});
document
  .querySelectorAll<HTMLButtonElement>("[data-technical-service]")
  .forEach((button) => {
    button.addEventListener("click", async () => {
      const version = diagnosticEpoch;
      button.disabled = true;
      technicalOutput.textContent = "Comprobando acceso en el servidor…";
      try {
        const result = await session.requestTechnical(
          button.dataset.technicalService as "employees" | "operations",
          button.dataset.technicalResource as "session" | "admin",
        );
        if (version === diagnosticEpoch)
          technicalOutput.textContent =
            result.resource === "admin"
              ? "Acceso administrativo confirmado por " + result.service + "."
              : "Sesión confirmada por " +
                result.service +
                ": " +
                result.subject +
                " · " +
                result.roles.join(", ");
      } catch (error) {
        if (version === diagnosticEpoch)
          technicalOutput.textContent =
            error instanceof Error
              ? error.message
              : "No se pudo completar la comprobación técnica.";
      } finally {
        button.disabled = false;
      }
    });
  });
document.getElementById("permission-retry")?.addEventListener("click", () => {
  const subject = session.snapshot().identity?.subject;
  if (subject) void loadModuleAccess(subject);
});
session.subscribe(() => {
  const subject = session.snapshot().identity?.subject;
  if (subject !== permissionSubject) {
    permissionEpoch++;
    permissionSubject = subject;
    for (const id of modules) moduleAccess[id] = "loading";
    navigationPermissions = [];
    if (subject) void loadModuleAccess(subject);
  }
  if (!session.snapshot().authenticated) {
    diagnosticEpoch++;
    technicalOutput.textContent = "";
  }
  renderNavigation();
  void triggerAppChange();
  reconcileWorkspaceRoute();
});
if (!isOfflineRoute() || navigator.onLine) await owner.start();
else {
  document.querySelector<HTMLElement>("#session-status")!.textContent =
    "Sin red: podés trabajar en tu copia local. Sincronizar exige restablecer sesión.";
  loginButton.hidden = false;
}
renderNavigation();
start({ urlRerouteOnly: true });
// A cached document resumes without evaluating this module again. pagehide has
// disposed its session owner; reload only BFCache restores to obtain a fresh one.
window.addEventListener("pageshow", (event) => {
  if (event.persisted) location.reload();
});
window.addEventListener("pagehide", () => owner.dispose(), { once: true });
