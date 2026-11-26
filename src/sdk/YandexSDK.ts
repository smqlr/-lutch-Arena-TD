import type { Lang } from '../types/game';

/**
 * Безопасная обёртка над SDK Яндекс Игр.
 * SDK подгружается только на доменах Яндекса (или с параметром ?ysdk=1).
 * Без SDK всё работает локально: язык берётся из браузера, реклама симулируется модалкой.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnySdk = any;

declare global {
  interface Window {
    YaGames?: { init(): Promise<AnySdk> };
  }
}

const RU_FAMILY = new Set(['ru', 'be', 'kk', 'uk', 'uz', 'hy', 'az', 'ky', 'tg', 'tk']);

export class YandexSDK {
  available = false;
  private ysdk: AnySdk = null;
  private player: AnySdk = null;
  private fallbackAd: (() => Promise<boolean>) | null = null;
  private lastInterstitial = 0;
  onAdOpen: (() => void) | null = null;
  onAdClose: (() => void) | null = null;

  /** Функция-симуляция рекламы для запуска без SDK (рисуется UI) */
  setFallbackAd(fn: () => Promise<boolean>): void {
    this.fallbackAd = fn;
  }

  async init(): Promise<void> {
    const host = location.hostname;
    const forced = new URLSearchParams(location.search).has('ysdk');
    const onYandex = /yandex|playhop|games\.s3|yandexgames/i.test(host);
    if (!onYandex && !forced) return;
    try {
      await this.loadScript('/sdk.js', 5000);
      if (!window.YaGames) return;
      this.ysdk = await Promise.race([
        window.YaGames.init(),
        new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 5000)),
      ]);
      this.available = !!this.ysdk;
      if (this.available) {
        try {
          this.player = await this.ysdk.getPlayer({ scopes: false });
        } catch {
          this.player = null;
        }
      }
    } catch {
      this.available = false;
      this.ysdk = null;
    }
  }

  private loadScript(src: string, timeout: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      const timer = window.setTimeout(() => reject(new Error('sdk timeout')), timeout);
      s.onload = () => {
        window.clearTimeout(timer);
        resolve();
      };
      s.onerror = () => {
        window.clearTimeout(timer);
        reject(new Error('sdk load error'));
      };
      document.head.appendChild(s);
    });
  }

  /** Автоопределение языка: SDK → браузер (сейчас не используется: основной язык игры — английский) */
  detectLang(): Lang {
    let code = '';
    try {
      code = this.ysdk?.environment?.i18n?.lang ?? '';
    } catch {
      code = '';
    }
    if (!code) code = (navigator.language || 'en').slice(0, 2).toLowerCase();
    return RU_FAMILY.has(code) ? 'ru' : 'en';
  }

  /** Сообщить платформе, что игра загрузилась */
  ready(): void {
    try {
      this.ysdk?.features?.LoadingAPI?.ready();
    } catch {
      /* SDK без LoadingAPI */
    }
  }

  gameplayStart(): void {
    try {
      this.ysdk?.features?.GameplayAPI?.start();
    } catch {
      /* нет GameplayAPI */
    }
  }

  gameplayStop(): void {
    try {
      this.ysdk?.features?.GameplayAPI?.stop();
    } catch {
      /* нет GameplayAPI */
    }
  }

  isFullscreen(): boolean {
    try {
      if (this.ysdk?.screen?.fullscreen) return this.ysdk.screen.fullscreen.status === 'on';
    } catch {
      /* ignore */
    }
    return !!document.fullscreenElement;
  }

  async toggleFullscreen(): Promise<void> {
    try {
      const fs = this.ysdk?.screen?.fullscreen;
      if (fs) {
        if (fs.status === 'on') await fs.exit();
        else await fs.request();
        return;
      }
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      /* полноэкранный режим недоступен в этом окружении */
    }
  }

  /** Rewarded-реклама. Возвращает true, если награду нужно выдать. */
  showRewarded(): Promise<boolean> {
    if (!this.available || !this.ysdk?.adv) {
      if (this.fallbackAd) {
        this.onAdOpen?.();
        return this.fallbackAd().finally(() => this.onAdClose?.());
      }
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      let rewarded = false;
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        this.onAdClose?.();
        resolve(rewarded);
      };
      try {
        this.ysdk.adv.showRewardedVideo({
          callbacks: {
            onOpen: () => this.onAdOpen?.(),
            onRewarded: () => {
              rewarded = true;
            },
            onClose: () => done(),
            onError: () => done(),
          },
        });
      } catch {
        done();
      }
    });
  }

  /** Полноэкранная реклама между матчами (не чаще раза в 2 минуты) */
  showInterstitial(): Promise<void> {
    if (!this.available || !this.ysdk?.adv) return Promise.resolve();
    const now = Date.now();
    if (now - this.lastInterstitial < 120_000) return Promise.resolve();
    this.lastInterstitial = now;
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        this.onAdClose?.();
        resolve();
      };
      try {
        this.ysdk.adv.showFullscreenAdv({
          callbacks: {
            onOpen: () => this.onAdOpen?.(),
            onClose: () => done(),
            onError: () => done(),
            onOffline: () => done(),
          },
        });
      } catch {
        done();
      }
    });
  }

  /** Облачное сохранение (если игрок доступен) */
  async loadCloud(): Promise<unknown> {
    if (!this.player) return null;
    try {
      const data = await this.player.getData(['save']);
      return data?.save ?? null;
    } catch {
      return null;
    }
  }

  saveCloud(data: unknown): void {
    if (!this.player) return;
    try {
      void this.player.setData({ save: data }, false);
    } catch {
      /* облако недоступно — остаётся localStorage */
    }
  }
}
