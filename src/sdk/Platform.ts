import type { Lang } from '../types/game';

/**
 * Общий слой игровой площадки: реклама, события загрузки/геймплея, облачное сохранение, полноэкранный режим.
 * Реализации: обычный сайт (без SDK), CrazyGames (SDK v3), Poki (SDK v2).
 * Площадка выбирается при сборке: `vite build --mode crazygames | poki` (см. sdk/index.ts).
 */

export type PlatformId = 'web' | 'crazygames' | 'poki';

const RU_FAMILY = new Set(['ru', 'be', 'kk', 'uk', 'uz', 'hy', 'az', 'ky', 'tg', 'tk']);

/** Язык интерфейса по коду локали площадки ('ru-RU', 'en'…) */
export function langFromLocale(code: string | null | undefined): Lang | null {
  if (!code) return null;
  return RU_FAMILY.has(code.slice(0, 2).toLowerCase()) ? 'ru' : 'en';
}

export abstract class Platform {
  abstract readonly id: PlatformId;
  /** SDK площадки загружен и работает */
  available = false;
  /** У площадки своя кнопка полноэкранного режима — в меню игры её не показываем */
  readonly hostFullscreen: boolean = false;
  /** Реклама началась: игра на паузе, звук выключен */
  onAdOpen: (() => void) | null = null;
  /** Реклама закончилась (вызывается только после onAdOpen) */
  onAdClose: (() => void) | null = null;
  /** Площадка включила/выключила звук своей настройкой */
  onPlatformMute: ((muted: boolean) => void) | null = null;

  private fallbackAd: (() => Promise<boolean>) | null = null;
  private playing = false;
  private adBusy = false;

  abstract init(): Promise<void>;

  /** Симуляция rewarded-рекламы, когда SDK нет (рисуется UI) */
  setFallbackAd(fn: () => Promise<boolean>): void {
    this.fallbackAd = fn;
  }

  /** Можно ли выдавать награду через симуляцию без SDK (только обычный сайт, не порталы) */
  protected allowSimulation(): boolean {
    return false;
  }

  /** Игра загрузилась и готова к игре */
  ready(): void {}

  /** Площадка сейчас глушит звук своей настройкой */
  platformMuted(): boolean {
    return false;
  }

  /** Язык пользователя на площадке (null — не известен) */
  preferredLang(): Lang | null {
    return null;
  }

  gameplayStart(): void {
    if (this.playing) return;
    this.playing = true;
    this.gameplayEvent(true);
  }

  gameplayStop(): void {
    if (!this.playing) return;
    this.playing = false;
    this.gameplayEvent(false);
  }

  protected gameplayEvent(_on: boolean): void {}

  /** Яркий момент (победа) */
  happyTime(): void {}

  isFullscreen(): boolean {
    return !!document.fullscreenElement;
  }

  async toggleFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      /* полноэкранный режим недоступен в этом окружении */
    }
  }

  /** Rewarded-реклама. true — награду нужно выдать */
  async showRewarded(): Promise<boolean> {
    if (this.adBusy) return false;
    this.adBusy = true;
    try {
      if (this.available) return await this.requestRewarded();
      if (this.fallbackAd && this.allowSimulation()) {
        this.onAdOpen?.();
        try {
          return await this.fallbackAd();
        } finally {
          this.onAdClose?.();
        }
      }
      return false;
    } catch {
      return false;
    } finally {
      this.adBusy = false;
    }
  }

  /** Межматчевая реклама в естественной паузе (после экрана итогов) */
  async showInterstitial(): Promise<void> {
    await this.exclusive(() => this.requestInterstitial());
  }

  /** Реклама перед стартом матча (Poki: commercialBreak перед gameplayStart) */
  async breakBeforePlay(): Promise<void> {
    await this.exclusive(() => this.requestBreakBeforePlay());
  }

  protected requestRewarded(): Promise<boolean> {
    return Promise.resolve(false);
  }

  protected requestInterstitial(): Promise<void> {
    return Promise.resolve();
  }

  protected requestBreakBeforePlay(): Promise<void> {
    return Promise.resolve();
  }

  /** Облачное сохранение площадки (null — нет) */
  loadCloud(): Promise<unknown> {
    return Promise.resolve(null);
  }

  saveCloud(_data: unknown): void {}

  /**
   * Показ рекламы через колбэки SDK: onStart — реклама реально началась (пауза и тишина),
   * run возвращает результат; onAdClose вызывается, только если реклама началась.
   */
  protected async adBreak<T>(run: (onStart: () => void) => Promise<T>): Promise<T> {
    let opened = false;
    try {
      return await run(() => {
        if (opened) return;
        opened = true;
        this.onAdOpen?.();
      });
    } finally {
      if (opened) this.onAdClose?.();
    }
  }

  private async exclusive(run: () => Promise<void>): Promise<void> {
    if (this.adBusy || !this.available) return;
    this.adBusy = true;
    try {
      await run();
    } catch {
      /* реклама не показалась — продолжаем игру */
    } finally {
      this.adBusy = false;
    }
  }

  protected loadScript(src: string, timeout: number): Promise<void> {
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
}

/** Промис с таймаутом: SDK площадок иногда не отвечают (блокировщики, офлайн) */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => window.setTimeout(() => reject(new Error('sdk timeout')), ms))]);
}

/** Вызов метода SDK, который может бросить исключение (старая версия, блокировщик) */
export function safeCall(fn: () => unknown): void {
  try {
    const r = fn();
    if (r instanceof Promise) r.catch(() => undefined);
  } catch {
    /* метод недоступен */
  }
}

export function isLocalHost(): boolean {
  return /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/.test(location.hostname);
}
