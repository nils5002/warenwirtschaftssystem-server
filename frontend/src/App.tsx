import { useEffect, useMemo, useState } from 'react';
import { Sidebar } from './asset-ui/components/Sidebar';
import { Topbar } from './asset-ui/components/Topbar';
import { UpdateNotesModal } from './asset-ui/components/UpdateNotesModal';
import { LoginPage } from './components/auth/LoginPage';
import { InlineLoadingState } from './components/loading';
import { WmsPageView } from './components/WmsPageView';
import { navigation } from './config/navigation';
import { PAGE_PERMISSION, legacyVisible } from './config/pageAccess';
import type { AppPage } from './asset-ui/types';
import { useWmsController } from './hooks/useWmsController';
import { useIsMobile } from './hooks/useIsMobile';
import { normalizePathname } from './routing/appRoutes';
import { navigate } from './routing/router';
import {
  fetchAuthMe,
  login,
  logout,
  register,
  setUnauthorizedHandler,
  type AuthUser,
} from './services/wmsApi';

// sessionStorage-Key für den Deep-Link, der einen ausgeloggten Nutzer auf die
// Login-Seite geführt hat — nach erfolgreichem Login geht es dorthin zurück.
const POST_LOGIN_REDIRECT_KEY = 'wms.postLoginRedirect';

function App() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  // authBooting bleibt true, bis per GET /api/auth/me geklaert ist, ob ein
  // gueltiges HttpOnly-Auth-Cookie vorliegt (Security-Audit Paket B4). Da das
  // Cookie fuer JavaScript unsichtbar ist, ist dieser Server-Roundtrip beim
  // Start unvermeidbar — der lokale Auth-Status kann nicht vorab feststehen.
  const [authBooting, setAuthBooting] = useState<boolean>(true);
  // Einmalige Meldung nach einem Guard-Redirect (z. B. Mitarbeiter öffnet
  // /benutzer per Deep-Link) — statt einer weißen Seite oder stillem Sprung.
  const [accessNotice, setAccessNotice] = useState<string | null>(null);

  const activeRole = authUser?.role ?? 'Mitarbeiter';
  const isAuthenticated = !!authUser;
  const isMobile = useIsMobile();
  const controller = useWmsController({
    activeRole,
    isAuthenticated,
  });

  // Beim Start einmalig pruefen, ob das Auth-Cookie eine gueltige Sitzung
  // traegt. Erfolg -> eingeloggt; 401/Fehler -> Login-Seite.
  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      try {
        const user = await fetchAuthMe();
        if (!cancelled) {
          setAuthUser(user);
        }
      } catch {
        if (!cancelled) {
          setAuthUser(null);
        }
      } finally {
        if (!cancelled) {
          setAuthBooting(false);
        }
      }
    };
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  // Zentrales 401-Handling: antwortet das Backend auf irgendeinen Request
  // mit 401, verwirft der API-Client die Session und meldet das hierher.
  // Dann wird der React-Auth-State zurückgesetzt, sodass die App sauber
  // auf die Login-Seite zurückwechselt — statt mit ungültigem Token in
  // einem halb eingeloggten Zustand zu verharren.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setAuthUser(null);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const visibleNavigation = useMemo(() => {
    const perms = authUser?.permissions;
    // Ohne effektive Rechte (älteres Backend): rein rollenbasiert wie bisher.
    if (!Array.isArray(perms)) {
      return navigation.filter((item) => legacyVisible(item.key, activeRole));
    }
    // Rechte-gesteuerte Seiten über die Berechtigung filtern; alle übrigen
    // Seiten behalten ihr bisheriges rollenbasiertes Verhalten.
    const permSet = new Set(perms);
    return navigation.filter((item) => {
      const required = PAGE_PERMISSION[item.key];
      return required ? permSet.has(required) : legacyVisible(item.key, activeRole);
    });
  }, [authUser?.permissions, activeRole]);

  useEffect(() => {
    // Nur für authentifizierte Sitzungen prüfen: Während des Auth-Boots ist
    // die Rolle noch der Mitarbeiter-Fallback — der Guard würde sonst einen
    // Admin-Deep-Link (z. B. /benutzer) zerstören, bevor der
    // Post-Login-Redirect ihn sichern kann.
    if (authBooting || !isAuthenticated) {
      return;
    }
    if (controller.activePage === 'assetDetail') {
      return;
    }
    if (!visibleNavigation.some((item) => item.key === controller.activePage)) {
      // replace: die verbotene URL darf nicht als History-Eintrag bestehen
      // bleiben — Back soll nicht wieder auf die gesperrte Seite führen.
      setAccessNotice('Kein Zugriff auf diesen Bereich — Sie wurden zum Dashboard weitergeleitet.');
      controller.setActivePage('dashboard', { replace: true });
    }
  }, [authBooting, isAuthenticated, controller.activePage, controller.setActivePage, visibleNavigation]);

  // Zugriffs-Hinweis nach ein paar Sekunden automatisch ausblenden.
  useEffect(() => {
    if (!accessNotice) return;
    const timer = window.setTimeout(() => setAccessNotice(null), 6000);
    return () => window.clearTimeout(timer);
  }, [accessNotice]);

  useEffect(() => {
    if (typeof window === 'undefined' || authBooting) return;
    const currentPath = normalizePathname(window.location.pathname);

    if (!isAuthenticated) {
      if (currentPath !== '/login') {
        // Deep-Link merken (inkl. Query/Hash), damit der Nutzer nach dem
        // Login wieder dort landet, wo er hinwollte — z. B. bei einem
        // geteilten Link auf ein Asset-Detail.
        if (currentPath !== '/') {
          try {
            sessionStorage.setItem(
              POST_LOGIN_REDIRECT_KEY,
              `${window.location.pathname}${window.location.search}${window.location.hash}`,
            );
          } catch {
            // Storage nicht verfügbar (z. B. blockiert) — Redirect entfällt.
          }
        }
        navigate('/login', { replace: true });
      }
      return;
    }

    let redirect: string | null = null;
    try {
      redirect = sessionStorage.getItem(POST_LOGIN_REDIRECT_KEY);
      sessionStorage.removeItem(POST_LOGIN_REDIRECT_KEY);
    } catch {
      redirect = null;
    }
    // Nur app-interne Pfade akzeptieren ("/..."), keine protokoll-relativen
    // URLs ("//host") — verhindert Redirects aus manipuliertem Storage.
    if (redirect && /^\/(?!\/)/.test(redirect)) {
      navigate(redirect, { replace: true });
      return;
    }

    if (currentPath === '/login' || currentPath === '/') {
      navigate('/dashboard', { replace: true });
    }
  }, [authBooting, isAuthenticated]);

  const activeItem = visibleNavigation.find((item) => item.key === controller.activePage);
  const mobileNavItems = visibleNavigation.filter((item) =>
    ['dashboard', 'checkinCheckout', 'inventory', 'planning', 'tickets'].includes(item.key),
  );
  const mobileNavLabelMap: Record<string, string> = {
    dashboard: 'Start',
    checkinCheckout: 'Scan',
    inventory: 'Inventar',
    planning: 'Planung',
    tickets: 'Defekte',
  };
  const sidebarStats = {
    availableAssets: controller.assets.filter((asset) => asset.status === 'Verfügbar').length,
    loanedAssets: controller.assets.filter((asset) => asset.status === 'Verliehen').length,
    openTickets: controller.maintenanceItems.filter((item) => item.status !== 'Erledigt').length,
    activePlannings: controller.reservations.filter((item) => item.status === 'Aktiv').length,
  };

  const handleLogin = async (payload: { email: string; password: string }) => {
    // login() setzt serverseitig das HttpOnly-Auth-Cookie und liefert das
    // Benutzerprofil zurueck. Kein Token wird im Client gespeichert.
    const user = await login(payload);
    setAuthUser(user);
  };

  const handleRegister = async (payload: { name: string; email: string; password: string; website?: string }) => {
    const response = await register(payload);
    return response.message;
  };

  const handleLogout = async () => {
    // Serverseitig invalidieren (token_version erhöhen) und das Auth-Cookie
    // löschen — danach den lokalen Auth-Status verwerfen. Bewusster Logout:
    // kein Rücksprung-Deep-Link für den nächsten Login merken.
    try {
      sessionStorage.removeItem(POST_LOGIN_REDIRECT_KEY);
    } catch {
      // Storage nicht verfügbar — unkritisch.
    }
    await logout();
    // Erst zur Login-URL wechseln, dann den Auth-State verwerfen — sonst
    // würde der Auth-Effekt die aktuelle Seite als Rücksprungziel speichern.
    navigate('/login', { replace: true });
    setAuthUser(null);
  };

  if (authBooting) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-slate-600">
        Sitzung wird geprüft...
      </div>
    );
  }

  if (!authUser) {
    return <LoginPage onLogin={handleLogin} onRegister={handleRegister} />;
  }

  return (
    <div className="min-h-screen text-ink">
      <UpdateNotesModal />
      <Sidebar
        items={visibleNavigation}
        activePage={controller.activePage}
        onSelect={controller.setActivePage}
        mobileOpen={controller.mobileSidebarOpen}
        onCloseMobile={() => controller.setMobileSidebarOpen(false)}
        stats={sidebarStats}
      />

      {/* Muss zur responsiven Sidebar-Breite passen (Sidebar.tsx):
          md–2xl 240px, ab 2xl 264px. */}
      <div className={`relative ${isMobile ? '' : 'md:pl-60 2xl:pl-[264px]'}`}>
        <Topbar
          search={controller.search}
          onSearch={controller.setSearch}
          onMenuOpen={() => controller.setMobileSidebarOpen(true)}
          theme={controller.theme}
          onSelectTheme={controller.setTheme}
          activeRole={activeRole}
          userName={authUser.name}
          projectContext={controller.projectContext}
          onProjectContextChange={controller.setProjectContext}
          onOpenHelp={controller.openHelp}
          onOpenNotifications={controller.openNotifications}
          onOpenProfile={controller.openProfile}
          onLogout={handleLogout}
          activePage={controller.activePage}
          activeLabel={activeItem?.label ?? (controller.activePage === 'assetDetail' ? 'Asset-Detail' : 'Dashboard')}
          activeHint={activeItem?.hint}
          compact={isMobile}
        />
        <main className={`px-3 pt-4 sm:px-4 md:px-8 md:pt-6 ${isMobile ? 'pb-[calc(7.5rem+env(safe-area-inset-bottom))]' : 'pb-[calc(1.25rem+env(safe-area-inset-bottom))]'}`}>
          <div className={`mx-auto w-full ${controller.activePage === 'inventory' ? 'max-w-[1920px]' : 'max-w-[1600px]'}`}>
            {controller.isLoading ? <InlineLoadingState className="mb-4" message="Daten werden geladen ..." /> : null}
            {/*
              Bewusst KEIN globaler Banner für isRefreshing:
              Hintergrund-Polling und gezielte Reloads (z. B. nach Planungs-
              Aktionen) sollen den Seiteninhalt nicht visuell verschieben oder
              "leerziehen". Lokale Aktions-Indikatoren der Seiten (z. B.
              busyState in PlanningPage, LoadingButton in BackupPage) zeigen
              die Aktivität fokussiert dort, wo sie stattfindet.
            */}
            {controller.wmsError ? (
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                {controller.wmsError}
              </div>
            ) : null}
            {accessNotice ? (
              <div className="mb-4 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300">
                {accessNotice}
              </div>
            ) : null}
            <WmsPageView
              activePage={controller.activePage}
              routePlanningId={controller.routePlanningId}
              permissions={authUser.permissions}
              currentUserId={authUser.userId}
              currentUserName={authUser.name}
              projectContext={controller.projectContext}
              theme={controller.theme}
              onProjectContextChange={controller.setProjectContext}
              assets={controller.assets}
              activities={controller.activities}
              reservations={controller.reservations}
              maintenanceItems={controller.maintenanceItems}
              locations={controller.locations}
              categories={controller.categories}
              users={controller.users}
              planningSummary={controller.planningSummary}
              selectedAsset={controller.selectedAsset}
              isInitialLoading={controller.isInitialLoading}
              onOpenAssetDetail={controller.openAssetDetail}
              onCreateAsset={controller.createAsset}
              onCreateAssetFromInput={controller.createAssetFromInput}
              onReserveAsset={controller.reserveAsset}
              onCheckoutAsset={(id) => controller.checkoutAsset(id)}
              onCheckinAsset={(id) => controller.checkinAsset(id)}
              onAdminUpdateAsset={controller.adminUpdateAsset}
              onAdminDeleteAsset={controller.adminDeleteAsset}
              onSetAssetMaintenance={controller.setAssetMaintenance}
              onCreateReservation={controller.createReservation}
              onEditReservation={controller.editReservation}
              onCheckoutReservation={controller.checkoutReservation}
              onCancelReservation={controller.cancelReservation}
              onCreateMaintenance={controller.createMaintenance}
              onUpdateMaintenanceStatus={controller.updateMaintenanceStatus}
              onInviteUser={controller.inviteUser}
              onEditUser={controller.editUser}
              onResetUserPassword={controller.adminResetUserPassword}
              onSetUserAccountStatus={controller.adminSetUserAccountStatus}
              onDeleteUser={controller.adminDeleteUser}
              onBulkDeleteUsers={controller.adminBulkDeleteUsers}
              onOpenLocationInventory={controller.openLocationInventory}
              onEditLocation={controller.editLocation}
              onCleanupUnusedLocations={controller.cleanupUnusedLocations}
              onCreateCategory={controller.createCategory}
              onUpdateCategory={controller.updateCategory}
              onRefreshCategoryImage={controller.refreshCategoryImage}
              onRefreshAssetImage={controller.refreshAssetImage}
              onDeleteCategory={controller.deleteCategory}
              onReloadData={controller.loadWms}
              onCheckoutFromForm={controller.checkoutFromForm}
              onCheckinFromForm={controller.checkinFromForm}
              onNavigate={controller.setActivePage}
              onOpenInventoryWithQuery={controller.openInventoryWithQuery}
              onOpenInventoryWithStatus={controller.openInventoryWithStatus}
              onOpenCheckinCheckout={controller.openCheckinCheckout}
              activeRole={activeRole}
              isMobile={isMobile}
            />
          </div>
        </main>
        {isMobile ? (
          <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface px-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-2">
            <div className="grid grid-cols-5 gap-2">
              {mobileNavItems.map((item) => {
                const active = controller.activePage === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    className={`flex min-h-[52px] flex-col items-center justify-center rounded-xl px-1 text-[10px] font-semibold leading-tight transition ${
                      active
                        ? 'bg-primary-soft text-primary'
                        : 'text-ink-muted hover:bg-surface-2 hover:text-ink'
                    }`}
                    onClick={() => controller.setActivePage(item.key)}
                  >
                    <item.icon className="h-5 w-5" />
                    <span className="mt-1 truncate">{mobileNavLabelMap[item.key] ?? item.label}</span>
                  </button>
                );
              })}
            </div>
          </nav>
        ) : null}
      </div>
    </div>
  );
}

export default App;
