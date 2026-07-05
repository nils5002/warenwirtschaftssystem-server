import { useEffect, useState } from 'react';
import { AssetVisual } from './AssetVisual';
import type { Asset } from '../types';

type AssetImageProps = {
  asset: Asset;
  categoryImageUrl?: string | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
};

const sizeMap: Record<NonNullable<AssetImageProps['size']>, string> = {
  sm: 'h-14 w-14 rounded-2xl',
  md: 'h-16 w-16 rounded-[20px]',
  lg: 'h-48 w-48 rounded-[28px]',
  xl: 'h-56 w-56 rounded-[32px]',
};

export function AssetImage({
  asset,
  categoryImageUrl,
  size = 'md',
  className = '',
}: AssetImageProps) {
  const [failedSources, setFailedSources] = useState<string[]>([]);
  const imageSources = [(asset.productImageUrl || '').trim(), (categoryImageUrl || '').trim()].filter(Boolean);
  const imageUrl = imageSources.find((url) => !failedSources.includes(url)) || '';

  useEffect(() => {
    setFailedSources([]);
  }, [asset.productImageUrl, categoryImageUrl]);

  if (!imageUrl) {
    return <AssetVisual category={asset.category} name={asset.name} size={size} />;
  }

  return (
    <img
      src={imageUrl}
      alt={asset.name}
      loading="lazy"
      onError={() =>
        setFailedSources((current) => (current.includes(imageUrl) ? current : [...current, imageUrl]))
      }
      className={`block shrink-0 border border-white/10 bg-gradient-to-br from-slate-50 via-slate-100 to-slate-200 object-contain p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] ${sizeMap[size]} ${className}`.trim()}
    />
  );
}
