import { useEffect, useState } from 'react';
import { AssetVisual } from './AssetVisual';
import type { Asset } from '../types';

type AssetImageProps = {
  asset: Asset;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
};

const sizeMap: Record<NonNullable<AssetImageProps['size']>, string> = {
  sm: 'h-10 w-10 rounded-xl',
  md: 'h-12 w-12 rounded-2xl',
  lg: 'h-28 w-28 rounded-2xl',
};

export function AssetImage({ asset, size = 'md', className = '' }: AssetImageProps) {
  const [broken, setBroken] = useState(false);
  const imageUrl = (asset.productImageUrl || '').trim();

  useEffect(() => {
    setBroken(false);
  }, [imageUrl]);

  if (!imageUrl || broken) {
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
      onError={() => setBroken(true)}
      className={`shrink-0 border border-line bg-white object-contain p-1 ${sizeMap[size]} ${className}`.trim()}
    />
  );
}
