import { KeyRound, Shield, Trash2, UserPlus, Users2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useAppDialog } from '../../components/dialogs/AppDialogProvider';
import { InlineLoadingState, LoadingButton } from '../../components/loading';
import { StatusBadge } from '../components/StatusBadge';
import type { ActivityItem, Asset, UserItem } from '../types';

type BulkDeleteResult = {
  deletedCount: number;
  skippedCount: number;
  results: { userId: string; deleted: boolean; reason?: string | null }[];
};

type UserFormState = {
  id?: string;
  name: string;
  email: string;
  role: UserItem['role'];
  status: UserItem['status'];
  department: string;
  location: string;
};

function emptyUserForm(): UserFormState {
  return {
    name: '',
    email: '',
    role: 'Mitarbeiter',
    status: 'Aktiv',
    department: '',
    location: '',
  };
}

export function UsersPage({
  users,
  currentUserId,
  assets,
  activities,
  onOpenInventoryWithQuery,
  onInviteUser,
  onEditUser,
  onResetUserPassword,
  onDeleteUser,
  onBulkDeleteUsers,
}: {
  users: UserItem[];
  currentUserId: string;
  assets: Asset[];
  activities: ActivityItem[];
  onOpenInventoryWithQuery: (query: string) => void;
  onInviteUser: (payload: {
    name: string;
    email: string;
    role: UserItem['role'];
    status: UserItem['status'];
    department?: string;
    location?: string;
  }) => Promise<void>;
  onEditUser: (payload: {
    id: string;
    name: string;
    email: string;
    role: UserItem['role'];
    status: UserItem['status'];
    department?: string;
    location?: string;
  }) => Promise<void>;
  onResetUserPassword: (
    userId: string,
    payload: { newPassword?: string; generateTemporary?: boolean },
  ) => Promise<{ temporaryPassword?: string | null }>;
  onDeleteUser: (id: string) => Promise<void>;
  onBulkDeleteUsers: (ids: string[]) => Promise<BulkDeleteResult>;
}) {
  const { confirm, alert, prompt } = useAppDialog();
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [form, setForm] = useState<UserFormState>(emptyUserForm());
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const userInForm = form.id ? users.find((user) => user.id === form.id) : undefined;

  const adminCount = users.filter((user) => user.role === 'Admin').length;
  const activeAdminCount = users.filter((user) => user.role === 'Admin' && user.status === 'Aktiv').length;
  const activeCount = users.filter((user) => user.status === 'Aktiv').length;
  const loanedAssets = assets.filter((asset) => asset.status === 'Verliehen' && asset.assignedTo !== '-');

  const userIdsWithLoans = useMemo(() => {
    const result = new Set<string>();
    for (const user of users) {
      const hasLoan = loanedAssets.some((asset) =>
        asset.assignedTo.toLowerCase().includes(user.name.toLowerCase()),
      );
      if (hasLoan) result.add(user.id);
    }
    return result;
  }, [users, loanedAssets]);

  const selectableUsers = useMemo(
    () => users.filter((user) => user.id !== currentUserId),
    [users, currentUserId],
  );

  const allSelectableSelected =
    selectableUsers.length > 0 && selectableUsers.every((user) => selectedIds.includes(user.id));

  const toggleSelected = (userId: string, rowIndex: number, withRange = false) => {
    setSelectedIds((current) => {
      if (withRange && lastSelectedIndex !== null && selectableUsers.length > 0) {
        const start = Math.min(lastSelectedIndex, rowIndex);
        const end = Math.max(lastSelectedIndex, rowIndex);
        const idsInRange = selectableUsers.slice(start, end + 1).map((user) => user.id);
        return [...new Set([...current, ...idsInRange])];
      }
      return current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId];
    });
    setLastSelectedIndex(rowIndex);
  };

  const toggleSelectAll = () => {
    const visibleIds = selectableUsers.map((user) => user.id);
    setSelectedIds(allSelectableSelected ? [] : visibleIds);
    setLastSelectedIndex(null);
  };

  const clearSelection = () => {
    setSelectedIds([]);
    setLastSelectedIndex(null);
  };

  const bulkDeleteSelected = async () => {
    if (!selectedIds.length || bulkDeleting) return;
    const targets = selectedIds
      .map((id) => users.find((user) => user.id === id))
      .filter((user): user is UserItem => Boolean(user));
    if (!targets.length) return;

    if (targets.some((user) => user.id === currentUserId)) {
      setActionError('Du kannst deinen eigenen Benutzer nicht löschen.');
      return;
    }

    const adminsInSelection = targets.filter((user) => user.role === 'Admin' && user.status === 'Aktiv').length;
    if (activeAdminCount > 0 && adminsInSelection >= activeAdminCount) {
      setActionError('Mindestens ein aktiver Admin muss erhalten bleiben.');
      return;
    }

    const withLoans = targets.filter((user) => userIdsWithLoans.has(user.id));
    const warningLines: string[] = [];
    if (withLoans.length) {
      warningLines.push(
        `Achtung: ${withLoans.length} ${withLoans.length === 1 ? 'Benutzer hat' : 'Benutzer haben'} noch aktive Geräteausgaben (${withLoans
          .slice(0, 5)
          .map((user) => user.name)
          .join(', ')}${withLoans.length > 5 ? ', …' : ''}). Bitte vorher klären.`,
      );
    }

    const accepted = await confirm({
      title: 'Benutzer löschen?',
      message: [
        `Möchtest du wirklich ${targets.length} Benutzer löschen? Diese Aktion kann nicht rückgängig gemacht werden.`,
        ...warningLines,
      ].join('\n\n'),
      confirmLabel: 'Benutzer löschen',
      cancelLabel: 'Abbrechen',
      tone: 'danger',
    });
    if (!accepted) return;

    setBulkDeleting(true);
    setActionError(null);
    try {
      const result = await onBulkDeleteUsers(targets.map((user) => user.id));
      clearSelection();
      const skippedReasons = result.results
        .filter((entry) => !entry.deleted && entry.reason)
        .map((entry) => `- ${users.find((user) => user.id === entry.userId)?.name ?? entry.userId}: ${entry.reason}`)
        .join('\n');
      if (result.skippedCount > 0) {
        await alert({
          title: 'Teilweise gelöscht',
          message:
            `${result.deletedCount} Benutzer gelöscht, ${result.skippedCount} übersprungen.` +
            (skippedReasons ? `\n\n${skippedReasons}` : ''),
        });
      } else if (result.deletedCount > 0) {
        await alert({
          title: 'Benutzer gelöscht',
          message: `${result.deletedCount} Benutzer wurden gelöscht.`,
        });
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Bulk-Löschen fehlgeschlagen.');
    } finally {
      setBulkDeleting(false);
    }
  };

  const recentActivityByUser = useMemo(() => {
    const map = new Map<string, ActivityItem[]>();
    for (const user of users) {
      const related = activities
        .filter((entry) => entry.detail.toLowerCase().includes(user.name.toLowerCase()))
        .slice(0, 2);
      map.set(user.id, related);
    }
    return map;
  }, [activities, users]);

  const openCreate = () => {
    setForm(emptyUserForm());
    setError(null);
    setActionError(null);
    setFormOpen(true);
  };

  const openEdit = (user: UserItem) => {
    setForm({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      department: user.department ?? '',
      location: user.location ?? '',
    });
    setError(null);
    setActionError(null);
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setSaving(false);
    setError(null);
  };

  const validate = (): string | null => {
    if (!form.name.trim()) return 'Bitte Name ausfüllen.';
    if (!form.email.trim()) return 'Bitte E-Mail oder Benutzername ausfüllen.';
    return null;
  };

  const submit = async () => {
    const validation = validate();
    if (validation) {
      setError(validation);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (form.id) {
        await onEditUser({
          id: form.id,
          name: form.name.trim(),
          email: form.email.trim(),
          role: form.role,
          status: form.status,
          department: form.department.trim() || undefined,
          location: form.location.trim() || undefined,
        });
      } else {
        await onInviteUser({
          name: form.name.trim(),
          email: form.email.trim(),
          role: form.role,
          status: form.status,
          department: form.department.trim() || undefined,
          location: form.location.trim() || undefined,
        });
      }
      closeForm();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Benutzer konnte nicht gespeichert werden.');
    } finally {
      setSaving(false);
    }
  };

  const removeUser = async (user: UserItem) => {
    if (user.id === currentUserId) {
      setActionError('Du kannst deinen eigenen Benutzer nicht löschen.');
      return;
    }

    if (user.role === 'Admin' && user.status === 'Aktiv' && activeAdminCount <= 1) {
      setActionError('Der letzte aktive Admin kann nicht gelöscht werden.');
      return;
    }

    const hasLoan = userIdsWithLoans.has(user.id);
    const lines = [
      `Möchtest du ${user.name} wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.`,
    ];
    if (hasLoan) {
      lines.push(`Achtung: ${user.name} hat noch aktive Geräteausgaben. Bitte vorher klären.`);
    }
    const accepted = await confirm({
      title: 'Benutzer löschen?',
      message: lines.join('\n\n'),
      confirmLabel: 'Benutzer löschen',
      cancelLabel: 'Abbrechen',
      tone: 'danger',
    });
    if (!accepted) return;

    setDeletingUserId(user.id);
    setActionError(null);
    try {
      await onDeleteUser(user.id);
      await alert({
        title: 'Benutzer gelöscht',
        message: `${user.name} wurde gelöscht und aus den Listen entfernt.`,
      });
    } catch (deleteError) {
      setActionError(
        deleteError instanceof Error ? deleteError.message : 'Benutzer konnte nicht gelöscht werden.',
      );
    } finally {
      setDeletingUserId(null);
    }
  };

  const resetPassword = async (user: UserItem) => {
    setActionError(null);
    const generateTemporary = await confirm({
      title: 'Passwort zurücksetzen',
      message:
        `Passwort für ${user.name} zurücksetzen.\n\n` +
        'Temporäres Passwort automatisch generieren? (Abbrechen = manuell setzen)',
      confirmLabel: 'Temporär generieren',
      cancelLabel: 'Manuell setzen',
    });

    try {
      if (generateTemporary) {
        const response = await onResetUserPassword(user.id, { generateTemporary: true });
        await alert({
          title: 'Temporäres Passwort',
          message:
            `${user.name}: ${response.temporaryPassword ?? '(nicht verfügbar)'}\n\n` +
            'Bitte dieses Passwort jetzt kopieren. Es wird später nicht erneut angezeigt.',
        });
        return;
      }

      const password = await prompt({
        title: 'Neues Passwort setzen',
        message: `Neues Passwort für ${user.name}`,
        required: true,
        submitLabel: 'Weiter',
      });
      if (!password?.trim()) return;
      const confirmPassword = await prompt({
        title: 'Passwort bestätigen',
        message: 'Bitte Passwort wiederholen',
        required: true,
        submitLabel: 'Passwort setzen',
      });
      if (!confirmPassword?.trim()) return;
      if (password !== confirmPassword) {
        setActionError('Passwörter stimmen nicht überein.');
        return;
      }
      await onResetUserPassword(user.id, { newPassword: password });
      await alert({
        title: 'Passwort aktualisiert',
        message: `Passwort für ${user.name} wurde gesetzt.`,
      });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Passwort konnte nicht zurückgesetzt werden.');
    }
  };

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="page-kicker">Benutzerverwaltung</p>
          <h2 className="page-title">Teamzugriff</h2>
          <p className="page-subtitle">
            Klare Rollen für Admin, Projektmanager und Mitarbeiter mit nachvollziehbarem Aktivitätsstatus.
          </p>
        </div>
        <button className="btn-primary w-full sm:w-auto" onClick={openCreate}>
          <UserPlus className="h-4 w-4" />
          Benutzer anlegen
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="surface-card p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Gesamt</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{users.length}</p>
        </div>
        <div className="surface-card p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">Aktive Nutzer</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{activeCount}</p>
        </div>
        <div className="surface-card p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">Admins</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{adminCount}</p>
        </div>
      </div>

      <article className="surface-card animate-fade-up">
        {actionError ? (
          <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {actionError}
          </div>
        ) : null}

        {selectedIds.length > 0 ? (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2">
            <p className="text-sm font-semibold text-brand-800">
              {selectedIds.length} Benutzer ausgewählt
            </p>
            <div className="inline-flex items-center gap-2">
              <button
                type="button"
                className="btn-secondary px-2.5 py-1.5 text-xs"
                onClick={clearSelection}
                disabled={bulkDeleting}
              >
                Auswahl aufheben
              </button>
              <LoadingButton
                type="button"
                className="btn-danger px-2.5 py-1.5 text-xs"
                onClick={() => void bulkDeleteSelected()}
                isLoading={bulkDeleting}
                loadingText="Lösche ..."
              >
                <span className="inline-flex items-center gap-1">
                  <Trash2 className="h-3.5 w-3.5" />
                  Ausgewählte Benutzer löschen
                </span>
              </LoadingButton>
            </div>
          </div>
        ) : null}
        {bulkDeleting ? <InlineLoadingState className="mb-3" message="Benutzer werden gelöscht ..." /> : null}

        <div className="soft-scrollbar hidden overflow-x-auto md:block">
          <table className="w-full min-w-[760px] border-separate border-spacing-y-2 text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="Alle Benutzer auswählen"
                    checked={allSelectableSelected}
                    onChange={toggleSelectAll}
                    disabled={!selectableUsers.length}
                    className="rounded border-slate-300"
                  />
                </th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">E-Mail</th>
                <th className="px-3 py-2">Rolle</th>
                <th className="px-3 py-2">Abteilung / Standort</th>
                <th className="px-3 py-2">Letzte Aktivität</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Aktion</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const isSelf = user.id === currentUserId;
                const selectableIndex = isSelf ? -1 : selectableUsers.findIndex((item) => item.id === user.id);
                const isSelected = selectedIds.includes(user.id);
                return (
                <tr
                  key={user.id}
                  className={`rounded-xl text-slate-700 ${isSelected ? 'bg-brand-50/70 ring-1 ring-brand-200' : 'bg-slate-50'}`}
                >
                  <td className="rounded-l-xl px-3 py-3">
                    <input
                      type="checkbox"
                      aria-label={`${user.name} auswählen`}
                      checked={isSelected}
                      disabled={isSelf}
                      onChange={(event) =>
                        toggleSelected(user.id, selectableIndex, Boolean((event.nativeEvent as MouseEvent).shiftKey))
                      }
                      className="rounded border-slate-300"
                    />
                  </td>
                  <td className="px-3 py-3">
                    <p className="font-semibold text-slate-900">{user.name}</p>
                  </td>
                  <td className="px-3 py-3">{user.email}</td>
                  <td className="px-3 py-3">
                    <span className="status-chip border-slate-200 bg-slate-100 text-slate-700">
                      <Shield className="h-3.5 w-3.5" />
                      {user.role}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-xs text-slate-600">{(user.department || '-') + ' / ' + (user.location || '-')}</td>
                  <td className="px-3 py-3">{user.lastActive}</td>
                  <td className="px-3 py-3">
                    <StatusBadge value={user.status} />
                  </td>
                  <td className="rounded-r-xl px-3 py-3 text-right">
                    <div className="inline-flex items-center gap-2">
                      <button type="button" className="btn-secondary px-2.5 py-1.5 text-xs" onClick={() => openEdit(user)}>
                        Bearbeiten
                      </button>
                      <LoadingButton
                        type="button"
                        className="btn-secondary border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                        onClick={() => {
                          void removeUser(user);
                        }}
                        disabled={user.id === currentUserId}
                        isLoading={deletingUserId === user.id}
                        loadingText="Lösche ..."
                      >
                        <span className="inline-flex items-center gap-1">
                          <Trash2 className="h-3.5 w-3.5" />
                          {user.id === currentUserId ? 'Eigener Account' : 'Löschen'}
                        </span>
                      </LoadingButton>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="grid gap-3 md:hidden">
          {users.map((user) => {
            const isSelf = user.id === currentUserId;
            const selectableIndex = isSelf ? -1 : selectableUsers.findIndex((item) => item.id === user.id);
            const isSelected = selectedIds.includes(user.id);
            return (
            <article
              key={`mobile-${user.id}`}
              className={`surface-muted p-3 ${isSelected ? 'ring-2 ring-brand-300' : ''}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    aria-label={`${user.name} auswählen`}
                    checked={isSelected}
                    disabled={isSelf}
                    onChange={(event) =>
                      toggleSelected(user.id, selectableIndex, Boolean((event.nativeEvent as MouseEvent).shiftKey))
                    }
                    className="mt-1 rounded border-slate-300"
                  />
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{user.name}</p>
                    <p className="text-xs text-slate-500">{user.email}</p>
                  </div>
                </div>
                <StatusBadge value={user.status} />
              </div>
              <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700">
                <Shield className="h-3.5 w-3.5" />
                {user.role}
              </div>
              <p className="mt-2 text-xs text-slate-500">{(user.department || '-') + ' / ' + (user.location || '-')}</p>
              <p className="mt-2 text-xs text-slate-500">Letzte Aktivität: {user.lastActive}</p>
              <button type="button" className="btn-secondary mt-3 px-2.5 py-1.5 text-xs" onClick={() => openEdit(user)}>
                Bearbeiten
              </button>
              <LoadingButton
                type="button"
                className="btn-secondary mt-2 border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => {
                  void removeUser(user);
                }}
                disabled={user.id === currentUserId}
                isLoading={deletingUserId === user.id}
                loadingText="Lösche ..."
              >
                <span className="inline-flex items-center gap-1">
                  <Trash2 className="h-3.5 w-3.5" />
                  {user.id === currentUserId ? 'Eigener Account' : 'Löschen'}
                </span>
              </LoadingButton>
            </article>
            );
          })}
        </div>

        {!users.length ? (
          <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
            <Users2 className="mx-auto h-5 w-5 text-slate-400" />
            <p className="mt-2">Noch keine Benutzer vorhanden.</p>
          </div>
        ) : null}
      </article>

      <article className="surface-card animate-fade-up">
        <h3 className="text-base font-semibold text-slate-900">Zugeordnete Hardware und letzte Aktivitäten</h3>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {users.slice(0, 6).map((user) => {
            const assigned = loanedAssets.filter((asset) => asset.assignedTo.toLowerCase().includes(user.name.toLowerCase()));
            const recent = recentActivityByUser.get(user.id) ?? [];
            return (
              <div key={`ctx-${user.id}`} className="surface-muted p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900">{user.name}</p>
                  <StatusBadge value={user.status} />
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Zugeordnete Geräte: <span className="font-semibold text-slate-700">{assigned.length}</span>
                </p>
                {assigned.length ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {assigned.slice(0, 3).map((asset) => (
                      <button
                        type="button"
                        key={`${user.id}-${asset.id}`}
                        className="btn-secondary px-2 py-1 text-xs"
                        onClick={() => onOpenInventoryWithQuery(asset.name)}
                      >
                        {asset.name}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-slate-500">Keine aktuelle Ausleihe.</p>
                )}
                {recent.length ? (
                  <ul className="mt-2 space-y-1">
                    {recent.map((entry) => (
                      <li key={entry.id} className="text-xs text-slate-600">
                        {entry.title}: {entry.detail}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            );
          })}
        </div>
      </article>

      {formOpen ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-900/55 p-3 sm:items-center">
          <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-panel sm:p-5">
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-700">Benutzerverwaltung</p>
                <h3 className="text-lg font-semibold text-slate-900">{form.id ? 'Benutzer bearbeiten' : 'Benutzer anlegen'}</h3>
              </div>
              <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={closeForm}>
                Schließen
              </button>
            </div>

            {error ? (
              <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
            ) : null}
            {saving ? <InlineLoadingState className="mb-3" message="Benutzer wird gespeichert ..." /> : null}

            <div className="space-y-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <h4 className="text-sm font-semibold text-slate-900">Grunddaten</h4>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <label className="field">
                    Name *
                    <input
                      className="field-input"
                      value={form.name}
                      onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                    />
                  </label>
                  <label className="field">
                    E-Mail / Benutzername *
                    <input
                      className="field-input"
                      value={form.email}
                      onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                    />
                  </label>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <h4 className="text-sm font-semibold text-slate-900">Rolle und Zugriff</h4>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <label className="field">
                    Rolle
                    <select
                      className="field-input"
                      value={form.role}
                      onChange={(event) => setForm((current) => ({ ...current, role: event.target.value as UserItem['role'] }))}
                    >
                      <option value="Admin">Admin / Techniker</option>
                      <option value="Projektmanager">Projektmanager</option>
                      <option value="Mitarbeiter">Mitarbeiter / Junior</option>
                      <option value="Junior">Junior</option>
                    </select>
                  </label>
                  <label className="field">
                    Status
                    <select
                      className="field-input"
                      value={form.status}
                      onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as UserItem['status'] }))}
                    >
                      <option value="Aktiv">Aktiv</option>
                      <option value="Inaktiv">Inaktiv</option>
                    </select>
                  </label>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <h4 className="text-sm font-semibold text-slate-900">Organisation</h4>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <label className="field">
                    Abteilung
                    <input
                      className="field-input"
                      value={form.department}
                      onChange={(event) => setForm((current) => ({ ...current, department: event.target.value }))}
                    />
                  </label>
                  <label className="field">
                    Standort
                    <input
                      className="field-input"
                      value={form.location}
                      onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))}
                    />
                  </label>
                </div>
              </div>
            </div>

            <div className="sticky bottom-0 mt-4 flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-white pt-3">
              {form.id && userInForm ? (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    void resetPassword(userInForm);
                  }}
                >
                  <span className="inline-flex items-center gap-1">
                    <KeyRound className="h-4 w-4" />
                    Passwort zurücksetzen
                  </span>
                </button>
              ) : null}
              <button type="button" className="btn-secondary" onClick={closeForm}>
                Abbrechen
              </button>
              <LoadingButton type="button" className="btn-primary" onClick={() => void submit()} isLoading={saving} loadingText="Speichern ...">
                Speichern
              </LoadingButton>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
