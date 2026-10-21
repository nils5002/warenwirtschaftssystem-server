import { UserCircle2 } from 'lucide-react';

import { CompanionSection } from '../../components/companion/CompanionSection';
import { PageHeader } from '../../ui';
import type { AppRole } from '../types';

type AccountPageProps = {
  userName: string;
  userEmail?: string;
  role: AppRole;
};

/** Eigene Kontoeinstellungen — für jede Rolle erreichbar. */
export function AccountPage({ userName, userEmail, role }: AccountPageProps) {
  return (
    <section className="space-y-5">
      <PageHeader kicker="Konto" title="Mein Konto" subtitle="Profil und verbundene Geräte." />

      <article className="surface-card flex items-center gap-4">
        <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700 dark:bg-brand-900/60 dark:text-brand-200">
          <UserCircle2 className="h-6 w-6" />
        </span>
        <dl className="min-w-0 text-sm">
          <dt className="sr-only">Name</dt>
          <dd className="truncate text-base font-semibold text-slate-900">{userName}</dd>
          {userEmail ? (
            <>
              <dt className="sr-only">E-Mail</dt>
              <dd className="truncate text-slate-600">{userEmail}</dd>
            </>
          ) : null}
          <dt className="sr-only">Rolle</dt>
          <dd className="text-slate-500">Rolle: {role}</dd>
        </dl>
      </article>

      <CompanionSection />
    </section>
  );
}
