import { useEffect, useState } from 'react';
import { AssetVisual } from './AssetVisual';
import type { Asset } from '../types';

type AssetImageProps = {
  asset: Asset;
  categoryImageUrl?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
};

const sizeMap: Record<NonNullable<AssetImageProps['size']>, string> = {
  sm: 'h-10 w-10 rounded-xl',
  md: 'h-12 w-12 rounded-2xl',
  lg: 'h-28 w-28 rounded-2xl',
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
    if (size === 'lg') {
      return (
        <div className={`flex shrink-0 items-center justify-center border border-line bg-surface-2 ${sizeMap[size]} ${className}`.trim()}>
          <AssetVisual category={asset.category} name={asset.name} size="lg" />
        </div>
      );
    }
    return <AssetVisual category={asset.category} name={asset.name} size={size === 'sm' ? 'sm' : 'md'} />;
  }

  return (
    <img
      src={imageUrl}
      alt={asset.name}
      loading="lazy"
      onError={() =>
        setFailedSources((current) => (current.includes(imageUrl) ? current : [...current, imageUrl]))
      }
      className={`shrink-0 border border-line bg-white object-contain p-1 ${sizeMap[size]} ${className}`.trim()}
    />
  );
}
