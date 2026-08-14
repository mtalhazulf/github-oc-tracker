import { config } from "../config.ts";
import { createDb } from "./index.ts";
import { createStore } from "./store.ts";
import { createDeliveryService } from "../services/delivery.ts";
import { createEmployeeService } from "../services/employees.ts";
import { createEconomicsService } from "../services/economics.ts";
import { createIdentityService } from "../services/identities.ts";
import { createPayrollService } from "../services/payroll.ts";

const MESSAGES = [
  "fix: null check in the parser",
  "feat: add billing export",
  "chore: bump dependencies",
  "refactor: split the sync queue",
  "docs: update the runbook",
  "perf: cache organisation lookups",
  "test: cover the collation path",
  "fix: handle empty repositories",
];

function guard(): void {
  if (process.env.SEED_CONFIRM !== "yes") {
    throw new Error("Refusing to seed: set SEED_CONFIRM=yes to confirm.");
  }
  const path = config.dbPath;
  if (!(path === ":memory:" || path.includes("dev") || path.includes("demo") || path.includes("seed"))) {
    throw new Error(
      `Refusing to seed ${path}: the DB_PATH must contain "dev", "demo" or "seed", or be :memory:.`,
    );
  }
}

export function seed(): void {
  guard();
  const db = createDb();
  const store = createStore(db);
  if (store.listClients({ includeArchived: true }).length > 0) {
    console.log("Already seeded — nothing to do.");
    return;
  }

  const delivery = createDeliveryService(store);
  const employees = createEmployeeService(store);
  const identities = createIdentityService(store);
  const payroll = createPayrollService(store);
  const economics = createEconomicsService(store);

  const northwind = delivery.createClient({
    name: "Northwind Ltd",
    code: "NW",
    currency: "USD",
    status: "active",
    contact_name: "Dana Reeves",
    contact_email: "dana@northwind.example",
    country: "United Kingdom",
    payment_terms_days: "30",
  });
  const karachiFoods = delivery.createClient({
    name: "Karachi Foods",
    code: "KF",
    currency: "PKR",
    status: "active",
    contact_name: "Imran Sheikh",
    payment_terms_days: "15",
  });
  delivery.createClient({ name: "Helios GmbH", code: "HG", currency: "EUR", status: "prospect" });

  const team = [
    ["EMP-001", "Ayesha Khan", "Tech Lead", "Engineering", "ayeshak", "300,000", "2024-02-01"],
    ["EMP-002", "Bilal Ahmed", "Senior Engineer", "Engineering", "bilal-a", "250,000", "2024-06-15"],
    ["EMP-003", "Sana Mirza", "Engineer", "Engineering", "sanam", "180,000", "2025-01-10"],
    ["EMP-004", "Hamza Iqbal", "Designer", "Design", "hamzai", "170,000", "2025-03-01"],
    ["EMP-005", "Fatima Noor", "QA Engineer", "QA", "fatiman", "150,000", "2025-09-01"],
    ["EMP-006", "Usman Raza", "Engineer", "Engineering", "usmanr", "190,000", "2026-07-16"],
  ] as const;

  const people = team.map(([code, name, designation, department, login, salary, joined]) => {
    const employee = employees.create({
      code,
      full_name: name,
      designation,
      department,
      joined_on: joined,
      status: "active",
      employment_type: "full_time",
      work_email: `${login}@house.example`,
    });
    employees.addCompensation(employee.id, {
      effective_from: joined,
      base_monthly_minor: salary,
      currency: "PKR",
      reason: "Starting salary",
    });
    identities.add(employee.id, "login", login);
    return { ...employee, login };
  });

  const lead = people[0];
  if (lead) {
    employees.addCompensation(lead.id, {
      effective_from: "2026-07-01",
      base_monthly_minor: "340,000",
      currency: "PKR",
      reason: "Annual review",
    });
  }

  employees.create({
    code: "EMP-100",
    full_name: "Kamran Ali",
    designation: "Contract Designer",
    department: "Design",
    joined_on: "2026-01-01",
    status: "active",
    employment_type: "contract",
  });

  const portal = delivery.createProject({
    code: "NW-PORTAL",
    name: "Northwind Portal",
    kind: "client",
    client_id: String(northwind.id),
    status: "active",
    billing_model: "fixed_price",
    currency: "USD",
    budget_minor: "120,000",
    start_on: "2026-03-01",
    manager_id: String(lead?.id ?? ""),
  });
  const foodsApp = delivery.createProject({
    code: "KF-APP",
    name: "Karachi Foods App",
    kind: "client",
    client_id: String(karachiFoods.id),
    status: "active",
    billing_model: "time_materials",
    currency: "PKR",
    rate_hourly_minor: "9,000",
    start_on: "2026-05-01",
  });
  const scheduler = delivery.createProject({
    code: "PROD-SCHED",
    name: "Scheduler (internal product)",
    kind: "internal_product",
    billing_model: "none",
    currency: "PKR",
    status: "discovery",
  });
  delivery.createProject({
    code: "OPS",
    name: "Internal tooling",
    kind: "internal_ops",
    billing_model: "none",
    currency: "PKR",
    status: "active",
  });

  const repos = ["acme/portal-api", "acme/portal-web", "acme/shared-ui", "acme/foods-app", "acme/scheduler"];
  const repoIds = repos.map(
    (fullName) =>
      store.upsertRepo({
        githubId: null,
        orgId: null,
        owner: fullName.split("/")[0] ?? "acme",
        name: fullName.split("/")[1] ?? "repo",
        fullName,
        description: null,
        defaultBranch: "main",
        isPrivate: false,
        isFork: false,
        isArchived: false,
        htmlUrl: `https://github.com/${fullName}`,
      }).id,
  );
  for (const id of repoIds) store.setRepoSync(id, "idle");

  const now = Math.floor(Date.now() / 1000);
  repoIds.forEach((repoId, repoIndex) => {
    const commits = [];
    for (let i = 0; i < 120; i++) {
      const author = people[(i + repoIndex) % people.length];
      if (!author) continue;
      const daysAgo = (i * 7 + repoIndex * 3) % 80;
      const hour = 9 + ((i * 3) % 9);
      const ts = now - daysAgo * 86_400 - hour * 3600;
      const login = i === 5 ? author.login.toUpperCase() : author.login;
      commits.push({
        sha: `${repoIndex}${String(i).padStart(4, "0")}deadbeefcafe${repoIndex}${i}`,
        message: MESSAGES[i % MESSAGES.length] ?? "chore: update",
        authorName: author.full_name,
        authorEmail: `${author.login}@house.example`,
        authorLogin: login,
        authorAvatarUrl: null,
        authorTs: ts,
        committerName: author.full_name,
        committerEmail: `${author.login}@house.example`,
        committerTs: ts,
        isMerge: i % 17 === 0,
        htmlUrl: null,
      });
    }
    commits.push(
      makeCommit("outside-contributor", now - 3 * 86_400, repoIndex, 900),
      makeCommit("dependabot[bot]", now - 2 * 86_400, repoIndex, 901),
    );
    store.insertCommits(repoId, commits);
  });

  const [portalApi, portalWeb, sharedUi, foodsRepo, schedulerRepo] = repoIds;
  if (portalApi !== undefined) delivery.linkRepo(portal.id, portalApi, false);
  if (portalWeb !== undefined) delivery.linkRepo(portal.id, portalWeb, false);
  if (sharedUi !== undefined) delivery.linkRepo(portal.id, sharedUi, false);
  if (sharedUi !== undefined) delivery.linkRepo(scheduler.id, sharedUi, false);
  if (foodsRepo !== undefined) delivery.linkRepo(foodsApp.id, foodsRepo, false);
  if (schedulerRepo !== undefined) delivery.linkRepo(scheduler.id, schedulerRepo, false);

  const alloc: [number, number, number, string][] = [
    [portal.id, people[0]?.id ?? 0, 60, "Tech lead"],
    [portal.id, people[1]?.id ?? 0, 100, "Backend"],
    [portal.id, people[3]?.id ?? 0, 50, "Design"],
    [foodsApp.id, people[2]?.id ?? 0, 80, "Full stack"],
    [foodsApp.id, people[4]?.id ?? 0, 40, "QA"],
    [scheduler.id, people[0]?.id ?? 0, 40, "Architecture"],
  ];
  for (const [projectId, employeeId, pct, role] of alloc) {
    if (employeeId === 0) continue;
    delivery.addAssignment(projectId, {
      employee_id: String(employeeId),
      allocation_pct: String(pct),
      start_on: "2026-06-01",
      role,
    });
  }

  for (const [period, finalise] of [
    ["2026-07", true],
    ["2026-08", false],
  ] as const) {
    const cycle = payroll.createCycle({ period_month: period });
    payroll.generate(cycle.id);
    if (finalise) {
      payroll.setStatus(cycle.id, "approved");
      payroll.setStatus(cycle.id, "paid");
    }
  }

  const invoices: [string, number, number | null, string, string, string, string][] = [
    ["NW-2026-06", northwind.id, portal.id, "40,000", "2026-06-01", "2026-07-01", "sent"],
    ["NW-2026-07", northwind.id, portal.id, "40,000", "2026-07-01", "2026-08-01", "sent"],
    ["NW-2026-05", northwind.id, portal.id, "40,000", "2026-05-01", "2026-05-31", "paid"],
    ["KF-2026-07", karachiFoods.id, foodsApp.id, "850,000", "2026-07-05", "2026-07-20", "sent"],
  ];
  for (const [number, clientId, projectId, amount, issued, due, status] of invoices) {
    const invoice = economics.createInvoice({
      number,
      client_id: String(clientId),
      project_id: projectId === null ? "" : String(projectId),
      amount_minor: amount,
      issued_on: issued,
      due_on: due,
      currency: clientId === northwind.id ? "USD" : "PKR",
    });
    if (status !== "draft") economics.setStatus(invoice.id, status, "2026-08-01");
  }

  const counts = {
    clients: store.listClients().length,
    projects: store.listProjects().length,
    people: store.listEmployees().length,
    repos: store.listRepos().length,
    commits: store.countCommits(),
    cycles: store.listCycles().length,
    invoices: store.listInvoices().length,
  };
  console.log("Seeded:", JSON.stringify(counts, null, 2));
  console.log("\nNext: start the app and create the owner account at /setup.");
}

function makeCommit(login: string, ts: number, repoIndex: number, n: number) {
  return {
    sha: `${repoIndex}${n}unmappedauthor${repoIndex}${n}`,
    message: "chore: drive-by fix",
    authorName: login,
    authorEmail: `${login}@example.com`,
    authorLogin: login,
    authorAvatarUrl: null,
    authorTs: ts,
    committerName: login,
    committerEmail: `${login}@example.com`,
    committerTs: ts,
    isMerge: false,
    htmlUrl: null,
  };
}

if (import.meta.main) {
  seed();
}
