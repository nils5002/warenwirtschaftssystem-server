import { useEffect, useMemo, useState } from 'react';
import { Sidebar } from './asset-ui/components/Sidebar';
import { Topbar } from './asset-ui/components/Topbar';
import { UpdateNotesModal } from './asset-ui/components/UpdateNotesModal';
import { LoginPage } from './components/auth/LoginPage';
import { InlineLoadingState } from './components/loading';
import { WmsPageView } from './components/WmsPageView';
import { navigation } from './config/navigation';
import { useWmsController } from './hooks/useWmsController';
import { useIsMobile } from './hooks/useIsMobile';
import { normalizePathname } from './routing/appRoutes';
import {
  fetchAuthMe,
  login,
  logout,
  register,
  setUnauthorizedHandler,
  type AuthUser,
} from './services/wmsApi';

function App() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  // authBooting bleibt true, bis per GET /api/auth/me geklaert ist, ob ein
  // gueltiges HttpOnly-Auth-Cookie vorliegt (Security-Audit Paket B4). Da das
  // Cookie fuer JavaScript unsichtbar ist, ist dieser Server-Roundtrip beim
  // Start unvermeidbar — der lokale Auth-Status kann nicht vorab feststehen.
  const [authBooting, setAuthBooting] = useState<boolean>(true);

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
    if (activeRole === 'Admin') return navigation;
    if (activeRole === 'Projektmanager') {
      // Projektmanager: kein User-/Import-/Backup-/QR-/Massendruck-Zugriff.
      // Kategorien IST sichtbar — PMs dürfen Stammdaten-Kategorien löschen
      // (Anlegen bleibt admin-only, Hinweis dazu in der Page selbst).
      // Fremdbestand IST Teil der Projektplanung und ebenfalls sichtbar.
      return navigation.filter(
        (item) =>
          !['users', 'importExport', 'backup', 'qrFunctions', 'massPrint'].includes(item.key),
      );
    }
    // Mitarbeiter / Junior: kein Verwaltungszugriff inkl. Fremdbestand.
    return navigation.filter(
      (item) =>
        !['users', 'categories', 'importExport', 'backup', 'massPrint', 'externalPool'].includes(item.key),
    );
  }, [activeRole]);

  useEffect(() => {
    if (controller.activePage === 'assetDetail') {
      return;
    }
    if (!visibleNavigation.some((item) => item.key === controller.activePage)) {
      controller.setActivePage('dashboard');
    }
  }, [controller.activePage, controller.setActivePage, visibleNavigation]);

  useEffect(() => {
    if (typeof window === 'undefined' || authBooting) return;
    const currentPath = normalizePathname(window.location.pathname);

    if (!isAuthenticated) {
      if (currentPath !== '/login') {
        window.history.replaceState(null, '', '/login');
      }
      return;
    }

    if (currentPath === '/login' || currentPath === '/') {
      window.history.replaceState(null, '', '/dashboard');
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

  const handleRegister = async (payload: { name: string; email: string; password: string }) => {
    const response = await register(payload);
    return response.message;
  };

  const handleLogout = async () => {
    // Serverseitig invalidieren (token_version erhöhen) und das Auth-Cookie
    // löschen — danach den lokalen Auth-Status verwerfen.
    await logout();
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
    <div className="min-h-screen text-slate-900">
      <UpdateNotesModal />
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-20 -top-12 h-72 w-72 rounded-full bg-brand-200/55 blur-3xl" />
        <div className="absolute right-0 top-14 h-80 w-80 rounded-full bg-cyan-200/35 blur-3xl" />
      </div>

      <Sidebar
        items={visibleNavigation}
        activePage={controller.activePage}
        onSelect={controller.setActivePage}
        mobileOpen={controller.mobileSidebarOpen}
        onCloseMobile={() => controller.setMobileSidebarOpen(false)}
        stats={sidebarStats}
      />

      <div className={`relative ${isMobile ? '' : 'md:pl-72'}`}>
        <Topbar
          search={controller.search}
          onSearch={controller.setSearch}
          onMenuOpen={() => controller.setMobileSidebarOpen(true)}
          theme={controller.theme}
          onToggleTheme={controller.toggleTheme}
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
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                {controller.wmsError}
              </div>
            ) : null}
            <WmsPageView
              activePage={controller.activePage}
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
              search={controller.search}
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
              onEditAsset={controller.editAsset}
              onCreateReservation={controller.createReservation}
              onEditReservation={controller.editReservation}
              onCheckoutReservation={controller.checkoutReservation}
              onCancelReservation={controller.cancelReservation}
              onCreateMaintenance={controller.createMaintenance}
              onUpdateMaintenanceStatus={controller.updateMaintenanceStatus}
              onInviteUser={controller.inviteUser}
              onEditUser={controller.editUser}
              onResetUserPassword={controller.adminResetUserPassword}
              onDeleteUser={controller.adminDeleteUser}
              onBulkDeleteUsers={controller.adminBulkDeleteUsers}
              onOpenLocationInventory={controller.openLocationInventory}
              onEditLocation={controller.editLocation}
              onCreateCategory={controller.createCategory}
              onDeleteCategory={controller.deleteCategory}
              onReloadData={controller.loadWms}
              onCheckoutFromForm={controller.checkoutFromForm}
              onCheckinFromForm={controller.checkinFromForm}
              onNavigate={controller.setActivePage}
              onOpenInventoryWithQuery={controller.openInventoryWithQuery}
              activeRole={activeRole}
              isMobile={isMobile}
            />
          </div>
        </main>
        {isMobile ? (
          <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-2 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
            <div className="grid grid-cols-5 gap-2">
              {mobileNavItems.map((item) => {
                const active = controller.activePage === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    className={`flex min-h-[52px] flex-col items-center justify-center rounded-xl border px-1 text-[10px] font-semibold leading-tight ${
                      active
                        ? 'border-brand-300 bg-brand-50 text-brand-800 dark:border-sky-700 dark:bg-sky-900/40 dark:text-sky-200'
                        : 'border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
                    }`}
                    onClick={() => controller.setActivePage(item.key)}
                  >
                    <item.icon className="h-4 w-4" />
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
