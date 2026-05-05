import { useEffect, useState } from 'react';

function detectIsMobile(): boolean {
  if (typeof window === 'undefined') return false;
  const narrowViewport = window.innerWidth < 768;
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  return narrowViewport || coarsePointer;
}

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(detectIsMobile);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia('(pointer: coarse)');
    const update = () => setIsMobile(detectIsMobile());
    update();
    window.addEventListener('resize', update);
    media.addEventListener('change', update);
    return () => {
      window.removeEventListener('resize', update);
      media.removeEventListener('change', update);
    };
  }, []);

  return isMobile;
}

