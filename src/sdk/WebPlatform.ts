import { Platform } from './Platform';

/**
 * Обычный сайт (GitHub Pages, локальный запуск): SDK нет.
 * Rewarded-реклама симулируется окном с отсчётом, межматчевой рекламы нет.
 */
export class WebPlatform extends Platform {
  readonly id = 'web' as const;

  async init(): Promise<void> {}

  protected override allowSimulation(): boolean {
    return true;
  }
}
