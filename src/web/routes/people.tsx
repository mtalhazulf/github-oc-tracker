import { Hono } from "hono";
import type { Context } from "hono";
import type { Store } from "../../db/store.ts";
import type { EmployeeRow } from "../../db/store.ts";
import { ValidationError } from "../../domain/errors.ts";
import { can } from "../../domain/rbac.ts";
import type { EmployeeService } from "../../services/employees.ts";
import type { IdentityService } from "../../services/identities.ts";
import { friendlyError, page, partial } from "../http.tsx";
import { Layout } from "../views/Layout.tsx";
import {
  CompensationPanel,
  EmployeeDetailPage,
  EmployeeForm,
  EmployeesPage,
  EmployeesTable,
  IdentityPanel,
  UnmappedAuthorsPage,
} from "../views/EmployeesPage.tsx";
import { currentPrincipal } from "../request-context.ts";
import type { AuthService } from "../../services/auth.ts";

const YEAR_SECONDS = 365 * 86_400;

function formValues(body: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(body)) out[key] = value === undefined ? "" : String(value);
  return out;
}

function employeeToValues(e: EmployeeRow): Record<string, string> {
  return {
    code: e.code,
    full_name: e.full_name,
    work_email: e.work_email ?? "",
    phone: e.phone ?? "",
    designation: e.designation ?? "",
    department: e.department ?? "",
    employment_type: e.employment_type,
    status: e.status,
    joined_on: e.joined_on,
    exited_on: e.exited_on ?? "",
    notes: e.notes ?? "",
  };
}

function parseFilters(c: Context) {
  return {
    status: c.req.query("status") ?? "",
    department: c.req.query("department") ?? "",
    q: (c.req.query("q") ?? "").trim(),
    archived: c.req.query("archived") === "1",
  };
}

export function createPeopleRoutes(
  store: Store,
  employees: EmployeeService,
  identities: IdentityService,
  auth: AuthService,
): Hono {
  const app = new Hono();

  const sinceYear = () => Math.floor(Date.now() / 1000) - YEAR_SECONDS;

  function listFor(c: Context) {
    const filters = parseFilters(c);
    return {
      filters,
      rows: store.listEmployees({
        status: filters.status || undefined,
        department: filters.department || undefined,
        q: filters.q || undefined,
        includeArchived: filters.archived,
      }),
    };
  }

  app.get("/employees", (c) => {
    const { filters, rows } = listFor(c);
    return page(
      c,
      <Layout title="People" active="employees">
        <EmployeesPage
          employees={rows}
          departments={store.listDepartments()}
          filters={filters}
          unmappedCount={store.countUnmappedAuthors(sinceYear())}
        />
      </Layout>,
    );
  });

  app.get("/employees/table", (c) => {
    const { rows } = listFor(c);
    return partial(c, <EmployeesTable employees={rows} />);
  });

  app.get("/employees/new", (c) =>
    page(
      c,
      <Layout title="Add person" active="employees">
        <EmployeeForm values={{ employment_type: "full_time", status: "active" }} errors={{}} />
      </Layout>,
    ),
  );

  app.post("/employees", async (c) => {
    const body = (await c.req.parseBody()) as Record<string, unknown>;
    try {
      const created = employees.create(body);
      c.header("HX-Redirect", `/employees/${created.id}`);
      return c.text("ok");
    } catch (err) {
      const fields = err instanceof ValidationError ? err.fields : {};
      return partial(
        c,
        <EmployeeForm
          values={formValues(body)}
          errors={fields}
          message={err instanceof ValidationError ? undefined : friendlyError(err)}
        />,
        422,
      );
    }
  });

  app.get("/employees/:id", (c) => {
    const id = Number(c.req.param("id"));
    const employee = store.getEmployee(id);
    if (!employee) return c.notFound();
    return page(
      c,
      <Layout title={employee.full_name} active="employees">
        <EmployeeDetailPage
          employee={employee}
          identities={store.listIdentities(id)}
          compensation={store.listCompensation(id)}
          contribution={store.employeeContribution(id, sinceYear())}
          commits={store.employeeCommits(id, 10)}
          canSeeMoney={can(currentPrincipal()?.role ?? "owner", "compensation.view")}
        />
      </Layout>,
    );
  });

  app.get("/employees/:id/edit", (c) => {
    const employee = store.getEmployee(Number(c.req.param("id")));
    if (!employee) return c.notFound();
    return page(
      c,
      <Layout title={`Edit ${employee.full_name}`} active="employees">
        <EmployeeForm employee={employee} values={employeeToValues(employee)} errors={{}} />
      </Layout>,
    );
  });

  app.post("/employees/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const employee = store.getEmployee(id);
    if (!employee) return c.notFound();
    const body = (await c.req.parseBody()) as Record<string, unknown>;
    try {
      employees.update(id, body);
      c.header("HX-Redirect", `/employees/${id}`);
      return c.text("ok");
    } catch (err) {
      const fields = err instanceof ValidationError ? err.fields : {};
      return partial(
        c,
        <EmployeeForm
          employee={employee}
          values={formValues(body)}
          errors={fields}
          message={err instanceof ValidationError ? undefined : friendlyError(err)}
        />,
        422,
      );
    }
  });

  app.post("/employees/:id/archive", (c) => {
    employees.archive(Number(c.req.param("id")), true);
    auth.audit(currentPrincipal(), "employee.archive", "employee", Number(c.req.param("id")), null);
    c.header("HX-Redirect", `/employees/${c.req.param("id")}`);
    return c.text("ok");
  });

  app.post("/employees/:id/restore", (c) => {
    employees.archive(Number(c.req.param("id")), false);
    c.header("HX-Redirect", `/employees/${c.req.param("id")}`);
    return c.text("ok");
  });

  app.delete("/employees/:id", (c) => {
    try {
      employees.remove(Number(c.req.param("id")));
      c.header("HX-Redirect", "/employees");
      return c.text("ok");
    } catch (err) {
      return c.text(friendlyError(err), 409);
    }
  });

  app.post("/employees/:id/identities", async (c) => {
    const id = Number(c.req.param("id"));
    const employee = store.getEmployee(id);
    if (!employee) return c.notFound();
    const body = (await c.req.parseBody()) as Record<string, unknown>;
    const kind = String(body.kind ?? "login") === "email" ? "email" : "login";
    let error: string | undefined;
    try {
      identities.add(id, kind, String(body.value ?? ""));
      auth.audit(currentPrincipal(), "identity.add", "employee", id, `${kind} ${String(body.value ?? "")}`);
    } catch (err) {
      error = friendlyError(err);
    }
    const fresh = store.getEmployee(id) ?? employee;
    return partial(
      c,
      <IdentityPanel employee={fresh} identities={store.listIdentities(id)} error={error} />,
      error ? 422 : 200,
    );
  });

  app.delete("/employees/:id/identities/:identityId", (c) => {
    const id = Number(c.req.param("id"));
    const employee = store.getEmployee(id);
    if (!employee) return c.notFound();
    let error: string | undefined;
    try {
      identities.remove(id, Number(c.req.param("identityId")));
    } catch (err) {
      error = friendlyError(err);
    }
    return partial(c, <IdentityPanel employee={employee} identities={store.listIdentities(id)} error={error} />);
  });

  app.post("/employees/:id/compensation", async (c) => {
    const id = Number(c.req.param("id"));
    const employee = store.getEmployee(id);
    if (!employee) return c.notFound();
    const body = (await c.req.parseBody()) as Record<string, unknown>;
    let error: string | undefined;
    try {
      employees.addCompensation(id, body);
      auth.audit(currentPrincipal(), "compensation.create", "employee", id, `salary record added for ${employee.full_name}`);
    } catch (err) {
      error = err instanceof ValidationError ? Object.values(err.fields)[0] ?? err.message : friendlyError(err);
    }
    return partial(
      c,
      <CompensationPanel employee={employee} compensation={store.listCompensation(id)} error={error} />,
      error ? 422 : 200,
    );
  });

  app.delete("/employees/:id/compensation/:compensationId", (c) => {
    const id = Number(c.req.param("id"));
    const employee = store.getEmployee(id);
    if (!employee) return c.notFound();
    let error: string | undefined;
    try {
      employees.removeCompensation(id, Number(c.req.param("compensationId")));
    } catch (err) {
      error = friendlyError(err);
    }
    return partial(c, <CompensationPanel employee={employee} compensation={store.listCompensation(id)} error={error} />);
  });

  function inbox(c: Context, suggested?: number) {
    return page(
      c,
      <Layout title="Author mapping" active="mapping">
        <UnmappedAuthorsPage
          authors={store.unmappedAuthors(sinceYear(), 50)}
          employees={store.listEmployees()}
          ignored={store.listIgnoredAuthors()}
          suggested={suggested}
        />
      </Layout>,
    );
  }

  app.get("/people/unmapped", (c) => inbox(c));

  app.post("/people/unmapped/suggest", (c) => {
    const { created } = identities.suggest(sinceYear());
    return inbox(c, created);
  });

  app.post("/people/unmapped/map", async (c) => {
    const body = (await c.req.parseBody()) as Record<string, unknown>;
    const employeeId = Number(body.employee_id);
    const login = String(body.login ?? "").trim();
    const email = String(body.email ?? "").trim();
    if (Number.isFinite(employeeId) && employeeId > 0) {
      if (login) identities.move(employeeId, "login", login);
      if (email) identities.move(employeeId, "email", email);
    }
    return inbox(c);
  });

  app.post("/people/unmapped/ignore", async (c) => {
    const body = (await c.req.parseBody()) as Record<string, unknown>;
    const login = String(body.login ?? "").trim();
    const email = String(body.email ?? "").trim();
    if (login) identities.ignore("login", login, "Ignored from the mapping inbox");
    else if (email) identities.ignore("email", email, "Ignored from the mapping inbox");
    return inbox(c);
  });

  app.delete("/people/ignored/:id", (c) => {
    identities.unignore(Number(c.req.param("id")));
    return inbox(c);
  });

  return app;
}
