import './style.css';
import type { Lang, MapId, MatchResult, UnitDef } from './types/game';
import { MAP_ORDER } from './types/game';
import { MAPS } from './data/maps';
import { getUnit } from './data/units';
import { YandexSDK } from './sdk/YandexSDK';
import { SaveManager } from './game/Save';
import { Game } from './game/Game';
import { SoundFX } from './engine/SoundFX';
import { SceneManager } from './engine/SceneManager';
import { CameraController } from './engine/CameraController';
import { buildMap } from './engine/MapBuilder';
import type { BuiltMap } from './engine/MapBuilder';
import { LabelLayer } from './ui/Labels';
import { MainMenu } from './ui/MainMenu';
import { GameHUD } from './ui/GameHUD';
import { Tutorial } from './ui/Tutorial';
import { TUTORIAL_CREDITS, TUTORIAL_GEMS } from './data/economy';
import { DIFFICULTIES } from './data/difficulty';
import { adSimulation, isModalOpen, openModal, toast } from './ui/Overlay';
import type { ModalHandle } from './ui/Overlay';
import { icon } from './ui/icons';
import { fmtNum, loc, setLang, t } from './i18n';

/**
 * Точка входа: загрузка SDK и сохранений, главное меню с 3D-фоном карты, запуск матча,
 * пауза, итоги матча с удвоением кредитов за рекламу, игровой цикл.
 */

class App {
  private sdk = new YandexSDK();
  private save!: SaveManager;
  private sound = new SoundFX();
  private scene!: SceneManager;
  private cam!: CameraController;
  private labels!: LabelLayer;
  private menu!: MainMenu;
  private hud: GameHUD | null = null;
  private tutorial: Tutorial | null = null;
  private game: Game | null = null;
  private built: BuiltMap | null = null;
  private builtId: MapId | null = null;
  private paused = false;
  private adPaused = false;
  private pauseModal: ModalHandle | null = null;
  private last = performance.now();
  private uiRoot!: HTMLElement;

  async boot(): Promise<void> {
    await this.sdk.init();
    this.save = new SaveManager(this.sdk);
    await this.save.syncCloud();
    // Основной язык — английский; русский включается в настройках (выбор запоминается)
    const lang: Lang = this.save.data.lang ?? 'en';
    setLang(lang);
    document.title = 'Clutch Arena TD';
    this.sound.setMuted(this.save.data.muted);

    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    this.uiRoot = document.getElementById('ui-root')!;
    this.scene = new SceneManager(canvas);
    this.cam = new CameraController(this.scene.camera, canvas);
    this.labels = new LabelLayer(document.getElementById('labels-layer')!);

    this.sdk.setFallbackAd(adSimulation);
    this.sdk.onAdOpen = () => {
      this.adPaused = true;
      this.sound.suspend('ad');
    };
    this.sdk.onAdClose = () => {
      this.adPaused = false;
      this.sound.resume('ad');
    };

    this.menu = new MainMenu(this.uiRoot, this.save, this.sound, {
      startMatch: (id) => this.startMatch(id),
      previewMap: (id) => this.previewMenuMap(id),
      setLang: (l) => {
        setLang(l);
        this.save.data.lang = l;
        this.save.save();
        this.menu.render();
      },
      toggleMute: () => this.toggleMute(),
      isMuted: () => this.sound.muted,
      toggleFullscreen: () => void this.sdk.toggleFullscreen(),
      resetProgress: () => {
        this.save.reset();
        this.sound.setMuted(this.save.data.muted);
      },
      watchAd: async () => {
        if (!(await this.rewardedAd(true))) toast(t('adUnavailable'), 'bad');
      },
    });

    this.cam.onTap = (x, y, touch) => this.game?.tap(x, y, touch);
    this.cam.onHover = (x, y) => this.game?.hover(x, y);

    window.addEventListener('resize', () => this.scene.resize());
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('pointerdown', () => this.sound.ensure(), { capture: true });
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.sound.suspend('hidden');
        if (this.game && this.game.phase !== 'ended' && !this.paused) this.openPause();
      } else {
        this.sound.resume('hidden');
      }
    });

    // Первый запуск: сразу в бой с обучением (хук), меню — потом
    if (!this.save.data.tutorialDone) this.startMatch('bazaar', true);
    else this.showMenu();
    const loader = document.getElementById('boot-loader');
    if (loader) {
      loader.classList.add('is-done');
      window.setTimeout(() => loader.remove(), 600);
    }
    this.sdk.ready();
    requestAnimationFrame((n) => this.frame(n));
  }

  /* ------------------------------ Карта ---------------------------------- */

  private loadMap(id: MapId, force = false): void {
    if (!force && this.builtId === id && this.built) return;
    this.built?.dispose();
    const map = MAPS[id];
    this.built = buildMap(map);
    this.builtId = id;
    this.scene.applyTheme(map.theme);
    this.scene.setWorld(this.built.group);
    this.scene.clearFx();
  }

  private frameMenuCamera(id: MapId): void {
    const m = MAPS[id];
    this.cam.setDefaults(m.camera.target, m.camera.dist * 0.82, 0.55, 0.6, m.size);
    this.cam.reset();
    this.cam.autoOrbit = true;
    this.cam.inputEnabled = false;
  }

  private previewMenuMap(id: MapId): void {
    if (this.builtId === id) return;
    this.loadMap(id);
    this.frameMenuCamera(id);
  }

  /* ------------------------------- Меню ---------------------------------- */

  private teardownMatch(): void {
    // Вышли из матча посреди обучения — больше его не навязываем
    if (this.tutorial?.active) {
      this.tutorial.dispose();
      this.save.skipTutorial();
    }
    this.tutorial = null;
    this.closePause();
    this.game?.dispose();
    this.game = null;
    this.hud?.dispose();
    this.hud = null;
    this.labels.setBlockers(null);
    this.labels.clear();
    this.paused = false;
  }

  private showMenu(): void {
    this.teardownMatch();
    this.sdk.gameplayStop();
    this.menu.syncFocus();
    this.loadMap(this.menu.focusedMap);
    this.frameMenuCamera(this.menu.focusedMap);
    this.menu.show();
  }

  /* ------------------------------- Матч ---------------------------------- */

  private startMatch(id: MapId, tutorial = false): void {
    this.teardownMatch();
    this.menu.hide();
    this.loadMap(id, true);
    const map = MAPS[id];
    const squad = this.save.data.squad.map((u) => getUnit(u)).filter((u): u is UnitDef => !!u);
    this.game = new Game(this.scene, this.sound, this.built!, map, squad, this.labels, {
      toast: (msg, kind) => toast(msg, kind),
      selectionChanged: () => this.hud?.onSelectionChanged(),
      spotPicked: () => this.hud?.refresh(),
      ended: (r) => this.onEnded(r),
    }, DIFFICULTIES[tutorial ? 'easy' : this.save.data.difficulty]);
    this.hud = new GameHUD(this.uiRoot, this.game, {
      togglePause: () => this.togglePause(),
      toggleCamera: () => this.cam.toggleMode(),
      resetCamera: () => this.cam.reset(),
      toggleMute: () => this.toggleMute(),
      isMuted: () => this.sound.muted,
      cameraMode: () => this.cam.mode,
      airdrop: () => void this.airdrop(),
    });
    const hud = this.hud;
    this.labels.setBlockers(() => hud.getBlockers());
    this.cam.autoOrbit = false;
    // В портретной ориентации разворачиваем камеру: длинная ось арены идёт по вертикали экрана
    const portrait = window.innerWidth / window.innerHeight < 0.8;
    this.cam.setDefaults(
      map.camera.target,
      map.camera.dist * (portrait ? 1.3 : 1),
      map.camera.yaw + (portrait ? Math.PI / 2 : 0),
      map.camera.pitch,
      map.size,
    );
    this.cam.reset();
    this.cam.inputEnabled = true;
    this.sound.ensure();
    this.sdk.gameplayStart();
    toast(`${t('matchStart', { map: loc(map.name) })} · ${loc(this.game.diff.name)}`, 'info', 3200);
    if (tutorial) {
      this.tutorial = new Tutorial(this.uiRoot, this.game, {
        finish: (skipped) => {
          this.tutorial = null;
          if (skipped) {
            this.save.skipTutorial();
            return;
          }
          this.save.completeTutorial(TUTORIAL_CREDITS, TUTORIAL_GEMS);
          this.sound.coin();
          toast(`+${TUTORIAL_CREDITS} ${t('credits')} · +${TUTORIAL_GEMS} ${t('gems')}`, 'gold', 3500);
        },
      });
    }
  }

  /**
   * Любая rewarded-реклама: засчитывается в прогресс гемов (каждая десятая даёт гемы).
   * withCredits — реклама из меню, за неё сразу кредиты.
   */
  private async rewardedAd(withCredits: boolean): Promise<boolean> {
    const ok = await this.sdk.showRewarded();
    if (!ok) return false;
    const r = this.save.recordAd(withCredits);
    if (r.credits) toast(t('adReward', { n: r.credits }), 'gold');
    if (r.gems) {
      toast(t('gemReward', { n: r.gems }), 'gold', 3500);
      this.sound.upgrade();
    } else if (r.credits) this.sound.coin();
    return true;
  }

  private async airdrop(): Promise<void> {
    const g = this.game;
    if (!g || g.airdropsLeft <= 0) {
      toast(t('airdropLimit'), 'bad');
      return;
    }
    this.sdk.gameplayStop();
    const ok = await this.rewardedAd(false);
    if (this.game === g && g.phase !== 'ended') this.sdk.gameplayStart();
    if (ok && this.game === g) g.grantAirdrop();
    else if (!ok) toast(t('adUnavailable'), 'bad');
  }

  private onEnded(r: MatchResult): void {
    // Дошли до конца матча — обучение засчитываем с наградой
    if (this.tutorial?.active) this.tutorial.close(false);
    this.sdk.gameplayStop();
    this.cam.inputEnabled = false;
    const { record, unlocked: newMap } = this.save.recordMatch(r);
    const nextId = r.victory ? MAP_ORDER[MAP_ORDER.indexOf(r.mapId) + 1] : undefined;
    let doubled = false;
    const stat = (k: string, v: string, cls = '') =>
      `<div class="stat-box"><span class="k">${k}</span><span class="v ${cls}">${v}</span></div>`;
    window.setTimeout(() => {
      const m = openModal({
        title: `<span class="${r.victory ? 'text-neon' : 'text-danger'}">${r.victory ? t('victory') : t('defeat')}</span>`,
        dismissible: false,
        html: `
          <p class="mb-3">${r.victory ? t('victorySub') : t('defeatSub')}</p>
          <div class="grid grid-cols-2 gap-2">
            ${stat(t('wavesCleared'), `${r.wavesCleared}/${r.totalWaves}`)}
            ${stat(t('kills'), fmtNum(r.kills))}
            ${stat(t('hpLeft'), String(r.hpLeft), r.hpLeft > 0 ? 'hp-good' : 'hp-low')}
            <div class="stat-box"><span class="k">${t('creditsEarned')}</span><span class="v text-gold" data-credits>+${fmtNum(r.credits)}</span></div>
          </div>
          ${record ? `<div class="mt-3 text-gold font-bold">${icon('star')} ${t('newRecord')}</div>` : ''}
          ${r.gems ? `<div class="mt-2 text-gem font-bold">${icon('gem')} ${t('gemsDropped', { n: r.gems })}</div>` : ''}
          ${newMap ? `<div class="mt-2 text-neon font-bold">${icon('map')} ${t('mapUnlocked', { map: loc(MAPS[newMap].name) })}</div>` : ''}`,
        buttons: [
          {
            label: `▶ ${t('doubleCredits')}`,
            kind: 'gold',
            close: false,
            id: 'btn-double',
            onClick: () => {
              if (doubled) return;
              const btn = document.getElementById('btn-double') as HTMLButtonElement | null;
              if (btn) btn.disabled = true;
              void this.rewardedAd(false).then((ok) => {
                if (ok) {
                  doubled = true;
                  this.save.addCredits(r.credits);
                  const el = m.el.querySelector('[data-credits]');
                  if (el) el.textContent = `+${fmtNum(r.credits * 2)}`;
                  toast(t('doubled'), 'gold');
                  this.sound.coin();
                } else {
                  if (btn) btn.disabled = false;
                  toast(t('adUnavailable'), 'bad');
                }
              });
            },
          },
          { label: t('retry'), kind: 'default', onClick: () => void this.afterMatch(() => this.startMatch(r.mapId)) },
          ...(nextId && this.save.isMapUnlocked(nextId)
            ? [{ label: `${t('nextMap')} →`, kind: 'primary' as const, onClick: () => void this.afterMatch(() => this.startMatch(nextId)) }]
            : []),
          { label: t('exitMenu'), kind: r.victory && nextId ? 'ghost' : 'primary', onClick: () => void this.afterMatch(() => this.showMenu()) },
        ],
      });
    }, 900);
  }

  /** Межматчевая реклама (не чаще раза в 2 минуты), затем переход */
  private async afterMatch(next: () => void): Promise<void> {
    await this.sdk.showInterstitial();
    next();
  }

  /* ------------------------------- Пауза --------------------------------- */

  private togglePause(): void {
    if (!this.game || this.game.phase === 'ended') return;
    if (this.paused) this.closePause();
    else this.openPause();
  }

  private openPause(): void {
    if (this.paused || !this.game) return;
    this.paused = true;
    this.cam.resetInput();
    this.sdk.gameplayStop();
    const muted = this.sound.muted;
    this.pauseModal = openModal({
      title: t('pause'),
      html: `
        <div class="grid grid-cols-3 gap-2 mb-3">
          <div class="stat-box"><span class="k">${t('wave')}</span><span class="v">${this.game.waveIndex}/${this.game.waves.length}</span></div>
          <div class="stat-box"><span class="k">${t('hp')}</span><span class="v hp-good">${this.game.hp}</span></div>
          <div class="stat-box"><span class="k">${t('kills')}</span><span class="v">${this.game.kills}</span></div>
        </div>
        <ul class="text-xs text-slate-400 flex flex-col gap-1 list-disc pl-4">
          <li>${t('controls1')}</li><li>${t('controls2')}</li><li>${t('controls3')}</li>
        </ul>`,
      buttons: [
        {
          label: `♪ ${t('sound')}: ${muted ? t('off') : t('on')}`,
          kind: 'ghost',
          id: 'btn-pause-mute',
          close: false,
          onClick: () => {
            const m = this.toggleMute();
            const b = document.getElementById('btn-pause-mute');
            if (b) b.textContent = `♪ ${t('sound')}: ${m ? t('off') : t('on')}`;
          },
        },
        { label: t('exitMenu'), kind: 'danger', onClick: () => this.showMenu() },
        { label: t('restart'), kind: 'default', onClick: () => this.startMatch(this.game!.map.id) },
        { label: t('resume'), kind: 'primary' },
      ],
      onClose: () => {
        this.pauseModal = null;
        if (this.paused) {
          this.paused = false;
          if (this.game && this.game.phase !== 'ended') this.sdk.gameplayStart();
        }
      },
    });
  }

  private closePause(): void {
    if (this.pauseModal) this.pauseModal.close();
    this.pauseModal = null;
    this.paused = false;
  }

  /* ------------------------------- Прочее -------------------------------- */

  private toggleMute(): boolean {
    this.sound.ensure();
    const m = this.sound.toggleMute();
    this.save.data.muted = m;
    this.save.save();
    if (!m) this.sound.click();
    return m;
  }

  private onKey(e: KeyboardEvent): void {
    if (this.menu.isVisible || isModalOpen() || !this.game) return;
    if (this.hud?.handleKey(e)) {
      e.preventDefault();
      return;
    }
    if (e.code === 'Escape' || e.code === 'KeyP') {
      e.preventDefault();
      this.togglePause();
    }
  }

  private frame(now: number): void {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const halted = this.paused || this.adPaused;
    this.cam.update(dt);
    if (this.game && !halted) this.game.update(dt);
    const fxDt = halted ? 0 : dt * (this.game?.speed ?? 1);
    this.built?.update(halted ? 0 : dt);
    this.scene.update(fxDt);
    this.scene.render();
    this.labels.update(this.scene.camera, dt);
    this.hud?.update(dt);
    this.tutorial?.update(dt);
    this.menu.update(dt);
    requestAnimationFrame((n) => this.frame(n));
  }
}

const app = new App();
// Доступ к состоянию из консоли только в dev-сборке (для отладки баланса)
if (import.meta.env.DEV) (window as unknown as { __app: App }).__app = app;
app.boot().catch((err) => {
  console.error(err);
  const loader = document.getElementById('boot-loader');
  if (loader) loader.innerHTML = `<div style="color:#fca5a5;font:600 14px system-ui;padding:24px;text-align:center">Failed to start: ${String(err)}</div>`;
});
