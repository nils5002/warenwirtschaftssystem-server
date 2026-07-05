import { AlertTriangle, CheckCircle2, KeyRound, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useAppDialog } from '../../components/dialogs/AppDialogProvider';
import { InlineLoadingState, LoadingButton } from '../../components/loading';
import { PageHeader as UiPageHeader } from '../../ui';
import {
  fetchPermissionCatalog,
  fetchRoles,
  updateRolePermissions,
  type PermissionGroup,
  type RolePermissions,
} from '../../services/wmsApi';

const ROLES_MANAGE_KEY = 'roles.manage';

type FlashMessage = { kind: 'success' | 'error'; text: string };

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Unbekannter Fehler.';
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

export function RolesPermissionsPage() {
  const { alert } = useAppDialog();
  const [groups, setGroups] = useState<PermissionGroup[]>([]);
  const [roles, setRoles] = useState<RolePermissions[]>([]);
  // Lokale, editierbare Kopie je Rolle (Set der gewährten Permission-Keys).
  const [draft, setDraft] = useState<Record<string, Set<string>>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingRole, setSavingRole] = useState<string | null>(null);
  const [message, setMessage] = useState<FlashMessage | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const [catalog, rolesResponse] = await Promise.all([fetchPermissionCatalog(), fetchRoles()]);
        if (cancelled) return;
        setGroups(catalog.groups);
        setRoles(rolesResponse.roles);
        setDraft(
          Object.fromEntries(rolesResponse.roles.map((role) => [role.roleKey, new Set(role.permissions)])),
        );
      } catch (error) {
        if (!cancelled) setLoadError(errorMessage(error));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Rollen, die im aktuellen Entwurf das Recht "Rollen & Rechte verwalten" halten.
  const draftRolesManageHolders = useMemo(() => {
    return roles.filter((role) => draft[role.roleKey]?.has(ROLES_MANAGE_KEY)).map((role) => role.roleKey);
  }, [roles, draft]);

  const serverPermsByRole = useMemo(
    () => Object.fromEntries(roles.map((role) => [role.roleKey, new Set(role.permissions)])),
    [roles],
  );

  const toggle = (roleKey: string, permKey: string) => {
    setMessage(null);
    setDraft((prev) => {
      const current = new Set(prev[roleKey] ?? []);
      if (current.has(permKey)) current.delete(permKey);
      else current.add(permKey);
      return { ...prev, [roleKey]: current };
    });
  };

  const isDirty = (roleKey: string): boolean => {
    const server = serverPermsByRole[roleKey];
    const local = draft[roleKey];
    if (!server || !local) return false;
    return !setsEqual(server, local);
  };

  const save = async (roleKey: string) => {
    const local = draft[roleKey];
    if (!local) return;
    setSavingRole(roleKey);
    setMessage(null);
    try {
      const updated = await updateRolePermissions(roleKey, [...local]);
      // Server-Antwort als neue Wahrheit übernehmen (sanitisiert/sortiert).
      setRoles((prev) => prev.map((role) => (role.roleKey === roleKey ? updated : role)));
      setDraft((prev) => ({ ...prev, [roleKey]: new Set(updated.permissions) }));
      const label = roles.find((role) => role.roleKey === roleKey)?.label ?? roleKey;
      setMessage({ kind: 'success', text: `Berechtigungen für ${label} gespeichert.` });
    } catch (error) {
      // Aussperr-Schutz (409) und andere Fehler verständlich anzeigen.
      setMessage({ kind: 'error', text: errorMessage(error) });
    } finally {
      setSavingRole(null);
    }
  };

  if (loading) {
    return (
      <section className="space-y-4 sm:space-y-5">
        <RolesPageHeader />
        <InlineLoadingState message="Rollen & Rechte werden geladen ..." />
      </section>
    );
  }

  if (loadError) {
    return (
      <section className="space-y-4 sm:space-y-5">
        <RolesPageHeader />
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          Rollen & Rechte konnten nicht geladen werden: {loadError}
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4 sm:space-y-5">
      <RolesPageHeader />

      {message ? (
        <div
          className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-sm ${
            message.kind === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-rose-200 bg-rose-50 text-rose-700'
          }`}
        >
          {message.kind === 'success' ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <span>{message.text}</span>
        </div>
      ) : null}

      <article className="surface-card animate-fade-up">
        {/* Horizontales Scrollen auf schmalen Screens, Tabelle bleibt lesbar. */}
        <div className="soft-scrollbar -mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[34rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="py-2 pr-3 text-left font-semibold text-slate-700">Berechtigung</th>
                {roles.map((role) => (
                  <th key={role.roleKey} className="px-2 py-2 text-center font-semibold text-slate-700">
                    <div className="flex flex-col items-center gap-1">
                      <span>{role.label}</span>
                      <LoadingButton
                        type="button"
                        className="btn-secondary min-h-8 px-2 py-1 text-[11px]"
                        disabled={!isDirty(role.roleKey)}
                        isLoading={savingRole === role.roleKey}
                        loadingText="Speichert ..."
                        onClick={() => void save(role.roleKey)}
                      >
                        Speichern
                      </LoadingButton>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <GroupRows
                  key={group.group}
                  group={group}
                  roles={roles}
                  draft={draft}
                  savingRole={savingRole}
                  draftRolesManageHolders={draftRolesManageHolders}
                  onToggle={toggle}
                />
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Änderungen gelten je Rolle und greifen, sobald die betreffenden Benutzer sich neu anmelden bzw. die
          Seite neu laden. Mindestens eine Rolle muss das Recht zum Verwalten von Rollen &amp; Rechten behalten.
        </p>
      </article>
    </section>
  );
}

function RolesPageHeader() {
  return (
    <UiPageHeader
      kicker="Admin"
      title="Rollen & Rechte"
      subtitle="Lege pro Rolle fest, welche Aktionen erlaubt sind. Die drei Rollen bleiben bestehen — du bestimmst nur ihre Berechtigungen."
      actions={<KeyRound className="h-5 w-5 text-ink-faint" />}
    />
  );
}

function GroupRows({
  group,
  roles,
  draft,
  savingRole,
  draftRolesManageHolders,
  onToggle,
}: {
  group: PermissionGroup;
  roles: RolePermissions[];
  draft: Record<string, Set<string>>;
  savingRole: string | null;
  draftRolesManageHolders: string[];
  onToggle: (roleKey: string, permKey: string) => void;
}) {
  return (
    <>
      <tr className="bg-slate-50">
        <td colSpan={roles.length + 1} className="px-1 py-1.5">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <ShieldCheck className="h-3.5 w-3.5" />
            {group.label}
          </span>
        </td>
      </tr>
      {group.permissions.map((perm) => (
        <tr key={perm.key} className="border-b border-slate-100 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40">
          <td className="py-2 pr-3 text-slate-700">{perm.label}</td>
          {roles.map((role) => {
            const checked = draft[role.roleKey]?.has(perm.key) ?? false;
            // Aussperr-Schutz als UI-Hinweis: das letzte "Rollen & Rechte
            // verwalten" einer Rolle kann hier nicht entfernt werden.
            const isLastRolesManage =
              perm.key === ROLES_MANAGE_KEY &&
              checked &&
              draftRolesManageHolders.length === 1 &&
              draftRolesManageHolders[0] === role.roleKey;
            const disabled = savingRole !== null || isLastRolesManage;
            return (
              <td key={role.roleKey} className="px-2 py-2 text-center">
                <input
                  type="checkbox"
                  className="h-5 w-5 cursor-pointer rounded border-slate-300 text-brand-600 focus:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
                  checked={checked}
                  disabled={disabled}
                  title={
                    isLastRolesManage
                      ? 'Mindestens eine Rolle muss dieses Recht behalten.'
                      : `${perm.label} für ${role.label}`
                  }
                  aria-label={`${perm.label} für ${role.label}`}
                  onChange={() => onToggle(role.roleKey, perm.key)}
                />
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
