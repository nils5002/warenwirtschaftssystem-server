import { AlertCircle, GripVertical, Wrench } from 'lucide-react';
import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { useAppDialog } from '../../components/dialogs/AppDialogProvider';
import { StatusBadge } from '../components/StatusBadge';
import type { AppRole, Asset, MaintenanceItem } from '../types';

type MaintenancePageProps = {
  activeRole: AppRole;
  maintenanceItems: MaintenanceItem[];
  assets: Asset[];
  onOpenAssetDetail: (assetId: string) => void;
  onOpenInventoryWithQuery: (query: string) => void;
  onCreateMaintenance: (payload: { assetName: string; issue: string; comment: string }) => void;
  onUpdateStatus: (id: string, status: MaintenanceItem['status']) => void;
};

type BoardStatus = 'Offen' | 'In Bearbeitung' | 'Erledigt';

type StatusColumn = {
  title: BoardStatus;
  tone: string;
};

const columns: StatusColumn[] = [
  { title: 'Offen', tone: 'border-rose-200 bg-rose-50/75' },
  { title: 'In Bearbeitung', tone: 'border-amber-200 bg-amber-50/75' },
  { title: 'Erledigt', tone: 'border-emerald-200 bg-emerald-50/75' },
];

const defectPresets = ['Displaybruch', 'Display beschädigt', 'Gerät defekt', 'Gerät startet nicht', 'Akku defekt', 'Sonstiger Defekt'];

const nextStatusMap: Partial<Record<BoardStatus, BoardStatus>> = {
  Offen: 'In Bearbeitung',
  'In Bearbeitung': 'Erledigt',
};

function canMoveBoardStatus(from: BoardStatus, to: BoardStatus): boolean {
  if (from === to) return true;
  if (from === 'Offen' && to === 'In Bearbeitung') return true;
  if (from === 'In Bearbeitung' && to === 'Erledigt') return true;
  return false;
}

export function MaintenancePage({
  activeRole,
  maintenanceItems,
  assets,
  onOpenAssetDetail,
  onOpenInventoryWithQuery,
  onCreateMaintenance,
  onUpdateStatus,
}: MaintenancePageProps) {
  const { alert, confirm } = useAppDialog();
  const [formError, setFormError] = useState<string | null>(null);
  const [assetName, setAssetName] = useState('');
  const [issue, setIssue] = useState('');
  const [comment, setComment] = useState('');
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<BoardStatus | null>(null);
  const [boardHint, setBoardHint] = useState<string | null>(null);
  const [touchLike, setTouchLike] = useState(false);

  const isAdmin = activeRole === 'Admin';

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const isTouch = window.matchMedia('(hover: none), (pointer: coarse)').matches;
    setTouchLike(isTouch);
  }, []);

  const grouped = useMemo(
    () =>
      columns.map((column) => ({
        ...column,
        items:
          column.title === 'Erledigt'
            ? []
            : maintenanceItems
                .filter((item) => item.status === column.title)
                .sort((a, b) => (a.reportedAt < b.reportedAt ? 1 : -1)),
      })),
    [maintenanceItems],
  );

  const completedHistory = useMemo(
    () =>
      maintenanceItems
        .filter((item) => item.status === 'Erledigt')
        .sort((a, b) => (a.reportedAt < b.reportedAt ? 1 : -1))
        .slice(0, 20),
    [maintenanceItems],
  );

  const itemById = useMemo(() => new Map(maintenanceItems.map((item) => [item.id, item])), [maintenanceItems]);

  const submitDefect = async () => {
    if (!assetName.trim() || !issue.trim()) {
      setFormError('Bitte Gerät und kurze Defektbeschreibung ausfüllen.');
      return;
    }

    setFormError(null);
    onCreateMaintenance({
      assetName: assetName.trim(),
      issue: issue.trim(),
      comment: comment.trim(),
    });

    setAssetName('');
    setIssue('');
    setComment('');

    await alert({
      title: 'Defekt gemeldet',
      message: 'Die Karte erscheint in der Spalte "Offen".',
    });
  };

  const moveItem = async (item: MaintenanceItem, targetStatus: BoardStatus) => {
    if (!isAdmin || item.status === targetStatus) return;
    if (!canMoveBoardStatus(item.status as BoardStatus, targetStatus)) {
      await alert({
        title: 'Nicht erlaubt',
        message: 'Bitte zuerst nach „In Bearbeitung“ verschieben.',
      });
      return;
    }

    if (targetStatus === 'Erledigt') {
      const accepted = await confirm({
        title: 'Als erledigt markieren?',
        message: `${item.assetName}: "${item.issue}" wird auf erledigt gesetzt.`,
        confirmLabel: 'Erledigt',
        cancelLabel: 'Abbrechen',
      });
      if (!accepted) return;
    }

    onUpdateStatus(item.id, targetStatus);
    setBoardHint(`${item.assetName}: ${item.status} → ${targetStatus}`);
  };

  const onDragStartCard = (event: DragEvent<HTMLElement>, itemId: string) => {
    if (!isAdmin) return;
    event.dataTransfer.setData('text/plain', itemId);
    event.dataTransfer.effectAllowed = 'move';
    setDraggedId(itemId);
  };

  const onDragOverColumn = (event: DragEvent<HTMLElement>, status: BoardStatus) => {
    if (!isAdmin) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDragOverStatus(status);
  };

  const onDropColumn = (event: DragEvent<HTMLElement>, status: BoardStatus) => {
    if (!isAdmin) return;
    event.preventDefault();
    const fromTransfer = event.dataTransfer.getData('text/plain');
    const sourceId = fromTransfer || draggedId;
    setDraggedId(null);
    setDragOverStatus(null);
    if (!sourceId) return;
    const sourceItem = itemById.get(sourceId);
    if (!sourceItem) return;
    void moveItem(sourceItem, status);
  };

  const onDragEndCard = () => {
    setDraggedId(null);
    setDragOverStatus(null);
  };

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="page-kicker">Defekte & Wartung</p>
          <h2 className="page-title">Reparatur-Board</h2>
          <p className="page-subtitle">Offen → In Bearbeitung → Erledigt</p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <article className="surface-card animate-fade-up xl:col-span-4">
          <h3 className="inline-flex items-center gap-2 text-base font-semibold text-slate-900">
            <AlertCircle className="h-4 w-4" />
            Defekt melden
          </h3>

          {formError ? (
            <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {formError}
            </div>
          ) : null}

          <div className="mt-4 space-y-3">
            <label className="field">
              Gerät
              <input
                list="maintenance-asset-options"
                className="field-input"
                placeholder="Asset-Name"
                value={assetName}
                onChange={(event) => setAssetName(event.target.value)}
              />
              <datalist id="maintenance-asset-options">
                {assets.map((asset) => (
                  <option key={asset.id} value={asset.name} />
                ))}
              </datalist>
            </label>

            <label className="field">
              Defektbeschreibung
              <input
                className="field-input"
                placeholder="z. B. Displaybruch"
                value={issue}
                onChange={(event) => setIssue(event.target.value)}
              />
            </label>

            <div className="flex flex-wrap gap-1.5">
              {defectPresets.map((preset) => (
                <button key={preset} type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => setIssue(preset)}>
                  {preset}
                </button>
              ))}
            </div>

            <label className="field">
              Notiz (optional)
              <textarea
                className="field-input min-h-[84px]"
                placeholder="Kurzinfo"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
              />
            </label>

            <button className="btn-primary w-full" onClick={() => void submitDefect()}>
              Als Offen speichern
            </button>
          </div>
        </article>

        <article className="surface-card animate-fade-up xl:col-span-8">
          <h3 className="inline-flex items-center gap-2 text-base font-semibold text-slate-900">
            <Wrench className="h-4 w-4" />
            Board
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            {isAdmin
              ? 'Karte ziehen und in die nächste Spalte fallen lassen.'
              : 'Statusübersicht der gemeldeten Defekte.'}
          </p>
          {boardHint ? <p className="mt-1 text-xs text-emerald-700">{boardHint}</p> : null}

          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            {grouped.map((column) => (
              <section
                key={column.title}
                className={`rounded-2xl border p-3 transition ${column.tone} ${dragOverStatus === column.title ? 'ring-2 ring-brand-300' : ''}`}
                onDragOver={(event) => onDragOverColumn(event, column.title)}
                onDrop={(event) => onDropColumn(event, column.title)}
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  {column.title} ({column.title === 'Erledigt' ? 'Abschluss' : column.items.length})
                </p>

                <div className="mt-2 space-y-2 min-h-[120px]">
                  {column.items.length ? (
                    column.items.map((item) => {
                      const linkedAsset = assets.find((asset) => asset.name === item.assetName);
                      const nextStatus = nextStatusMap[item.status as BoardStatus];

                      return (
                        <article
                          key={item.id}
                          draggable={isAdmin}
                          onDragStart={(event) => onDragStartCard(event, item.id)}
                          onDragEnd={onDragEndCard}
                          className={`rounded-xl border border-slate-200 bg-white p-3 ${isAdmin ? 'cursor-grab active:cursor-grabbing' : ''} ${draggedId === item.id ? 'opacity-60' : ''}`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-sm font-semibold text-slate-900">{item.assetName}</p>
                              <p className="mt-1 text-sm text-slate-700">{item.issue}</p>
                              <p className="mt-1 text-xs text-slate-500">{item.reportedAt}</p>
                            </div>
                            {isAdmin ? <GripVertical className="h-4 w-4 text-slate-400" /> : <StatusBadge value={item.status} />}
                          </div>

                          <div className="mt-2 flex items-center justify-between gap-2">
                            <button
                              type="button"
                              className="btn-ghost px-2 py-1 text-xs"
                              onClick={() => {
                                if (linkedAsset) {
                                  onOpenAssetDetail(linkedAsset.id);
                                  return;
                                }
                                onOpenInventoryWithQuery(item.assetName);
                              }}
                            >
                              Asset
                            </button>

                            {isAdmin && touchLike && nextStatus ? (
                              <button
                                type="button"
                                className="btn-secondary px-2 py-1 text-xs"
                                onClick={() => {
                                  void moveItem(item, nextStatus);
                                }}
                              >
                                Weiter → {nextStatus}
                              </button>
                            ) : null}
                          </div>
                        </article>
                      );
                    })
                  ) : (
                    <div className="rounded-xl border border-dashed border-slate-300 bg-white px-3 py-6 text-center text-xs text-slate-500">
                      {column.title === 'Erledigt' ? 'Hier ablegen zum Abschließen' : 'Leer'}
                    </div>
                  )}
                </div>
              </section>
            ))}
          </div>
        </article>
      </div>

      <article className="surface-card animate-fade-up">
        <h3 className="text-sm font-semibold text-slate-900">Abgeschlossene Historie (nicht aktiv)</h3>
        <p className="mt-1 text-xs text-slate-500">
          Erledigte Fälle werden nach Abschluss aus dem Board entfernt und nur hier dokumentiert.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {completedHistory.length ? (
            completedHistory.map((item) => {
              const linkedAsset = assets.find((asset) => asset.name === item.assetName);
              return (
                <article key={item.id} className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-900">{item.assetName}</p>
                    <StatusBadge value={item.status} />
                  </div>
                  <p className="mt-1 text-sm text-slate-700">{item.issue}</p>
                  <p className="mt-1 text-xs text-slate-500">{item.reportedAt}</p>
                  <button
                    type="button"
                    className="btn-ghost mt-2 px-2 py-1 text-xs"
                    onClick={() => {
                      if (linkedAsset) {
                        onOpenAssetDetail(linkedAsset.id);
                        return;
                      }
                      onOpenInventoryWithQuery(item.assetName);
                    }}
                  >
                    Asset
                  </button>
                </article>
              );
            })
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-center text-sm text-slate-500 sm:col-span-2 xl:col-span-3">
              Noch keine abgeschlossenen Fälle.
            </div>
          )}
        </div>
      </article>
    </section>
  );
}
