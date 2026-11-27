import type { Lang } from '../types/game';
import { Platform, langFromLocale, safeCall, withTimeout } from './Platform';

/**
 * CrazyGames HTML5 SDK v3: midgame-реклама после матча, rewarded по кнопке, события загрузки и геймплея,
 * happytime на победе, глобальная настройка звука и облачное сохранение через data-модуль.
 * Вне доменов CrazyGames SDK отвечает environment = 'disabled' — игра работает без рекламы.
 */

const SDK_URL = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';
const SAVE_KEY = 'clutch-save';
/** Data-модуль не любит частые записи: не чаще раза в 30 с, последняя запись — отложенно */
const SAVE_COOLDOWN_MS = 30_000;

interface CrazyAdCallbacks {
  adStarted(): void;
  adFinished(): void;
  /** Строка или { code, message }: «Ad requested too soon», «No ad available»… */
  adError(error: unknown): void;
}

interface CrazySdk {
  init(): Promise<void>;
  environment: 'local' | 'crazygames' | 'disabled';
  ad: { requestAd(type: 'midgame' | 'rewarded', callbacks: CrazyAdCallbacks): void | Promise<void> };
  game: {
    gameplayStart(): void | Promise<void>;
    gameplayStop(): void | Promise<void>;
    loadingStart(): void | Promise<void>;
    loadingStop(): void | Promise<void>;
    happytime(): void | Promise<void>;
    settings?: { muteAudio?: boolean };
    addSettingsChangeListener?(listener: () => void): void;
  };
  data?: { getItem(key: string): string | null; setItem(key: string, value: string): void };
  user?: { systemInfo?: { locale?: string } };
}

declare global {
  interface Window {
    CrazyGames?: { SDK: CrazySdk };
  }
}

export class CrazyGamesPlatform extends Platform {
  readonly id = 'crazygames' as const;
  override readonly hostFullscreen = true;
  private sdk: CrazySdk | null = null;
  private lastWrite = -Infinity;
  private saveTimer: number | null = null;
  private pending: unknown = null;

  async init(): Promise<void> {
    try {
      await this.loadScript(SDK_URL, 8000);
      const sdk = window.CrazyGames?.SDK;
      if (!sdk) return;
      await withTimeout(sdk.init(), 8000);
      if (sdk.environment === 'disabled') return;
      this.sdk = sdk;
      this.available = true;
      safeCall(() => sdk.game.loadingStart());
      safeCall(() => sdk.game.addSettingsChangeListener?.(() => this.onPlatformMute?.(this.platformMuted())));
      window.addEventListener('pagehide', () => this.flushSave());
    } catch {
      this.sdk = null;
      this.available = false;
    }
  }

  override ready(): void {
    const sdk = this.sdk;
    if (sdk) safeCall(() => sdk.game.loadingStop());
  }

  override platformMuted(): boolean {
    return !!this.sdk?.game.settings?.muteAudio;
  }

  override preferredLang(): Lang | null {
    try {
      return langFromLocale(this.sdk?.user?.systemInfo?.locale);
    } catch {
      return null;
    }
  }

  protected override gameplayEvent(on: boolean): void {
    const sdk = this.sdk;
    if (sdk) safeCall(() => (on ? sdk.game.gameplayStart() : sdk.game.gameplayStop()));
  }

  override happyTime(): void {
    const sdk = this.sdk;
    if (sdk) safeCall(() => sdk.game.happytime());
  }

  protected override requestRewarded(): Promise<boolean> {
    return this.requestAd('rewarded');
  }

  protected override async requestInterstitial(): Promise<void> {
    await this.requestAd('midgame');
  }

  /** true — реклама досмотрена (adFinished); ошибки и «слишком рано» — false */
  private requestAd(type: 'midgame' | 'rewarded'): Promise<boolean> {
    const sdk = this.sdk;
    if (!sdk) return Promise.resolve(false);
    return this.adBreak(
      (onStart) =>
        new Promise<boolean>((resolve) => {
          try {
            const r = sdk.ad.requestAd(type, {
              adStarted: onStart,
              adFinished: () => resolve(true),
              adError: () => resolve(false),
            });
            if (r instanceof Promise) r.catch(() => resolve(false));
          } catch {
            resolve(false);
          }
        }),
    );
  }

  override loadCloud(): Promise<unknown> {
    try {
      const raw = this.sdk?.data?.getItem(SAVE_KEY);
      return Promise.resolve(raw ? JSON.parse(raw) : null);
    } catch {
      return Promise.resolve(null);
    }
  }

  override saveCloud(data: unknown): void {
    if (!this.sdk?.data) return;
    this.pending = data;
    if (this.saveTimer !== null) return;
    const wait = this.lastWrite + SAVE_COOLDOWN_MS - performance.now();
    if (wait <= 0) this.flushSave();
    else this.saveTimer = window.setTimeout(() => this.flushSave(), wait);
  }

  private flushSave(): void {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.pending === null || !this.sdk?.data) return;
    try {
      this.sdk.data.setItem(SAVE_KEY, JSON.stringify(this.pending));
      this.lastWrite = performance.now();
      this.pending = null;
    } catch {
      /* облако недоступно — остаётся localStorage */
    }
  }
}
