import type { Store } from "../db/store.ts";
import { ConflictError, NotFoundError, ValidationError } from "../domain/errors.ts";

const NOREPLY_RE = /^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/i;

export function githubLoginFromNoreply(email: string): string | null {
  const match = NOREPLY_RE.exec(email.trim());
  return match?.[1] ?? null;
}

export function createIdentityService(store: Store) {
  return {
    add(employeeId: number, kind: "login" | "email", rawValue: string): void {
      const employee = store.getEmployee(employeeId);
      if (!employee) throw new NotFoundError("That employee");

      const value = rawValue.trim().replace(/^@/, "");
      if (value === "") {
        throw new ValidationError("Enter a GitHub username or email.", {
          value: "Enter a GitHub username or email.",
        });
      }
      if (kind === "email" && !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(value)) {
        throw new ValidationError("Enter a valid email address.", { value: "Enter a valid email address." });
      }
      if (kind === "login" && !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(value)) {
        throw new ValidationError("Enter a valid GitHub username.", {
          value: "Enter a valid GitHub username.",
        });
      }

      const existing = store.findIdentity(kind, value);
      if (existing) {
        if (existing.employee_id === employeeId) return;
        throw new ConflictError(`${value} is already mapped to ${existing.employee_name}.`);
      }

      store.insertIdentity({ employeeId, kind, value });
      this.refreshAvatar(employeeId);
    },

    move(employeeId: number, kind: "login" | "email", rawValue: string): void {
      const employee = store.getEmployee(employeeId);
      if (!employee) throw new NotFoundError("That employee");
      const value = rawValue.trim().replace(/^@/, "");
      if (!store.findIdentity(kind, value)) {
        store.insertIdentity({ employeeId, kind, value });
      } else {
        store.moveIdentity(kind, value, employeeId);
      }
      this.refreshAvatar(employeeId);
    },

    remove(employeeId: number, identityId: number): void {
      const owned = store.listIdentities(employeeId).some((row) => row.id === identityId);
      if (!owned) throw new NotFoundError("That identity");
      store.deleteIdentity(identityId);
    },

    ignore(kind: "login" | "email" | "pattern", rawValue: string, note: string | null): void {
      const value = rawValue.trim();
      if (value === "") throw new ValidationError("Nothing to ignore.");
      store.insertIgnoredAuthor(kind, value, note);
    },

    unignore(id: number): void {
      store.deleteIgnoredAuthor(id);
    },

    suggest(sinceTs: number): { created: number } {
      let created = 0;
      store.tx(() => {
        for (const match of store.suggestEmailMatches()) {
          if (store.findIdentity("email", match.value)) continue;
          store.insertIdentity({
            employeeId: match.employee_id,
            kind: "email",
            value: match.value,
            source: "suggested",
          });
          created += 1;
        }

        for (const email of store.unmappedEmails(sinceTs)) {
          const login = githubLoginFromNoreply(email);
          if (!login) continue;
          const owner = store.findIdentity("login", login);
          if (!owner) continue;
          if (store.findIdentity("email", email)) continue;
          store.insertIdentity({
            employeeId: owner.employee_id,
            kind: "email",
            value: email,
            source: "suggested",
          });
          created += 1;
        }
      });
      return { created };
    },

    refreshAvatar(employeeId: number): void {
      const employee = store.getEmployee(employeeId);
      if (!employee || employee.avatar_url) return;
      const url = store.avatarForEmployee(employeeId);
      if (url) store.setEmployeeAvatar(employeeId, url);
    },
  };
}

export type IdentityService = ReturnType<typeof createIdentityService>;
