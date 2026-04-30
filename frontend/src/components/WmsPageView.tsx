import { AssetDetailPage } from '../asset-ui/pages/AssetDetailPage';
import { AssetsPage } from '../asset-ui/pages/AssetsPage';
import { BackupPage } from '../asset-ui/pages/BackupPage';
import { CategoriesPage } from '../asset-ui/pages/CategoriesPage';
import { CheckinCheckoutPage } from '../asset-ui/pages/CheckinCheckoutPage';
import { DashboardPage } from '../asset-ui/pages/DashboardPage';
import { ImportExportPage } from '../asset-ui/pages/ImportExportPage';
import { MaintenancePage } from '../asset-ui/pages/MaintenancePage';
import { PlanningPage } from '../asset-ui/pages/PlanningPage';
import { QrFunctionsPage } from '../asset-ui/pages/QrFunctionsPage';
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

type WmsPageViewProps = {
  activePage: AppPage;
  activeRole: AppRole;
  currentUserId: string;
  currentUserName: string;
  projectContext: string;
  onProjectContextChange: (value: string) => void;
  assets: Asset[];
  activities: ActivityItem[];
  reservations: ReservationItem[];
  maintenanceItems: MaintenanceItem[];
  locations: LocationItem[];
  users: UserItem[];
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
};

export function WmsPageView({
  activePage,
  activeRole,
  currentUserId,
  currentUserName,
  projectContext,
  onProjectContextChange,
  assets,
  activities,
  reservations,
  maintenanceItems,
  locations,
  users,
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
  onReloadData,
  onCheckoutFromForm,
  onCheckinFromForm,
  onNavigate,
  onOpenInventoryWithQuery,
}: WmsPageViewProps) {
  const isAdmin = activeRole === 'Admin';
  const canOperateCheckout = activeRole === 'Admin' || activeRole === 'Mitarbeiter';
  const canEditPlanning = activeRole === 'Admin' || activeRole === 'Projektmanager';

  switch (activePage) {
    case 'dashboard':
      return (
        <DashboardPage
          assets={assets}
          activities={activities}
          reservations={reservations}
          maintenanceItems={maintenanceItems}
          onNavigate={onNavigate}
        />
      );
    case 'inventory':
      return (
        <AssetsPage
          assets={assets}
          onNavigate={onNavigate}
          onOpenDetail={onOpenAssetDetail}
          initialSearch={search}
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
          onAdminDeleteAsset={(id) => {
            void onAdminDeleteAsset(id);
          }}
          onCreateMaintenance={(payload) => {
            void onCreateMaintenance(payload);
          }}
          canManageAssets={isAdmin}
        />
      );
    case 'assetDetail':
      return (
        <AssetDetailPage
          activeRole={activeRole}
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
          canManageCategories={isAdmin}
          onCreateCategory={onCreateCategory}
        />
      );
    case 'planning':
      return (
        <PlanningPage
          assets={assets}
          categories={categories}
          users={users}
          onOpenInventoryWithQuery={onOpenInventoryWithQuery}
          canEdit={canEditPlanning}
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
          activeRole={activeRole}
          operatorName={currentUserName}
          projectContext={projectContext}
          onProjectContextChange={onProjectContextChange}
          onCheckout={(payload) => {
            void onCheckoutFromForm(payload);
          }}
          onCheckin={(payload) => {
            void onCheckinFromForm(payload);
          }}
        />
      );
    case 'qrFunctions':
      if (!canOperateCheckout) {
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
    case 'tickets':
      return (
        <MaintenancePage
          activeRole={activeRole}
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
