"""Schweregrad-Klassifikation fuer Planungskonflikte.

Reines Domain-Modul (kein DB-/IO-Zugriff). Es entscheidet NICHT, ob etwas ein
Konflikt ist — das bleibt in ``repositories/planning_repository.py``. Es bildet
nur eine bereits ermittelte Konfliktzelle (bzw. Kontextzeile) auf einen
Schweregrad ab.

Sowohl der Listen-/Batch-Pfad (``get_open_conflict_summaries_for_plannings``)
als auch der Detailpfad (``get_planning_availability``) rufen ausschliesslich
``classify_conflict_cell`` auf. Dadurch koennen die beiden Pfade in der
Severity-Aussage nicht auseinanderlaufen.

Wichtig: Freitext-Uebergabe-Notizen werden hier bewusst NICHT ausgewertet — die
Klassifikation kennt nur die strukturierten Felder ``handover_status`` /
``handover_enabled``.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Literal, NamedTuple, Optional

# Schweregrade in fachlicher Reihenfolge "Ursache zuerst". Die Reihenfolge der
# Literale ist zugleich die Primaer-Praezedenz (siehe classify_conflict_cell).
#
# Wichtig: Diese Strings gehen unveraendert ins Frontend. Der dortige
# Response-Normalizer (wmsApi.ts) ersetzt u. a. den Teilstring "ueber" durch
# "über" — Severity-Keys duerfen daher KEINE solchen Teilstrings enthalten
# (deshalb "handover_review" statt "uebergabe_pruefen").
ConflictSeverity = Literal[
    "kompatible_laptops_fehlen",
    "teilweise_geloest",
    "handover_review",
    "nicht_planbare_ausgeschlossen",
    "echter_engpass",
    "hinweis",
]

# Konfliktgrund — 1:1 zur ausgeloesten Severity-Regel.
ConflictReason = Literal[
    "compat_laptops_missing",
    "handover_partial",
    "handover_review",
    "non_plannable_excluded",
    "real_shortage",
    "context",
]

# Strukturierter Uebergabe-Status (identisch zu PlanningAvailabilityItem).
HandoverStatus = Literal["none", "planned", "missing_link", "organizational"]

# Severity -> deutsches Label. Eine Wortquelle; das Backend liefert die Strings
# in der Response, das Frontend nutzt sie direkt (mit eigenem Fallback).
CONFLICT_LABELS: dict[str, str] = {
    "kompatible_laptops_fehlen": "Kompatible Laptops fehlen",
    "teilweise_geloest": "Teilweise gelöst",
    "handover_review": "Übergabe prüfen",
    "nicht_planbare_ausgeschlossen": "Nicht planbare Geräte ausgeschlossen",
    "echter_engpass": "Echter Engpass",
    "hinweis": "Hinweis",
}

# Severity -> Konfliktgrund.
_SEVERITY_REASON: dict[str, str] = {
    "kompatible_laptops_fehlen": "compat_laptops_missing",
    "teilweise_geloest": "handover_partial",
    "handover_review": "handover_review",
    "nicht_planbare_ausgeschlossen": "non_plannable_excluded",
    "echter_engpass": "real_shortage",
    "hinweis": "context",
}


class ConflictCellFacts(NamedTuple):
    """Pro-Zelle-Fakten, aus denen die Severity abgeleitet wird.

    Alle Werte sind in beiden Repository-Pfaden bereits vorhanden. ``conflict_day``
    ist rein informativ (Durchreichen in die Response) und beeinflusst die
    Klassifikation nicht.
    """

    category_key: str
    conflict_day: date
    # Restfehlmenge NACH Uebergabe-Verrechnung (== shortage_after_handover_qty).
    # > 0 => gezaehlte Konfliktzelle; <= 0 => reine Kontextzeile.
    unresolved_shortage_qty: int
    handover_covered_qty: int
    handover_status: str
    handover_enabled: bool
    excluded_qty: int
    excluded_from_planning_qty: int
    card_printer_required_qty: int
    card_printer_uplift_qty: int


@dataclass(frozen=True)
class ConflictBadge:
    """Ein einzelnes Severity-Badge (Primaer oder Sekundaer)."""

    severity: str
    reason: str
    label: str


@dataclass(frozen=True)
class ConflictClassification:
    """Ergebnis der Klassifikation: ein Primaer-Badge + Sekundaer-Badges."""

    severity: str
    reason: str
    label: str
    secondary: tuple[ConflictBadge, ...]


def _badge(severity: str) -> ConflictBadge:
    return ConflictBadge(
        severity=severity,
        reason=_SEVERITY_REASON[severity],
        label=CONFLICT_LABELS[severity],
    )


def classify_conflict_cell(facts: ConflictCellFacts) -> Optional[ConflictClassification]:
    """Klassifiziert eine Konflikt- bzw. Kontextzelle.

    Liefert ``None``, wenn die Zelle weder eine gezaehlte Fehlmenge noch einen
    erklaerungswuerdigen Kontext (ausgeschlossene Geraete / Kartendrucker-Uplift)
    hat — also eine voellig unauffaellige Zelle.

    Primaer-Praezedenz fuer gezaehlte Konflikte (erste passende Regel gewinnt,
    alle weiteren passenden werden zu Sekundaer-Badges; ``echter_engpass`` ist
    nur der Default-Primaer und nie ein Sekundaer-Badge):

      1. ``kompatible_laptops_fehlen`` — Laptop-Zeile mit ``excluded_qty > 0``
      2. ``teilweise_geloest`` — eine Uebergabe deckt einen Teil (covered > 0)
      3. ``handover_review`` — Uebergabe dokumentiert, aber nicht verrechnet
      4. ``nicht_planbare_ausgeschlossen`` — global gesperrte Geraete vorhanden
      5. ``echter_engpass`` — echte Restfehlmenge ohne erklaerende Ursache

    Kontextzeilen ohne harte Fehlmenge erhalten ``nicht_planbare_ausgeschlossen``
    bzw. ``hinweis`` — diese zaehlen nie in ``openConflictCount``.
    """
    matched: list[str] = []
    is_counted_conflict = facts.unresolved_shortage_qty > 0

    if is_counted_conflict:
        if facts.category_key == "Laptop" and facts.excluded_qty > 0:
            matched.append("kompatible_laptops_fehlen")
        if facts.handover_covered_qty > 0:
            matched.append("teilweise_geloest")
        elif facts.handover_enabled or facts.handover_status in ("planned", "organizational"):
            matched.append("handover_review")
        if facts.excluded_from_planning_qty > 0:
            matched.append("nicht_planbare_ausgeschlossen")
        # Default-Primaer: jede gezaehlte Konfliktzelle ist eine echte Fehlmenge.
        matched.append("echter_engpass")
    else:
        # Reine Kontextzeile (keine gezaehlte Fehlmenge).
        if facts.excluded_from_planning_qty > 0:
            matched.append("nicht_planbare_ausgeschlossen")
        if facts.card_printer_uplift_qty > 0:
            matched.append("hinweis")
        if not matched:
            return None

    primary = matched[0]
    # "echter_engpass" ist nur Default-Primaer — als Sekundaer-Badge waere es
    # redundant (jede gezaehlte Zelle ist eine Fehlmenge).
    secondary = tuple(
        _badge(severity) for severity in matched[1:] if severity != "echter_engpass"
    )
    return ConflictClassification(
        severity=primary,
        reason=_SEVERITY_REASON[primary],
        label=CONFLICT_LABELS[primary],
        secondary=secondary,
    )
