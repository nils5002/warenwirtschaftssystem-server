// Kleines Initialen-Badge in der Signaturfarbe des Verantwortlichen —
// genutzt in Kalender-Zeitleiste, Planungsliste und Benutzerverwaltung.
// Dezente Tint-Fläche (Hex + Alpha-Suffix) statt Vollfarbe, damit die
// Lesbarkeit in Dark und Light erhalten bleibt.

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
  const dimension = size === 'sm' ? 'h-6 w-6 text-[11px]' : 'h-5 w-5 text-[9px]';
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full border font-semibold leading-none ${dimension} ${className}`.trim()}
      style={{
        backgroundColor: `${user.signatureColor}26`,
        borderColor: `${user.signatureColor}66`,
        color: user.signatureColor,
      }}
      title={`Verantwortlich: ${user.name}`}
      aria-label={`Verantwortlich: ${user.name}`}
    >
      {user.initials}
    </span>
  );
}
