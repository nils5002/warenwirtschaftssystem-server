from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

# Zustand einer Übergabe je Kategorie:
# - not_applicable: keine gültige Übergabe (kein Partner / B nicht nach A / keine Geräte)
# - planned:        gültig konfiguriert, aber Übergabezeitpunkt noch nicht erreicht
# - due:            jetzt fällig, noch nicht (vollständig) ausgeführt
# - partially_executed: ein Teil ist automatisch übergeben
# - executed:       vollständig an B übergeben
HandoverCategoryState = Literal[
    "not_applicable", "planned", "due", "partially_executed", "executed"
]


class HandoverCategoryStatus(BaseModel):
    categoryKey: str
    targetPlanningId: str | None = None
    targetPlanningLabel: str | None = None
    issuedQty: int = 0          # aktuell für A ausgegebene Geräte dieser Kategorie
    configuredQty: int = 0      # geplante Übergabemenge (Item-qty)
    targetDemand: int = 0       # Bedarf von B (Tages-Spitze)
    plannedTotal: int = 0       # min(configuredQty, targetDemand)
    alreadyTransferredQty: int = 0
    transferableQty: int = 0    # jetzt übertragbar (offen)
    state: HandoverCategoryState = "not_applicable"
    transferAssetIds: list[str] = Field(default_factory=list)


class HandoverStatusResponse(BaseModel):
    planningId: str
    sourceReturnDay: date       # A_end_exclusive (= _period_end_exclusive(A.start, A.end))
    dueNow: bool                # today >= sourceReturnDay
    autoEligible: bool          # mindestens eine strukturell gültige Übergabe vorhanden
    totalTransferable: int = 0
    totalAlreadyTransferred: int = 0
    categories: list[HandoverCategoryStatus] = Field(default_factory=list)


class HandoverTransferredAsset(BaseModel):
    assetId: str
    name: str
    category: str
    targetPlanningId: str


class HandoverRunResponse(BaseModel):
    planningId: str
    batchId: str | None = None
    transferredCount: int = 0
    transferred: list[HandoverTransferredAsset] = Field(default_factory=list)
    skippedCount: int = 0


class HandoverUndoResponse(BaseModel):
    planningId: str
    revertedCount: int = 0
    skippedCount: int = 0
