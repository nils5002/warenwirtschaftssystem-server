import { AssetDetailPage } from '../asset-ui/pages/AssetDetailPage';
import { AssetsPage } from '../asset-ui/pages/AssetsPage';
import { BackupPage } from '../asset-ui/pages/BackupPage';
import { UpdateNotesAdminPage } from '../asset-ui/pages/UpdateNotesAdminPage';
import { CategoriesPage } from '../asset-ui/pages/CategoriesPage';
import { CheckinCheckoutPage } from '../asset-ui/pages/CheckinCheckoutPage';
import { DashboardPage } from '../asset-ui/pages/DashboardPage';
import { ExternalPoolPage } from '../asset-ui/pages/ExternalPoolPage';
import { ImportExportPage } from '../asset-ui/pages/ImportExportPage';
import { MaintenancePage } from '../asset-ui/pages/MaintenancePage';
import { LabelAuditPage } from '../asset-ui/pages/LabelAuditPage';
import { MassPrintPage } from '../asset-ui/pages/MassPrintPage';
import { MobileDashboardPage } from '../asset-ui/pages/MobileDashboardPage';
import { PlanningPage } from '../asset-ui/pages/PlanningPage';
import { QrFunctionsPage } from '../asset-ui/pages/QrFunctionsPage';
import { RolesPermissionsPage } from '../asset-ui/pages/RolesPermissionsPage';
import { TelecomPassSettingsPage } from '../asset-ui/pages/TelecomPassSettingsPage';
import { UsersPage } from '../asset-ui/pages/UsersPage';
import type {
  ActivityItem,
  AppPage,
  AppRole,
  Asset,
  CategoryItem,
  LocationItem,
  MaintenanceItem,
  ReservationItem,
  UserItem,
} from '../asset-ui/types';
import type { Theme } from '../hooks/useTheme';
import type { WmsOverview } from '../services/wmsApi';

type WmsPageViewProps = {
  activePage: AppPage;
  activeRole: AppRole;
  // Effektive Rechte-Keys des aktuellen Users (Feature „Rollen & Rechte").
  // Optional: fehlt das Feld (älteres Backend), wird auf die Rollenlogik
  // zurückgefallen, damit z. B. Admins nicht versehentlich Buttons verlieren.
  permissions?: string[];
  currentUserId: string;
  currentUserName: string;
  projectContext: string;
  theme: Theme;
  onProjectContextChange: (value: string) => void;
  assets: Asset[];
  activities: ActivityItem[];
  reservations: ReservationItem[];
  maintenanceItems: MaintenanceItem[];
  locations: LocationItem[];
  users: UserItem[];
  planningSummary: WmsOverview['planningSummary'];
  categories: CategoryItem[];
  selectedAsset: Asset | null;
  search: string;
  onOpenAssetDetail: (assetId: string) => void;
  onCreateAsset: () => Promise<void>;
  onCreateAssetFromInput: (payload: {
    category: string;
    name: string;
    manufacturer?: string;
    model?: string;
    serialNumber: string;
    ipAddress?: string;
    macLan?: string;
    macWlan?: string;
    tagNumber?: string;
    location?: string;
    notes?: string;
    // Planungsrelevante Asset-Flags (analog CreateAssetInput im Controller).
    cardPrinterCompatible?: boolean;
    availableForPlanning?: boolean;
  }) => Promise<Asset>;
  onReserveAsset: (assetId: string) => Promise<void>;
  onCheckoutAsset: (assetId: string) => Promise<void>;
  onCheckinAsset: (assetId: string) => Promise<void>;
  onAdminUpdateAsset: (assetId: string, patch: Partial<Asset>) => Promise<void>;
  onAdminDeleteAsset: (assetId: string) => Promise<void>;
  onSetAssetMaintenance: (assetId: string) => Promise<void>;
  onEditAsset: (assetId: string) => Promise<void>;
  onCreateReservation: () => Promise<void>;
  onEditReservation: (id: string) => Promise<void>;
  onCheckoutReservation: (id: string) => Promise<void>;
  onCancelReservation: (id: string) => Promise<void>;
  onCreateMaintenance: (payload: {
    assetName: string;
    issue: string;
    comment: string;
    priority?: MaintenanceItem['priority'];
    status?: MaintenanceItem['status'];
    location?: string;
  }) => Promise<void>;
  onUpdateMaintenanceStatus: (id: string, status: MaintenanceItem['status']) => Promise<void>;
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
  onBulkDeleteUsers: (ids: string[]) => Promise<{
    deletedCount: number;
    skippedCount: number;
    results: { userId: string; deleted: boolean; reason?: string | null }[];
  }>;
  onOpenLocationInventory: (name: string) => void;
  onEditLocation: (name: string) => Promise<void>;
  onCreateCategory: (name: string) => Promise<CategoryItem>;
  onDeleteCategory?: (categoryId: number) => Promise<void>;
  onReloadData: () => Promise<void>;
  onCheckoutFromForm: (payload: {
    assetId: string;
    assignee: string;
    projectName?: string;
    dueDate: string;
    note: string;
  }) => Promise<void>;
  onCheckinFromForm: (payload: {
    assetId: string;
    condition: string;
    projectName?: string;
  }) => Promise<void>;
  onNavigate: (page: AppPage) => void;
  onOpenInventoryWithQuery: (query: string) => void;
  // Inventar gefiltert auf einen Status öffnen (Dashboard-Schnellzugriff).
  onOpenInventoryWithStatus: (status: Asset['status'] | null) => void;
  // Transienter Statusfilter, den AssetsPage beim Mount übernimmt und danach
  // über onConsumeInventoryStatusFilter wieder leert.
  inventoryStatusFilter?: Asset['status'] | 'Alle Status' | null;
  onConsumeInventoryStatusFilter: () => void;
  // Transienter Start-Modus für die Ein-/Auslagerung (Mobile-Kachel
  // „Gerät zurücknehmen“). CheckinCheckoutPage übernimmt ihn beim Mount und
  // leert ihn über onConsumeCheckinCheckoutMode.
  checkinCheckoutMode?: 'checkout' | 'checkin' | null;
  onOpenCheckinCheckout?: (mode: 'checkout' | 'checkin') => void;
  onConsumeCheckinCheckoutMode?: () => void;
  isMobile?: boolean;
  // True solange der erste /api/wms/overview-Call noch läuft. Pages
  // verwenden das, um keine 0-Werte als Bestand anzuzeigen.
  isInitialLoading?: boolean;
};

export function WmsPageView({
  activePage,
  activeRole,
  permissions,
  currentUserId,
  currentUserName,
  projectContext,
  theme,
  onProjectContextChange,
  assets,
  activities,
  reservations,
  maintenanceItems,
  locations,
  users,
  planningSummary,
  categories,
  selectedAsset,
  search,
  onOpenAssetDetail,
  onCreateAsset,
  onCreateAssetFromInput,
  onReserveAsset,
  onCheckoutAsset,
  onCheckinAsset,
  onAdminUpdateAsset,
  onAdminDeleteAsset,
  onSetAssetMaintenance,
  onEditAsset,
  onCreateReservation,
  onEditReservation,
  onCheckoutReservation,
  onCancelReservation,
  onCreateMaintenance,
  onUpdateMaintenanceStatus,
  onInviteUser,
  onEditUser,
  onResetUserPassword,
  onDeleteUser,
  onBulkDeleteUsers,
  onOpenLocationInventory,
  onEditLocation,
  onCreateCategory,
  onDeleteCategory,
  onReloadData,
  onCheckoutFromForm,
  onCheckinFromForm,
  onNavigate,
  onOpenInventoryWithQuery,
  onOpenInventoryWithStatus,
  inventoryStatusFilter,
  onConsumeInventoryStatusFilter,
  checkinCheckoutMode,
  onOpenCheckinCheckout,
  onConsumeCheckinCheckoutMode,
  isMobile = false,
  isInitialLoading = false,
}: WmsPageViewProps) {
  const isAdmin = activeRole === 'Admin';
  // Rechte-gesteuerte Button-Sichtbarkeit (Feature „Rollen & Rechte"). Liegen
  // effektive Rechte vor, entscheiden sie; sonst Fallback auf die bisherige
  // Rollenlogik. So laufen die Buttons nicht mehr blind über role === 'Admin'.
  const permsProvided = Array.isArray(permissions);
  const can = (key: string, fallback: boolean): boolean =>
    permsProvided ? permissions!.includes(key) : fallback;
  // Inventar voll bearbeiten / Neue Hardware: assets.update (Default: nur Admin).
  const canUpdateAssets = can('assets.update', isAdmin);
  // Defekt-/Wartungsverwaltung (z. B. „In Wartung setzen"): defects.manage.
  const canManageDefects = can('defects.manage', isAdmin);
  // Defekt melden bleibt für Mitarbeiter offen, sofern defects.report aktiv ist.
  const canReportDefects = can('defects.report', true);
  const canOperateCheckout = activeRole === 'Admin' || activeRole === 'Mitarbeiter' || activeRole === 'Projektmanager';
  // QR-Code-Verwaltung: rechte-gesteuert über qrcode.manage. Liegen effektive
  // Rechte vor, entscheiden sie (Menü in App.tsx filtert identisch). Fallback
  // auf die bisherige Rollenlogik (Admin/Mitarbeiter), falls ein älteres
  // Backend keine Rechte liefert. So wird die Seite auch bei direktem
  // URL-Aufruf ohne Berechtigung geblockt.
  const canUseQrFunctions = can(
    'qrcode.manage',
    activeRole === 'Admin' || activeRole === 'Mitarbeiter',
  );
  // Einsatzplanung bearbeiten (Positionen anlegen/löschen/ändern): planning.update.
  // Fallback auf die bisherige Rollenlogik, falls keine Rechte vorliegen.
  const canEditPlanning = can('planning.update', activeRole === 'Admin' || activeRole === 'Projektmanager');

  switch (activePage) {
    case 'dashboard':
      if (isMobile) {
        return <MobileDashboardPage onNavigate={onNavigate} onOpenCheckinCheckout={onOpenCheckinCheckout} />;
      }
      return (
        <DashboardPage
          assets={assets}
          activities={activities}
          reservations={reservations}
          maintenanceItems={maintenanceItems}
          planningSummary={planningSummary}
          theme={theme}
          permissions={permissions}
          activeRole={activeRole}
          onNavigate={onNavigate}
          onOpenInventoryWithStatus={onOpenInventoryWithStatus}
          isInitialLoading={isInitialLoading}
        />
      );
    case 'externalPool':
      // Fremdbestand: Admin/Techniker (über AppRole 'Admin' gemappt) UND
      // Projektmanager — fachlich Teil der Projektplanung. Mitarbeiter/Junior
      // sehen die Seite nicht und können sie auch per direktem URL-Aufruf
      // nicht öffnen.
      if (activeRole !== 'Admin' && activeRole !== 'Projektmanager') {
        return (
          <div className="surface-card p-6 text-sm text-slate-600">
            Fremdbestand-Verwaltung nur für Admin / Techniker / Projektmanager.
          </div>
        );
      }
      return (
        <ExternalPoolPage
          assets={assets}
          categories={categories}
          isMobile={isMobile}
          onReloadData={onReloadData}
        />
      );
    case 'inventory':
      return (
        <AssetsPage
          assets={assets}
          categories={categories}
          isMobile={isMobile}
          isInitialLoading={isInitialLoading}
          onNavigate={onNavigate}
          onOpenDetail={onOpenAssetDetail}
          initialSearch={search}
          initialStatus={inventoryStatusFilter ?? undefined}
          onInitialStatusConsumed={onConsumeInventoryStatusFilter}
          onCreateAsset={() => {
            void onCreateAsset();
          }}
          onCreateAssetFromInput={(payload) => onCreateAssetFromInput(payload)}
          onReserveAsset={(id) => {
            void onReserveAsset(id);
          }}
          onCheckoutAsset={(id) => {
            void onCheckoutAsset(id);
          }}
          onCheckinAsset={(id) => {
            void onCheckinAsset(id);
          }}
          onAdminUpdateAsset={(id, patch) => {
            void onAdminUpdateAsset(id, patch);
          }}
          onAdminDeleteAsset={async (id) => {
            await onAdminDeleteAsset(id);
          }}
          onCreateMaintenance={(payload) => {
            void onCreateMaintenance(payload);
          }}
          canManageAssets={canUpdateAssets}
        />
      );
    case 'assetDetail':
      return (
        <AssetDetailPage
          activeRole={activeRole}
          canEditAsset={canUpdateAssets}
          canManageDefects={canManageDefects}
          canReportDefects={canReportDefects}
          asset={selectedAsset}
          activities={activities}
          maintenanceItems={maintenanceItems}
          onReserveAsset={(id) => {
            void onReserveAsset(id);
          }}
          onCheckoutAsset={(id) => {
            void onCheckoutAsset(id);
          }}
          onCheckinAsset={(id) => {
            void onCheckinAsset(id);
          }}
          onSetMaintenance={(id) => {
            void onSetAssetMaintenance(id);
          }}
          onEditAsset={(id) => {
            void onEditAsset(id);
          }}
          onCreateMaintenance={(payload) => {
            void onCreateMaintenance(payload);
          }}
          onUpdateMaintenanceStatus={(id, status) => {
            void onUpdateMaintenanceStatus(id, status);
          }}
          onOpenInventoryWithQuery={onOpenInventoryWithQuery}
        />
      );
    case 'categories':
      return (
        <CategoriesPage
          assets={assets}
          categories={categories}
          // Anlegen UND Löschen sind beide erlaubt für Admin/Techniker
          // (intern als 'Admin' gemappt) sowie Projektmanager.
          // Mitarbeiter/Junior bleiben ausgeschlossen.
          canManageCategories={activeRole === 'Admin' || activeRole === 'Projektmanager'}
          canDeleteCategories={activeRole === 'Admin' || activeRole === 'Projektmanager'}
          onCreateCategory={onCreateCategory}
          onDeleteCategory={onDeleteCategory}
        />
      );
    case 'planning':
      return (
        <PlanningPage
          assets={assets}
          categories={categories}
          users={users}
          planningSummary={planningSummary}
          onRefreshOverview={onReloadData}
          onOpenInventoryWithQuery={onOpenInventoryWithQuery}
          canEdit={canEditPlanning}
          isMobile={isMobile}
        />
      );
    case 'checkinCheckout':
      if (!canOperateCheckout) {
        return <div className="surface-card p-6 text-sm text-slate-600">Keine Berechtigung für Ein-/Auslagerung.</div>;
      }
      return (
        <CheckinCheckoutPage
          assets={assets}
          users={users}
          isMobile={isMobile}
          initialMode={checkinCheckoutMode ?? undefined}
          onInitialModeConsumed={onConsumeCheckinCheckoutMode}
          activeRole={activeRole}
          operatorName={currentUserName}
          projectContext={projectContext}
          onProjectContextChange={onProjectContextChange}
          onCheckout={(payload) => onCheckoutFromForm(payload)}
          onCheckin={(payload) => onCheckinFromForm(payload)}
          onReloadData={onReloadData}
        />
      );
    case 'qrFunctions':
      if (!canUseQrFunctions) {
        return <div className="surface-card p-6 text-sm text-slate-600">Keine Berechtigung für QR-Buchungen.</div>;
      }
      return (
        <QrFunctionsPage
          assets={assets}
          onOpenAssetDetail={onOpenAssetDetail}
          onCheckoutAsset={(id) => {
            void onCheckoutAsset(id);
          }}
          onCheckinAsset={(id) => {
            void onCheckinAsset(id);
          }}
          onReportIssue={(assetName) => {
            void onCreateMaintenance({
              assetName,
              issue: "Per QR gemeldeter Defekt",
              comment: "",
            });
          }}
        />
      );
    case 'massPrint':
      if (!isAdmin) {
        return <div className="surface-card p-6 text-sm text-slate-600">Massendruck nur für Admin / Techniker.</div>;
      }
      return <MassPrintPage assets={assets} />;
    case 'labelAudit':
      if (!isAdmin) {
        return <div className="surface-card p-6 text-sm text-slate-600">Label-Prüfung nur für Admin / Techniker.</div>;
      }
      return <LabelAuditPage assets={assets} />;
    case 'tickets':
      return (
        <MaintenancePage
          activeRole={activeRole}
          canManageDefects={canManageDefects}
          maintenanceItems={maintenanceItems}
          assets={assets}
          onOpenAssetDetail={onOpenAssetDetail}
          onOpenInventoryWithQuery={onOpenInventoryWithQuery}
          onCreateMaintenance={(payload) => {
            void onCreateMaintenance(payload);
          }}
          onUpdateStatus={(id, status) => {
            void onUpdateMaintenanceStatus(id, status);
          }}
        />
      );
    case 'importExport':
      if (!isAdmin) {
        return <div className="surface-card p-6 text-sm text-slate-600">Import/Export nur für Admin / Techniker.</div>;
      }
      return (
        <ImportExportPage
          assets={assets}
          onImported={async () => {
            await onReloadData();
          }}
        />
      );
    case 'backup':
      if (!isAdmin) {
        return <div className="surface-card p-6 text-sm text-slate-600">Backup nur für Admin / Techniker.</div>;
      }
      return <BackupPage onRestored={onReloadData} />;
    case 'updateNotes':
      if (!isAdmin) {
        return <div className="surface-card p-6 text-sm text-slate-600">Update-Notizen nur für Admin / Techniker.</div>;
      }
      return <UpdateNotesAdminPage />;
    case 'rolesPermissions':
      if (!isAdmin) {
        return <div className="surface-card p-6 text-sm text-slate-600">Rollen &amp; Rechte nur für Admin / Techniker.</div>;
      }
      return <RolesPermissionsPage />;
    case 'telecomPass':
      if (!isAdmin) {
        return <div className="surface-card p-6 text-sm text-slate-600">Telekompass-Einstellungen nur für Admin / Techniker.</div>;
      }
      return <TelecomPassSettingsPage />;
    case 'users':
      if (!isAdmin) {
        return <div className="surface-card p-6 text-sm text-slate-600">Benutzerverwaltung nur für Admin / Techniker.</div>;
      }
      return (
        <UsersPage
          users={users}
          currentUserId={currentUserId}
          assets={assets}
          activities={activities}
          onOpenInventoryWithQuery={onOpenInventoryWithQuery}
          onInviteUser={(payload) => onInviteUser(payload)}
          onEditUser={(payload) => onEditUser(payload)}
          onResetUserPassword={(userId, payload) => onResetUserPassword(userId, payload)}
          onDeleteUser={(id) => onDeleteUser(id)}
          onBulkDeleteUsers={(ids) => onBulkDeleteUsers(ids)}
        />
      );
    default:
      return null;
  }
}
