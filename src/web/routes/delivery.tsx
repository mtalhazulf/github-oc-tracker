import { Hono } from "hono";
import type { Context } from "hono";
import type { Store } from "../../db/store.ts";
import type { ClientRow, ProjectRow } from "../../db/store.ts";
import { ValidationError } from "../../domain/errors.ts";
import type { DeliveryService } from "../../services/delivery.ts";
import type { SyncService } from "../../sync/service.ts";
import { friendlyError, page, partial } from "../http.tsx";
import { tzOffsetSeconds } from "../format.ts";
import { Layout } from "../views/Layout.tsx";
import { ClientDetailPage, ClientForm, ClientsPage, ClientsTable } from "../views/ClientsPage.tsx";
import {
  ProjectDetailPage,
  ProjectForm,
  ProjectsPage,
  ProjectsTable,
  RepoPanel,
  TeamPanel,
} from "../views/ProjectsPage.tsx";

const ACTIVITY_DAYS = 90;

function values(body: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) out[k] = v === undefined ? "" : String(v);
  return out;
}

function clientValues(cl: ClientRow): Record<string, string> {
  return {
    name: cl.name,
    code: cl.code,
    status: cl.status,
    currency: cl.currency,
    country: cl.country ?? "",
    website: cl.website ?? "",
    contact_name: cl.contact_name ?? "",
    contact_email: cl.contact_email ?? "",
    billing_email: cl.billing_email ?? "",
    billing_address: cl.billing_address ?? "",
    tax_id: cl.tax_id ?? "",
    payment_terms_days: String(cl.payment_terms_days),
    notes: cl.notes ?? "",
  };
}

function money(minor: number | null): string {
  if (minor === null) return "";
  return (minor / 100).toFixed(2);
}

function projectValues(p: ProjectRow): Record<string, string> {
  return {
    code: p.code,
    name: p.name,
    kind: p.kind,
    client_id: p.client_id === null ? "" : String(p.client_id),
    status: p.status,
    billing_model: p.billing_model,
    currency: p.currency,
    budget_minor: money(p.budget_minor),
    rate_hourly_minor: money(p.rate_hourly_minor),
    retainer_monthly_minor: money(p.retainer_monthly_minor),
    start_on: p.start_on ?? "",
    end_on: p.end_on ?? "",
    manager_id: p.manager_id === null ? "" : String(p.manager_id),
    notes: p.notes ?? "",
  };
}

export function createDeliveryRoutes(store: Store, delivery: DeliveryService, sync: SyncService): Hono {
  const app = new Hono();

  const since = (days: number) => Math.floor(Date.now() / 1000) - days * 86_400;

  // ================= clients =================

  function clientFilters(c: Context) {
    return {
      q: (c.req.query("q") ?? "").trim(),
      status: c.req.query("status") ?? "",
      archived: c.req.query("archived") === "1",
    };
  }

  function clientList(c: Context) {
    const f = clientFilters(c);
    return {
      filters: f,
      rows: store.listClients({ q: f.q || undefined, status: f.status || undefined, includeArchived: f.archived }),
    };
  }

  app.get("/clients", (c) => {
    const { filters, rows } = clientList(c);
    return page(
      c,
      <Layout title="Clients" active="clients">
        <ClientsPage clients={rows} filters={filters} />
      </Layout>,
    );
  });

  app.get("/clients/table", (c) => partial(c, <ClientsTable clients={clientList(c).rows} />));

  app.get("/clients/new", (c) =>
    page(
      c,
      <Layout title="Add client" active="clients">
        <ClientForm values={{ status: "active", currency: store.getSettings().base_currency, payment_terms_days: "30" }} errors={{}} />
      </Layout>,
    ),
  );

  app.post("/clients", async (c) => {
    const body = (await c.req.parseBody()) as Record<string, unknown>;
    try {
      const created = delivery.createClient(body);
      c.header("HX-Redirect", `/clients/${created.id}`);
      return c.text("ok");
    } catch (err) {
      return partial(
        c,
        <ClientForm
          values={values(body)}
          errors={err instanceof ValidationError ? err.fields : {}}
          message={err instanceof ValidationError ? undefined : friendlyError(err)}
        />,
        422,
      );
    }
  });

  app.get("/clients/:id", (c) => {
    const id = Number(c.req.param("id"));
    const client = store.getClient(id);
    if (!client) return c.notFound();
    return page(
      c,
      <Layout title={client.name} active="clients">
        <ClientDetailPage client={client} projects={store.listProjects({ clientId: id })} />
      </Layout>,
    );
  });

  app.get("/clients/:id/edit", (c) => {
    const client = store.getClient(Number(c.req.param("id")));
    if (!client) return c.notFound();
    return page(
      c,
      <Layout title={`Edit ${client.name}`} active="clients">
        <ClientForm client={client} values={clientValues(client)} errors={{}} />
      </Layout>,
    );
  });

  app.post("/clients/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const client = store.getClient(id);
    if (!client) return c.notFound();
    const body = (await c.req.parseBody()) as Record<string, unknown>;
    try {
      delivery.updateClient(id, body);
      c.header("HX-Redirect", `/clients/${id}`);
      return c.text("ok");
    } catch (err) {
      return partial(
        c,
        <ClientForm
          client={client}
          values={values(body)}
          errors={err instanceof ValidationError ? err.fields : {}}
          message={err instanceof ValidationError ? undefined : friendlyError(err)}
        />,
        422,
      );
    }
  });

  app.post("/clients/:id/archive", (c) => {
    delivery.archiveClient(Number(c.req.param("id")), true);
    c.header("HX-Redirect", `/clients/${c.req.param("id")}`);
    return c.text("ok");
  });

  app.post("/clients/:id/restore", (c) => {
    delivery.archiveClient(Number(c.req.param("id")), false);
    c.header("HX-Redirect", `/clients/${c.req.param("id")}`);
    return c.text("ok");
  });

  app.delete("/clients/:id", (c) => {
    try {
      delivery.removeClient(Number(c.req.param("id")));
      c.header("HX-Redirect", "/clients");
      return c.text("ok");
    } catch (err) {
      return c.text(friendlyError(err), 409);
    }
  });

  // ================= projects =================

  function projectFilters(c: Context) {
    return {
      q: (c.req.query("q") ?? "").trim(),
      status: c.req.query("status") ?? "",
      kind: c.req.query("kind") ?? "",
      clientId: c.req.query("client_id") ?? "",
      archived: c.req.query("archived") === "1",
    };
  }

  function projectList(c: Context) {
    const f = projectFilters(c);
    return {
      filters: f,
      rows: store.listProjects({
        q: f.q || undefined,
        status: f.status || undefined,
        kind: f.kind || undefined,
        clientId: /^\d+$/.test(f.clientId) ? Number(f.clientId) : undefined,
        includeArchived: f.archived,
      }),
    };
  }

  app.get("/projects", (c) => {
    const { filters, rows } = projectList(c);
    return page(
      c,
      <Layout title="Projects" active="projects">
        <ProjectsPage projects={rows} clients={store.listClients()} filters={filters} />
      </Layout>,
    );
  });

  app.get("/projects/table", (c) => partial(c, <ProjectsTable projects={projectList(c).rows} />));

  app.get("/projects/new", (c) => {
    const clientId = c.req.query("client_id") ?? "";
    return page(
      c,
      <Layout title="New project" active="projects">
        <ProjectForm
          clients={store.listClients()}
          managers={store.listEmployees()}
          values={{
            kind: "client",
            status: "active",
            billing_model: "time_materials",
            currency: store.getSettings().base_currency,
            client_id: clientId,
          }}
          errors={{}}
        />
      </Layout>,
    );
  });

  app.post("/projects", async (c) => {
    const body = (await c.req.parseBody()) as Record<string, unknown>;
    try {
      const created = delivery.createProject(body);
      c.header("HX-Redirect", `/projects/${created.id}`);
      return c.text("ok");
    } catch (err) {
      return partial(
        c,
        <ProjectForm
          clients={store.listClients()}
          managers={store.listEmployees()}
          values={values(body)}
          errors={err instanceof ValidationError ? err.fields : {}}
          message={err instanceof ValidationError ? undefined : friendlyError(err)}
        />,
        422,
      );
    }
  });

  app.get("/projects/:id", (c) => {
    const id = Number(c.req.param("id"));
    const project = store.getProject(id);
    if (!project) return c.notFound();
    const sinceTs = since(ACTIVITY_DAYS);
    return page(
      c,
      <Layout title={project.name} active="projects">
        <ProjectDetailPage
          project={project}
          repos={store.listProjectRepos(id)}
          linkable={store.linkableRepos(id)}
          assignments={store.listAssignments(id)}
          employees={store.listEmployees()}
          activity={store.projectActivity(id, {
            sinceTs,
            beforeTs: Math.floor(Date.now() / 1000) + 86_400,
            limit: 15,
          })}
          contributors={store.projectContributors(id, sinceTs)}
          perDay={store.projectCommitsPerDay(id, sinceTs, tzOffsetSeconds)}
          days={ACTIVITY_DAYS}
        />
      </Layout>,
    );
  });

  app.get("/projects/:id/edit", (c) => {
    const project = store.getProject(Number(c.req.param("id")));
    if (!project) return c.notFound();
    return page(
      c,
      <Layout title={`Edit ${project.name}`} active="projects">
        <ProjectForm
          project={project}
          clients={store.listClients()}
          managers={store.listEmployees()}
          values={projectValues(project)}
          errors={{}}
        />
      </Layout>,
    );
  });

  app.post("/projects/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const project = store.getProject(id);
    if (!project) return c.notFound();
    const body = (await c.req.parseBody()) as Record<string, unknown>;
    try {
      delivery.updateProject(id, body);
      c.header("HX-Redirect", `/projects/${id}`);
      return c.text("ok");
    } catch (err) {
      return partial(
        c,
        <ProjectForm
          project={project}
          clients={store.listClients()}
          managers={store.listEmployees()}
          values={values(body)}
          errors={err instanceof ValidationError ? err.fields : {}}
          message={err instanceof ValidationError ? undefined : friendlyError(err)}
        />,
        422,
      );
    }
  });

  app.post("/projects/:id/archive", (c) => {
    delivery.archiveProject(Number(c.req.param("id")), true);
    c.header("HX-Redirect", `/projects/${c.req.param("id")}`);
    return c.text("ok");
  });

  app.post("/projects/:id/restore", (c) => {
    delivery.archiveProject(Number(c.req.param("id")), false);
    c.header("HX-Redirect", `/projects/${c.req.param("id")}`);
    return c.text("ok");
  });

  app.delete("/projects/:id", (c) => {
    try {
      delivery.removeProject(Number(c.req.param("id")));
      c.header("HX-Redirect", "/projects");
      return c.text("ok");
    } catch (err) {
      return c.text(friendlyError(err), 409);
    }
  });

  // ---- repositories on a project ----

  function repoPanel(c: Context, projectId: number, error?: string) {
    const project = store.getProject(projectId);
    if (!project) return c.notFound();
    return partial(
      c,
      <RepoPanel
        project={project}
        repos={store.listProjectRepos(projectId)}
        linkable={store.linkableRepos(projectId)}
        error={error}
      />,
      error ? 422 : 200,
    );
  }

  app.post("/projects/:id/repos", async (c) => {
    const id = Number(c.req.param("id"));
    if (!store.getProject(id)) return c.notFound();
    const body = (await c.req.parseBody()) as Record<string, unknown>;
    const repoId = Number(body.repo_id);
    const fullName = String(body.full_name ?? "").trim();
    let error: string | undefined;
    try {
      if (Number.isFinite(repoId) && repoId > 0) {
        delivery.linkRepo(id, repoId, false);
      } else if (fullName) {
        // Not tracked yet: add it to GitHub sync first, then link.
        await delivery.linkRepoByName(id, fullName, (name) => sync.addRepo(name));
      } else {
        error = "Choose a tracked repository, or type owner/repository to add a new one.";
      }
    } catch (err) {
      error = friendlyError(err);
    }
    return repoPanel(c, id, error);
  });

  app.post("/projects/:id/repos/:repoId/primary", (c) => {
    const id = Number(c.req.param("id"));
    let error: string | undefined;
    try {
      delivery.setPrimaryRepo(id, Number(c.req.param("repoId")));
    } catch (err) {
      error = friendlyError(err);
    }
    return repoPanel(c, id, error);
  });

  app.delete("/projects/:id/repos/:repoId", (c) => {
    const id = Number(c.req.param("id"));
    delivery.unlinkRepo(id, Number(c.req.param("repoId")));
    return repoPanel(c, id);
  });

  // ---- team ----

  function teamPanel(c: Context, projectId: number, error?: string) {
    const project = store.getProject(projectId);
    if (!project) return c.notFound();
    return partial(
      c,
      <TeamPanel
        project={project}
        assignments={store.listAssignments(projectId)}
        employees={store.listEmployees()}
        error={error}
      />,
      error ? 422 : 200,
    );
  }

  app.post("/projects/:id/assignments", async (c) => {
    const id = Number(c.req.param("id"));
    if (!store.getProject(id)) return c.notFound();
    const body = (await c.req.parseBody()) as Record<string, unknown>;
    let error: string | undefined;
    try {
      delivery.addAssignment(id, body);
    } catch (err) {
      error = err instanceof ValidationError ? Object.values(err.fields)[0] ?? err.message : friendlyError(err);
    }
    return teamPanel(c, id, error);
  });

  app.delete("/projects/:id/assignments/:assignmentId", (c) => {
    const id = Number(c.req.param("id"));
    let error: string | undefined;
    try {
      delivery.removeAssignment(id, Number(c.req.param("assignmentId")));
    } catch (err) {
      error = friendlyError(err);
    }
    return teamPanel(c, id, error);
  });

  return app;
}
