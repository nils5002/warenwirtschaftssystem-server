import { resolveSignatureVisual } from '../userColors';
import type { CSSProperties } from 'react';

// Kleines Initialen-Badge in der Signaturfarbe des Verantwortlichen —
// genutzt in Kalender-Zeitleiste, Planungsliste und Benutzerverwaltung.
// Dezente Tint-Fläche statt Vollfarbe; die Textfarbe wechselt im Dark Mode
// auf die hellere Paletten-Variante (siehe .sig-badge in index.css).

export type ResponsibleUserInfo = {
  name: string;
  initials: string;
  signatureColor: string;
};

type ResponsibleBadgeProps = {
  user: ResponsibleUserInfo | null | undefined;
  size?: 'xs' | 'sm';
  className?: string;
};

export function ResponsibleBadge({ user, size = 'xs', className = '' }: ResponsibleBadgeProps) {
  if (!user) return null;
  const visual = resolveSignatureVisual(user.signatureColor);
  const dimension = size === 'sm' ? 'h-6 w-6 text-[11px]' : 'h-5 w-5 text-[9px]';
  const style = {
    '--sig-bg': visual.bg,
    '--sig-border': `${visual.border}66`,
    '--sig-text': visual.text,
    '--sig-text-dark': visual.textDark,
  } as CSSProperties;
  return (
    <span
      className={`sig-badge inline-flex shrink-0 items-center justify-center rounded-full border font-semibold leading-none ${dimension} ${className}`.trim()}
      style={style}
      title={`Verantwortlich: ${user.name}`}
      aria-label={`Verantwortlich: ${user.name}`}
    >
      {user.initials}
    </span>
  );
}
