import { CrazyGamesPlatform } from './CrazyGamesPlatform';
import { PokiPlatform } from './PokiPlatform';
import type { Platform } from './Platform';
import { WebPlatform } from './WebPlatform';

export type { Platform } from './Platform';

/**
 * Площадка по режиму сборки: `vite build --mode crazygames` / `--mode poki`, иначе обычный сайт.
 * В продакшене режим — константа, поэтому чужие SDK в сборку не попадают.
 * В dev-сборке площадку можно выбрать параметром `?platform=crazygames|poki`.
 */
export function createPlatform(): Platform {
  const id = import.meta.env.DEV ? (new URLSearchParams(location.search).get('platform') ?? 'web') : import.meta.env.MODE;
  if (id === 'crazygames') return new CrazyGamesPlatform();
  if (id === 'poki') return new PokiPlatform();
  return new WebPlatform();
}
