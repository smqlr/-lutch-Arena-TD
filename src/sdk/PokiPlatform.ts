import type { Lang } from '../types/game';
import { Platform, isLocalHost, langFromLocale, safeCall, withTimeout } from './Platform';

/**
 * Poki SDK v2: commercialBreak перед каждым стартом матча (частоту решает Poki), rewardedBreak по кнопке,
 * события загрузки и геймплея. С блокировщиком рекламы init() отклоняется — игра продолжает работать без рекламы.
 * На localhost SDK запускается в debug-режиме (реклама симулируется самим Poki).
 */

const SDK_URL = 'https://game-cdn.poki.com/scripts/v2/poki-sdk.js';

interface PokiSdk {
  init(options?: { debug?: boolean }): Promise<void>;
  gameLoadingFinished(): void;
  gameplayStart(): void;
  gameplayStop(): void;
  commercialBreak(onStart?: () => void): Promise<void>;
  rewardedBreak(args?: (() => void) | { onStart?: () => void; size?: 'small' | 'medium' | 'large' }): Promise<boolean>;
  getLanguage?(): string;
}

declare global {
  interface Window {
    PokiSDK?: PokiSdk;
  }
}

export class PokiPlatform extends Platform {
  readonly id = 'poki' as const;
  override readonly hostFullscreen = true;
  /** Скрипт загружен: события загрузки/геймплея отправляем даже при блокировщике рекламы */
  private sdk: PokiSdk | null = null;

  async init(): Promise<void> {
    try {
      await this.loadScript(SDK_URL, 8000);
      const sdk = window.PokiSDK;
      if (!sdk) return;
      this.sdk = sdk;
      await withTimeout(sdk.init({ debug: isLocalHost() }), 8000);
      this.available = true;
    } catch {
      this.available = false;
    }
  }

  override ready(): void {
    const sdk = this.sdk;
    if (sdk) safeCall(() => sdk.gameLoadingFinished());
  }

  override preferredLang(): Lang | null {
    try {
      return langFromLocale(this.sdk?.getLanguage?.());
    } catch {
      return null;
    }
  }

  protected override gameplayEvent(on: boolean): void {
    const sdk = this.sdk;
    if (sdk) safeCall(() => (on ? sdk.gameplayStart() : sdk.gameplayStop()));
  }

  protected override requestRewarded(): Promise<boolean> {
    const sdk = this.sdk;
    if (!sdk) return Promise.resolve(false);
    return this.adBreak((onStart) => sdk.rewardedBreak({ size: 'medium', onStart }).then((ok) => !!ok));
  }

  protected override async requestBreakBeforePlay(): Promise<void> {
    const sdk = this.sdk;
    if (!sdk) return;
    await this.adBreak((onStart) => sdk.commercialBreak(onStart));
  }
}
