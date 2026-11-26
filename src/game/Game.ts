import * as THREE from 'three';
import type { EnemyDef, EnemyKind, Loc, MapDef, MatchResult, TargetPriority, TierIndex, UnitDef, Vec3T, WaveDef } from '../types/game';
import { MAP_ORDER, PRIORITIES } from '../types/game';
import { ENEMIES } from '../data/enemies';
import { buildAllWaves } from '../data/waves';
import type { FireZoneVis, SceneManager, SmokeVis } from '../engine/SceneManager';
import type { SoundFX } from '../engine/SoundFX';
import type { BuiltMap } from '../engine/MapBuilder';
import { PlacementCursor, TowerMarker, buildThrowable } from '../engine/ModelFactory';
import { EnemyModel, UnitModel } from '../engine/Characters';
import type { ThrowableKind } from '../engine/ModelFactory';
import { RoutePath } from './RoutePath';
import { Placement } from './Placement';
import type { SpotFail, SpotProbe } from './Placement';
import type { LabelLayer } from '../ui/Labels';
import { ROLE_COLORS, loc, priorityName, roleColorCss, t, weaponName } from '../i18n';
import type { DictKey } from '../i18n';

/**
 * Игровая логика матча: башни (юниты), враги, волны, экономика, пассивки, утилиты,
 * дым Смокеров, лаг от DDoS-дронов, победа/поражение.
 */

export type ToastKind = 'info' | 'good' | 'bad' | 'gold';

export interface GameCallbacks {
  toast(msg: string, kind?: ToastKind): void;
  selectionChanged(): void;
  spotPicked(): void;
  ended(result: MatchResult): void;
}

export interface TowerStats {
  damage: number;
  fireRate: number;
  range: number;
  dps: number;
  dmgBonus: number;
  rateBonus: number;
  rangeBonus: number;
}

const SNIPERS = new Set(['scout', 'sniper', 'autoSniper']);
const UTILITY = new Set(['flash', 'molotov', 'heGrenade', 'slowZone']);
const FORCE_BUY_BONUS = 0.25;
const TOXIC_RADIUS = 4.5;
const FLASHER_RADIUS = 4.5;
const CHEATER_DODGE = 0.25;
const NOOB_BONUS = 20;
const SELL_REFUND = 0.75;
const AIRDROP_MONEY = 150;

export class Tower {
  readonly def: UnitDef;
  readonly id: string;
  /** Имя места, где стоит боец */
  readonly spot: Loc;
  /** На возвышенности: действует бонус высоты карты */
  readonly elevated: boolean;
  readonly pos: THREE.Vector3;
  readonly model: UnitModel;
  readonly marker: TowerMarker;
  readonly labelPos: THREE.Vector3;
  tier: TierIndex = 0;
  invested: number;
  priority: TargetPriority = 'first';
  cooldown = 0.4;
  kills = 0;
  streak = 0;
  streakTimer = 0;
  utilTimer = 1.5;
  lagTimer = 0;
  /** Ослеплён флешкой Флешера */
  blindTimer = 0;
  /** Рядом Токсик: темп стрельбы снижен */
  toxic = false;
  /** Сколько секунд у бойца нет цели — после паузы он встаёт в свою позу */
  idleT = 0;
  rampStacks = 0;
  lastTarget: Enemy | null = null;
  auraRange = 0;
  auraDmg = 0;
  auraRate = 0;
  auraEcon = 0;
  discount = 0;
  stats: TowerStats = { damage: 0, fireRate: 0, range: 0, dps: 0, dmgBonus: 0, rateBonus: 0, rangeBonus: 0 };

  constructor(def: UnitDef, id: string, spot: SpotProbe, cost: number) {
    this.def = def;
    this.id = id;
    this.spot = spot.name;
    this.elevated = spot.elevated;
    this.invested = cost;
    this.pos = spot.pos.clone();
    this.labelPos = this.pos.clone().setY(this.pos.y + 2.55);
    this.model = new UnitModel(def, 0);
    this.model.root.position.copy(this.pos);
    this.marker = new TowerMarker(ROLE_COLORS[def.role]);
    this.marker.group.position.copy(this.pos);
    this.marker.hit.userData.towerId = id;
  }
}

export class Enemy {
  readonly def: EnemyDef;
  readonly route: RoutePath;
  readonly model: EnemyModel;
  readonly lane: number;
  readonly pos = new THREE.Vector3();
  hp: number;
  maxHp: number;
  shield: number;
  maxShield: number;
  speed: number;
  dist = 0;
  alive = true;
  stun = 0;
  slowTimer = 0;
  slowFactor = 1;
  special: number;
  lastHit = -10;
  inSmoke = false;
  /** Неуязвимость (откат Лаггера) */
  invuln = 0;
  /** Лаггер ждёт окончания отката, чтобы сделать рывок вперёд */
  lunge = false;
  progress = 0;

  constructor(def: EnemyDef, route: RoutePath, hpMul: number, speedMul: number) {
    this.def = def;
    this.route = route;
    this.model = new EnemyModel(def.kind);
    this.maxHp = this.hp = def.hp * hpMul;
    this.maxShield = this.shield = def.shield * hpMul;
    this.speed = def.speed * speedMul;
    this.lane = def.flying || def.kind === 'spinbot' ? 0 : (Math.random() - 0.5) * 0.9;
    this.special = 1 + Math.random() * 2;
  }

  hitPoint(out: THREE.Vector3): THREE.Vector3 {
    const h = this.def.flying ? 0.05 : this.def.kind === 'spinbot' ? 2.0 : this.def.kind === 'ping' ? 1.1 : 1.2;
    return out.copy(this.pos).setY(this.pos.y + h);
  }
}

interface ThrowFx {
  obj: THREE.Group;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  dur: number;
  kind: ThrowableKind;
  tower: Tower;
}

interface FireDmg {
  vis: FireZoneVis;
  dps: number;
  tower: Tower | null;
}

interface SlowZone {
  pos: THREE.Vector3;
  radius: number;
  factor: number;
  life: number;
  pulse: number;
}

function hdist2(a: THREE.Vector3, b: THREE.Vector3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

export class Game {
  readonly map: MapDef;
  readonly squad: UnitDef[];
  readonly waves: WaveDef[];
  readonly maxHp: number;
  readonly towers = new Map<string, Tower>();
  readonly enemies: Enemy[] = [];
  money: number;
  hp: number;
  waveIndex = 0;
  phase: 'prep' | 'wave' | 'ended' = 'prep';
  speed: 1 | 2 = 1;
  autoWave = false;
  autoTimer = 0;
  forceBuyActive = false;
  airdropsLeft = 2;
  kills = 0;
  placing: UnitDef | null = null;
  selected: Tower | null = null;
  /** Место, выбранное тапом по карте (без активной установки): рядом открывается выбор бойца */
  picked: SpotProbe | null = null;
  /** Место под курсором мыши */
  hoverSpot: SpotProbe | null = null;

  private scene: SceneManager;
  private sound: SoundFX;
  private built: BuiltMap;
  private labels: LabelLayer;
  private cb: GameCallbacks;
  private routes: RoutePath[];
  private root = new THREE.Group();
  private queue: { t: number; kind: EnemyKind }[] = [];
  private waveTime = 0;
  private time = 0;
  private smokes: SmokeVis[] = [];
  /** Живые Токсики на этом шаге (для ауры) */
  private toxics: Enemy[] = [];
  private fires: FireDmg[] = [];
  private slowZones: SlowZone[] = [];
  private throws: ThrowFx[] = [];
  private raycaster = new THREE.Raycaster();
  private placement: Placement;
  private cursor = new PlacementCursor();
  private cursorLabelPos = new THREE.Vector3();
  private pointer: { x: number; y: number } | null = null;
  private hoverTower: Tower | null = null;
  private towerSeq = 0;
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private v3 = new THREE.Vector3();

  constructor(scene: SceneManager, sound: SoundFX, built: BuiltMap, map: MapDef, squad: UnitDef[], labels: LabelLayer, cb: GameCallbacks) {
    this.scene = scene;
    this.sound = sound;
    this.built = built;
    this.map = map;
    this.squad = squad;
    this.labels = labels;
    this.cb = cb;
    this.waves = buildAllWaves(map);
    this.money = map.startMoney;
    this.hp = this.maxHp = map.baseHp;
    this.routes = map.routes.map((r) => new RoutePath(r));
    scene.world.add(this.root);
    this.placement = new Placement(map, built);
    this.root.add(this.cursor.group);
    built.plant.setHealth(1);

    map.callouts.forEach((c, i) => {
      labels.add(`callout-${i}`, new THREE.Vector3(c.p[0], c.p[1] + 1.2, c.p[2]), loc(c.name), 'lbl-callout', 110);
    });
    labels.add('cursor', this.cursorLabelPos, '', 'lbl-slot', 400);
    labels.setVisible('cursor', false);
  }

  dispose(): void {
    for (const tw of this.towers.values()) {
      tw.model.dispose();
      tw.marker.dispose();
    }
    for (const e of this.enemies) e.model.dispose();
    for (const th of this.throws) th.obj.removeFromParent();
    this.root.removeFromParent();
    this.labels.clear();
    this.scene.hideRange();
    this.sound.bossDrone(false);
  }

  /* ------------------------------ Геттеры -------------------------------- */

  get nextWave(): WaveDef | null {
    return this.waves[this.waveIndex] ?? null;
  }

  get currentWave(): WaveDef | null {
    return this.waveIndex > 0 ? this.waves[this.waveIndex - 1] : null;
  }

  get forceBuyCost(): number {
    return 120 + 10 * (this.waveIndex + 1);
  }

  get aliveEnemies(): number {
    let n = this.queue.length;
    for (const e of this.enemies) if (e.alive) n++;
    return n;
  }

  get bankRate(): { rate: number; cap: number } {
    for (const tw of this.towers.values()) {
      if (tw.def.passive.kind === 'saver') return { rate: tw.def.passive.a, cap: tw.def.passive.b };
    }
    return { rate: 0.05, cap: 50 };
  }

  upgradeCost(tw: Tower): number | null {
    if (tw.tier >= 2) return null;
    return Math.round(tw.def.tiers[tw.tier + 1].cost * (1 - tw.discount));
  }

  sellValue(tw: Tower): number {
    return Math.floor(tw.invested * SELL_REFUND);
  }

  /** Бонусы высоты карты, которые получит боец этой роли (пусто — бонуса нет) */
  highGroundBonus(unit: UnitDef): { range: number; damage: number; fireRate: number } {
    const out = { range: 0, damage: 0, fireRate: 0 };
    for (const b of this.map.highGround) {
      if (b.role && b.role !== unit.role) continue;
      out.range += b.range ?? 0;
      out.damage += b.damage ?? 0;
      out.fireRate += b.fireRate ?? 0;
    }
    return out;
  }

  /** Предпросмотр дальности юнита на месте установки */
  previewRange(unit: UnitDef, elevated: boolean): number {
    return unit.tiers[0].range * (1 + (elevated ? this.highGroundBonus(unit).range : 0));
  }

  /** Текст причины, почему здесь нельзя поставить бойца */
  spotFailText(reason: SpotFail | null): string {
    return reason ? t(`spot_${reason}` satisfies DictKey) : '';
  }

  private towerPositions(): THREE.Vector3[] {
    const out: THREE.Vector3[] = [];
    for (const tw of this.towers.values()) out.push(tw.pos);
    return out;
  }

  /* ------------------------------ Действия ------------------------------- */

  startWave(): void {
    if (this.phase !== 'prep' || this.waveIndex >= this.waves.length) return;
    const w = this.waves[this.waveIndex];
    this.waveIndex++;
    this.queue = [];
    for (const g of w.groups) {
      for (let i = 0; i < g.count; i++) this.queue.push({ t: g.delay + i * g.interval, kind: g.kind });
    }
    this.queue.sort((a, b) => a.t - b.t);
    this.waveTime = 0;
    this.phase = 'wave';
    this.sound.waveStart();
    if (w.boss) {
      this.sound.boss();
      this.sound.bossDrone(true);
      this.cb.toast(t('bossIncoming'), 'bad');
    } else {
      this.cb.toast(`${t('wave')} ${w.number}: ${loc(w.name)}`, 'info');
    }
    for (const p of this.built.portals) this.scene.shockwave(p.getWorldPosition(this.v1).setY(0.2), 3.5, 0xff3344, 0.8);
  }

  toggleSpeed(): void {
    this.speed = this.speed === 1 ? 2 : 1;
  }

  toggleAuto(): void {
    this.autoWave = !this.autoWave;
    if (this.autoWave && this.phase === 'prep') this.autoTimer = 4;
  }

  beginPlacement(unit: UnitDef): void {
    if (this.phase === 'ended') return;
    if (this.picked) {
      this.placeAt(this.picked.pos, unit);
      return;
    }
    this.placing = this.placing?.id === unit.id ? null : unit;
    this.selected = null;
    this.picked = null;
    this.cb.selectionChanged();
    this.cb.spotPicked();
    if (this.placing) this.cb.toast(t('selectSpot'), 'info');
  }

  cancelPlacement(): void {
    this.placing = null;
    this.picked = null;
    this.cb.spotPicked();
    this.cb.selectionChanged();
  }

  /** Поставить бойца в точку (координаты на поверхности; место перепроверяется) */
  placeAt(at: THREE.Vector3 | Vec3T, unit: UnitDef): boolean {
    if (this.phase === 'ended') return false;
    const [x, y, z] = Array.isArray(at) ? at : [at.x, at.y, at.z];
    const spot = this.placement.probeAt(x, y, z, this.towerPositions());
    if (!spot || !spot.ok) {
      this.cb.toast(spot ? this.spotFailText(spot.reason) : t('spot_surface'), 'bad');
      this.sound.error();
      return false;
    }
    const cost = unit.tiers[0].cost;
    if (this.money < cost) {
      this.cb.toast(t('notEnoughMoney'), 'bad');
      this.sound.error();
      return false;
    }
    this.money -= cost;
    const id = `t${++this.towerSeq}`;
    const tw = new Tower(unit, id, spot, cost);
    // Повернуть лицом к ближайшей точке маршрута
    let best = Infinity;
    for (const r of this.routes) {
      for (const p of r.pts) {
        const d = hdist2(p, tw.pos);
        if (d < best) {
          best = d;
          tw.model.aim(Math.atan2(p.x - tw.pos.x, p.z - tw.pos.z), 1);
        }
      }
    }
    this.root.add(tw.model.root, tw.marker.group);
    this.towers.set(id, tw);
    this.labels.add(`tower-${id}`, tw.labelPos, this.tierBadge(tw), 'lbl-tier', 90);
    this.placing = null;
    this.picked = null;
    this.hoverSpot = null;
    this.cb.spotPicked();
    this.sound.place();
    this.scene.shockwave(tw.pos, 2.2, ROLE_COLORS[unit.role], 0.6);
    this.scene.sparks(tw.pos.clone().setY(tw.pos.y + 0.4), ROLE_COLORS[unit.role], 12, 3);
    this.cb.toast(t('placed', { nick: unit.nick, slot: loc(spot.name) }), 'good');
    // На телефоне карточка бойца закрыла бы полкарты — открываем её только по тапу на бойца
    if (window.innerWidth > 520 && window.innerHeight > 520) this.select(tw);
    else this.cb.selectionChanged();
    return true;
  }

  select(tw: Tower | null): void {
    this.selected = tw;
    if (tw) {
      this.picked = null;
      this.sound.click();
    }
    this.cb.selectionChanged();
  }

  deselect(): void {
    this.selected = null;
    this.picked = null;
    this.placing = null;
    this.cb.spotPicked();
    this.cb.selectionChanged();
  }

  upgradeSelected(): void {
    const tw = this.selected;
    if (!tw) return;
    const cost = this.upgradeCost(tw);
    if (cost === null) return;
    if (this.money < cost) {
      this.cb.toast(t('notEnoughMoney'), 'bad');
      this.sound.error();
      return;
    }
    this.money -= cost;
    tw.invested += cost;
    tw.tier = (tw.tier + 1) as TierIndex;
    tw.model.setTier(tw.tier);
    this.labels.setHtml(`tower-${tw.id}`, this.tierBadge(tw));
    this.sound.upgrade();
    this.scene.shockwave(tw.pos, 2.6, 0xf59e0b, 0.7);
    this.scene.sparks(tw.pos.clone().setY(tw.pos.y + 1.4), 0xf59e0b, 18, 4);
    this.cb.toast(t('upgraded', { nick: tw.def.nick, tier: tw.tier + 1, weapon: weaponName(tw.def.tiers[tw.tier].weapon) }), 'gold');
    this.cb.selectionChanged();
  }

  sellSelected(): void {
    const tw = this.selected;
    if (!tw) return;
    const refund = this.sellValue(tw);
    this.money += refund;
    tw.model.dispose();
    tw.marker.dispose();
    this.towers.delete(tw.id);
    this.labels.remove(`tower-${tw.id}`);
    if (this.hoverTower === tw) this.hoverTower = null;
    this.selected = null;
    this.sound.sell();
    this.scene.sparks(tw.pos.clone().setY(tw.pos.y + 1), 0xfacc15, 14, 3);
    this.cb.toast(t('sold', { amount: refund }), 'gold');
    this.cb.selectionChanged();
  }

  cyclePriority(): void {
    const tw = this.selected;
    if (!tw) return;
    const i = PRIORITIES.indexOf(tw.priority);
    tw.priority = PRIORITIES[(i + 1) % PRIORITIES.length];
    this.sound.click();
    this.cb.toast(t('priorityChanged', { p: priorityName(tw.priority) }), 'info');
    this.cb.selectionChanged();
  }

  buyForce(): void {
    if (this.phase !== 'prep') {
      this.cb.toast(t('forceBuyOnlyPrep'), 'bad');
      this.sound.error();
      return;
    }
    if (this.forceBuyActive) return;
    const cost = this.forceBuyCost;
    if (this.money < cost) {
      this.cb.toast(t('notEnoughMoney'), 'bad');
      this.sound.error();
      return;
    }
    this.money -= cost;
    this.forceBuyActive = true;
    this.sound.upgrade();
    for (const tw of this.towers.values()) this.scene.shockwave(tw.pos, 1.8, 0xef4444, 0.6);
    this.cb.toast(t('forceBuyBought'), 'gold');
  }

  grantAirdrop(): void {
    if (this.airdropsLeft <= 0) return;
    this.airdropsLeft--;
    this.money += AIRDROP_MONEY;
    this.sound.coin();
    this.scene.shockwave(this.built.plantPos, 4, 0x22c55e, 0.8);
    this.cb.toast(t('airdropGot'), 'gold');
  }

  /* ----------------------------- Ввод мышью ------------------------------ */

  private setRay(x: number, y: number): void {
    const ndc = new THREE.Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.scene.camera);
  }

  /** Боец под лучом (по невидимым хит-боксам меток) */
  private rayTower(): Tower | null {
    let best: Tower | null = null;
    let bestD = Infinity;
    for (const tw of this.towers.values()) {
      const hit = this.raycaster.intersectObject(tw.marker.hit, false)[0];
      if (hit && hit.distance < bestD) {
        bestD = hit.distance;
        best = tw;
      }
    }
    return best;
  }

  tap(x: number, y: number): void {
    if (this.phase === 'ended') return;
    this.setRay(x, y);
    const tw = this.rayTower();
    if (this.placing) {
      if (tw) {
        this.placing = null;
        this.select(tw);
        return;
      }
      const spot = this.placement.probeRay(this.raycaster, this.towerPositions());
      if (!spot) return;
      if (spot.ok) this.placeAt(spot.pos, this.placing);
      else {
        this.cb.toast(this.spotFailText(spot.reason), 'bad');
        this.sound.error();
      }
      return;
    }
    if (tw) {
      this.select(tw);
      return;
    }
    // Первый тап по пустому месту закрывает панель, следующий — выбирает место
    if (this.selected || this.picked) {
      this.deselect();
      return;
    }
    const spot = this.placement.probeRay(this.raycaster, this.towerPositions());
    if (!spot || spot.reason === 'bounds') return;
    if (!spot.ok) {
      this.cb.toast(this.spotFailText(spot.reason), 'bad');
      return;
    }
    this.picked = spot;
    this.sound.click();
    this.cb.selectionChanged();
    this.cb.spotPicked();
  }

  hover(x: number, y: number): void {
    this.pointer = x < 0 ? null : { x, y };
  }

  /** Пересчёт места под курсором (раз в кадр: камера может двигаться и при неподвижной мыши) */
  private updateHover(): void {
    if (!this.pointer || this.phase === 'ended') {
      this.hoverSpot = null;
      this.hoverTower = null;
      return;
    }
    this.setRay(this.pointer.x, this.pointer.y);
    this.hoverTower = this.rayTower();
    this.hoverSpot = this.placing && !this.hoverTower ? this.placement.probeRay(this.raycaster, this.towerPositions()) : null;
  }

  /* ------------------------------ Главный цикл --------------------------- */

  update(dtReal: number): void {
    const dt = Math.min(dtReal, 0.05);
    if (this.phase !== 'ended') {
      for (let i = 0; i < this.speed; i++) this.step(dt);
    }
    this.updateHover();
    this.updateVisualState(dtReal);
  }

  private step(dt: number): void {
    this.time += dt;

    if (this.phase === 'prep' && this.autoWave && this.waveIndex < this.waves.length) {
      this.autoTimer -= dt;
      if (this.autoTimer <= 0) this.startWave();
    }

    if (this.phase === 'wave') {
      this.waveTime += dt;
      while (this.queue.length && this.queue[0].t <= this.waveTime) {
        const q = this.queue.shift()!;
        this.spawn(q.kind);
      }
    }

    this.toxics = this.enemies.filter((e) => e.alive && e.def.kind === 'toxic');
    this.computeAuras();
    for (const tw of this.towers.values()) this.computeStats(tw);

    this.updateEnemies(dt);
    for (const e of this.enemies) e.inSmoke = e.alive && this.isInSmoke(e);
    for (const tw of this.towers.values()) this.updateTower(tw, dt);
    this.updateThrows(dt);
    this.updateZones(dt);

    for (let i = this.enemies.length - 1; i >= 0; i--) if (!this.enemies[i].alive) this.enemies.splice(i, 1);
    this.smokes = this.smokes.filter((s) => s.alive);

    if (this.phase === 'wave' && this.queue.length === 0 && this.enemies.length === 0) this.waveComplete();
  }

  /* -------------------------------- Враги -------------------------------- */

  private spawn(kind: EnemyKind): void {
    const def = ENEMIES[kind];
    const cands = this.routes.filter((r) => !r.def.fastOnly || def.fast);
    let total = 0;
    for (const r of cands) total += r.def.weight;
    let pick = Math.random() * total;
    let route = cands[0];
    for (const r of cands) {
      pick -= r.def.weight;
      if (pick <= 0) {
        route = r;
        break;
      }
    }
    const w = this.currentWave;
    let hpMul = w ? w.hpMul : 1;
    // Босс растёт по волнам мягче обычных врагов: позиции делятся между маршрутами,
    // и в каждой точке его достают лишь 1–3 бойца
    if (kind === 'spinbot') hpMul = 1 + (hpMul - 1) * 0.65;
    const speedMul = 1 + 0.012 * Math.max(0, this.waveIndex - 1);
    const e = new Enemy(def, route, hpMul, speedMul);
    this.placeEnemy(e);
    this.root.add(e.model.root);
    this.enemies.push(e);
  }

  private placeEnemy(e: Enemy): void {
    e.route.sample(e.dist, e.pos);
    const dir = e.route.direction(e.dist, this.v1);
    e.pos.x += -dir.z * e.lane;
    e.pos.z += dir.x * e.lane;
    if (e.def.flying) e.pos.y += 3.4;
    e.model.root.position.copy(e.pos);
    e.model.body.rotation.y = Math.atan2(dir.x, dir.z);
    e.progress = e.dist / e.route.length;
  }

  private updateEnemies(dt: number): void {
    const screamers = this.enemies.filter((e) => e.alive && e.def.kind === 'screamer');
    for (const e of this.enemies) {
      if (!e.alive) continue;
      let mul = 1;
      if (e.stun > 0) {
        e.stun -= dt;
        mul = 0;
      }
      if (e.slowTimer > 0) {
        e.slowTimer -= dt;
        mul *= e.slowFactor;
      } else e.slowFactor = 1;
      for (const s of screamers) {
        if (s !== e && hdist2(s.pos, e.pos) < 3.2 * 3.2) {
          mul *= 1.35;
          break;
        }
      }

      // Особые способности
      e.special -= dt;
      switch (e.def.kind) {
        case 'ping':
          if (e.special <= 0 && e.stun <= 0) {
            e.special = 2.2 + Math.random() * 1.4;
            this.scene.sparks(e.hitPoint(this.v1), 0x22ff88, 10, 3);
            e.dist = Math.min(e.route.length - 0.5, e.dist + 3.4);
            this.placeEnemy(e);
            this.scene.sparks(e.hitPoint(this.v1), 0xff3b3b, 10, 3);
            this.sound.lag();
          }
          break;
        case 'smoker':
          if (e.special <= 0) {
            e.special = 7;
            const s = this.scene.addSmoke(e.pos.clone().setY(e.route.sample(e.dist, this.v2).y), 3.2, 6.5);
            this.smokes.push(s);
          }
          break;
        case 'ddos':
          if (e.special <= 0) {
            const near = [...this.towers.values()]
              .map((tw) => ({ tw, d: hdist2(tw.pos, e.pos) }))
              .filter((o) => o.d < 4.8 * 4.8)
              .sort((a, b) => a.d - b.d)
              .slice(0, 2);
            if (near.length) {
              e.special = 4;
              for (const { tw } of near) {
                tw.lagTimer = 1.7;
                this.scene.tracer(e.pos, tw.labelPos.clone().setY(tw.pos.y + 1.5), 0xff2d55, 0.07, 0.25);
              }
              this.sound.lag();
            } else e.special = 0.3;
          }
          break;
        case 'spinbot':
          // Щит восстанавливается, только если босс 4 с не получал урона
          if (this.time - e.lastHit > 4 && e.shield < e.maxShield) e.shield = Math.min(e.maxShield, e.shield + e.maxShield * 0.06 * dt);
          e.model.setShield(e.maxShield > 0 ? e.shield / e.maxShield : 0);
          break;
        case 'lagger':
          // Откат: 0.25 с неуязвимости, сброс прицела башен, шаг назад — затем рывок вперёд
          if (e.special <= 0 && e.stun <= 0 && !e.lunge) {
            e.special = 3.5;
            e.invuln = 0.25;
            e.lunge = true;
            e.dist = Math.max(0, e.dist - 1);
            for (const tw of this.towers.values()) {
              if (tw.lastTarget === e) {
                tw.lastTarget = null;
                tw.rampStacks = 0;
              }
            }
            this.scene.sparks(e.hitPoint(this.v1), 0xa855f7, 10, 3);
            this.sound.lag();
          }
          break;
        case 'flasher':
          if (e.special <= 0) {
            e.special = 5;
            this.popFlash(e);
          }
          break;
        default:
          break;
      }
      if (e.invuln > 0) {
        e.invuln -= dt;
        if (e.invuln <= 0 && e.lunge) {
          e.lunge = false;
          e.dist = Math.min(e.route.length - 0.5, e.dist + 2.5);
          this.placeEnemy(e);
          this.scene.sparks(e.hitPoint(this.v1), 0xff3b3b, 12, 4);
        }
      }

      e.dist += e.speed * mul * dt;
      if (e.dist >= e.route.length) {
        this.enemyReachedBase(e);
        continue;
      }
      this.placeEnemy(e);
      e.model.update(dt, mul, e.stun > 0, this.scene.camera);
      const showBar = e.def.kind === 'spinbot' || e.hp < e.maxHp - 0.01;
      e.model.hp.group.visible = showBar;
      if (showBar) e.model.hp.set(e.hp / e.maxHp, e.maxShield > 0 ? e.shield / e.maxShield : 0);
    }
  }

  private enemyReachedBase(e: Enemy): void {
    e.alive = false;
    e.model.dispose();
    const dmg = e.def.baseDamage;
    this.hp = Math.max(0, this.hp - dmg);
    this.built.plant.hit();
    this.built.plant.setHealth(this.hp / this.maxHp);
    this.scene.shockwave(this.built.plantPos, 3, 0xef4444, 0.6);
    this.scene.addShake(dmg >= 5 ? 0.6 : 0.2);
    this.sound.baseHit();
    this.cb.toast(t('baseHit', { n: dmg }), 'bad');
    if (this.hp <= 0) this.finish(false);
  }

  private isInSmoke(e: Enemy): boolean {
    if (e.def.flying) return false;
    for (const s of this.smokes) {
      if (s.solid && hdist2(e.pos, s.pos) < s.radius * s.radius * 0.9) return true;
    }
    return false;
  }

  private clearSmokes(pos: THREE.Vector3, radius: number): void {
    for (const s of this.smokes) {
      if (s.alive && s.solid && hdist2(s.pos, pos) < (radius + s.radius * 0.6) ** 2) s.dissipate();
    }
  }

  /* -------------------------------- Башни -------------------------------- */

  private computeAuras(): void {
    for (const tw of this.towers.values()) {
      tw.auraRange = tw.auraDmg = tw.auraRate = tw.auraEcon = tw.discount = 0;
    }
    for (const src of this.towers.values()) {
      const p = src.def.passive;
      if (!p.kind.startsWith('aura')) continue;
      const k = 1 + src.tier * 0.25;
      const r2 = p.b * p.b;
      for (const tw of this.towers.values()) {
        if (tw === src || hdist2(tw.pos, src.pos) > r2) continue;
        switch (p.kind) {
          case 'auraSpeed':
            tw.auraRate = Math.max(tw.auraRate, p.a * k);
            break;
          case 'auraDamage':
            tw.auraDmg = Math.max(tw.auraDmg, p.a * k);
            break;
          case 'auraRange':
            tw.auraRange = Math.max(tw.auraRange, p.a * k);
            break;
          case 'auraEcon':
            tw.auraEcon = Math.max(tw.auraEcon, p.a + src.tier);
            break;
          case 'auraDiscount':
            tw.discount = Math.max(tw.discount, Math.min(0.4, p.a * k));
            break;
          default:
            break;
        }
      }
    }
  }

  private computeStats(tw: Tower): void {
    const base = tw.def.tiers[tw.tier];
    let rangeB = tw.auraRange;
    let dmgB = tw.auraDmg;
    let rateB = tw.auraRate;
    if (tw.elevated) {
      const hg = this.highGroundBonus(tw.def);
      rangeB += hg.range;
      dmgB += hg.damage;
      rateB += hg.fireRate;
    }
    if (this.forceBuyActive) dmgB += FORCE_BUY_BONUS;
    if (tw.def.passive.kind === 'killStreak') rateB += tw.streak * tw.def.passive.a;
    // Аура Токсика: −25% к темпу стрельбы (несколько Токсиков не складываются)
    tw.toxic = this.toxics.some((e) => hdist2(e.pos, tw.pos) < TOXIC_RADIUS * TOXIC_RADIUS);
    const rateMul = (1 + rateB) * (tw.toxic ? 0.75 : 1);
    const s = tw.stats;
    s.damage = base.damage * (1 + dmgB);
    s.fireRate = base.fireRate * rateMul;
    s.range = base.range * (1 + rangeB);
    s.dps = s.damage * s.fireRate;
    s.dmgBonus = dmgB;
    s.rateBonus = rateMul - 1;
    s.rangeBonus = rangeB;
  }

  private findTarget(tw: Tower): Enemy | null {
    const r2 = tw.stats.range * tw.stats.range;
    const seesSmoke = tw.def.passive.kind === 'smokeSight';
    let best: Enemy | null = null;
    let bestScore = -Infinity;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d2 = hdist2(e.pos, tw.pos);
      if (d2 > r2) continue;
      if (e.inSmoke && !seesSmoke) continue;
      let score: number;
      switch (tw.priority) {
        case 'first':
          score = e.progress;
          break;
        case 'last':
          score = -e.progress;
          break;
        case 'strong':
          score = e.hp + e.shield;
          break;
        case 'close':
          score = -d2;
          break;
      }
      if (score > bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  private updateTower(tw: Tower, dt: number): void {
    tw.model.update(dt);
    if (tw.streakTimer > 0) {
      tw.streakTimer -= dt;
      if (tw.streakTimer <= 0) tw.streak = 0;
    }
    if (tw.blindTimer > 0) tw.blindTimer -= dt;
    if (tw.lagTimer > 0 || tw.blindTimer > 0) {
      tw.lagTimer = Math.max(0, tw.lagTimer - dt);
      tw.idleT = 0;
      tw.model.setPosing(false);
      tw.model.idle(dt * 4);
      return;
    }
    // Небольшой «перенос» перезарядки допустим для ровного темпа, но не накопление очереди выстрелов в простое
    tw.cooldown = Math.max(-0.05, tw.cooldown - dt);
    if (UTILITY.has(tw.def.passive.kind)) this.tryUtility(tw, dt);
    const target = this.findTarget(tw);
    if (!target) {
      tw.idleT += dt;
      if (tw.idleT > 1.2) tw.model.setPosing(true);
      tw.model.idle(dt);
      tw.rampStacks = 0;
      return;
    }
    tw.idleT = 0;
    tw.model.setPosing(false);
    tw.model.aim(Math.atan2(target.pos.x - tw.pos.x, target.pos.z - tw.pos.z), dt);
    // Стрельба — только когда боец уже вскинул оружие (выход из позы занимает ~0.15 с)
    if (tw.cooldown <= 0 && tw.model.poseWeight < 0.3) {
      tw.cooldown += 1 / Math.max(0.05, tw.stats.fireRate);
      this.fire(tw, target);
    }
  }

  private fire(tw: Tower, target: Enemy): void {
    const base = tw.def.tiers[tw.tier];
    const p = tw.def.passive;
    let dmg = tw.stats.damage;
    let crit = false;
    switch (p.kind) {
      case 'openingDuel':
        if (target.hp >= target.maxHp - 0.5) dmg *= 1 + p.a;
        break;
      case 'rampUp':
        tw.rampStacks = tw.lastTarget === target ? Math.min(Math.round(p.b / p.a), tw.rampStacks + 1) : 0;
        dmg *= 1 + tw.rampStacks * p.a;
        break;
      case 'cleanup':
        if (target.progress >= p.b) dmg *= 1 + p.a;
        break;
      case 'backstab': {
        const dir = target.route.direction(target.dist, this.v1);
        const vx = target.pos.x - tw.pos.x;
        const vz = target.pos.z - tw.pos.z;
        if (dir.x * vx + dir.z * vz > 0) dmg *= 1 + p.a;
        break;
      }
      case 'smokeSight':
        if (target.inSmoke) dmg *= 1 + p.a;
        break;
      case 'crit':
        if (Math.random() < p.a) {
          dmg *= p.b;
          crit = true;
        }
        break;
      case 'headshot':
        if (Math.random() < p.a) {
          crit = true;
          dmg = target.def.kind === 'spinbot' ? dmg * 3 : 1e9;
        }
        break;
      default:
        break;
    }
    tw.lastTarget = target;

    // Визуал выстрела
    const sniper = SNIPERS.has(base.weapon);
    const muzzle = tw.model.muzzleWorld(this.v1);
    const hit = target.hitPoint(this.v2);
    this.scene.tracer(muzzle, hit, sniper ? 0xe0f7ff : crit ? 0xff6b6b : 0xffd27a, sniper ? 0.085 : 0.045, sniper ? 0.18 : 0.07);
    this.scene.muzzleFlash(muzzle, 0xffc35a, sniper ? 1.5 : base.weapon === 'shotgun' ? 1.3 : 0.85);
    this.scene.sparks(hit, crit ? 0xff4d4d : 0xffd27a, crit ? 10 : 4, crit ? 5 : 3);
    tw.model.recoil();
    this.sound.shot(base.weapon);
    if (crit) this.sound.crit();

    if (this.dodges(target, dmg)) this.scene.sparks(hit, 0x22c55e, 10, 4);
    else this.damage(target, dmg, base.pen, tw);

    // Прострел по линии
    if (p.kind === 'pierce') {
      const ax = target.pos.x - tw.pos.x;
      const az = target.pos.z - tw.pos.z;
      const len = Math.hypot(ax, az) || 1;
      const ux = ax / len;
      const uz = az / len;
      let left = p.a;
      for (const e of this.enemies) {
        if (left <= 0) break;
        if (!e.alive || e === target) continue;
        const ex = e.pos.x - tw.pos.x;
        const ez = e.pos.z - tw.pos.z;
        const along = ex * ux + ez * uz;
        if (along < len - 0.5 || along > tw.stats.range * 1.3) continue;
        const perp = Math.abs(ex * uz - ez * ux);
        if (perp > 0.9) continue;
        left--;
        if (this.dodges(e, dmg)) {
          this.scene.sparks(e.hitPoint(this.v3), 0x22c55e, 8, 3);
          continue;
        }
        this.scene.sparks(e.hitPoint(this.v3), 0xe0f7ff, 4, 3);
        this.damage(e, dmg * p.b, base.pen, tw);
      }
    }

    // Сплеш и шрапнель
    const splash = Math.max(base.splash, p.kind === 'shrapnel' ? p.b : 0);
    if (splash > 0) {
      const k = p.kind === 'shrapnel' ? p.a : 0.5;
      const r2 = splash * splash;
      const center = target.pos.clone();
      for (const e of this.enemies) {
        if (!e.alive || e === target) continue;
        if (hdist2(e.pos, center) > r2) continue;
        this.damage(e, dmg * k, base.pen, tw);
      }
      this.scene.shockwave(center, splash, 0xffb347, 0.25);
    }

    // Казнь раненых
    if (p.kind === 'execute' && target.alive && target.def.kind !== 'spinbot' && target.hp / target.maxHp < p.a) {
      this.scene.sparks(target.hitPoint(this.v3), 0xc084fc, 14, 4);
      this.damage(target, 1e9, 1, tw);
    }
  }

  /**
   * Читер уклоняется от прямых выстрелов (и прострела) с шансом 25%.
   * Сплеш, огонь, HE-гранаты, хедшоты с мгновенным убийством и казнь не уклоняются.
   */
  private dodges(e: Enemy, dmg: number): boolean {
    return e.def.kind === 'cheater' && dmg < 1e8 && Math.random() < CHEATER_DODGE;
  }

  /** Флешка Флешера: ослепляет 1–2 ближайшие башни в радиусе */
  private popFlash(e: Enemy): void {
    const near = [...this.towers.values()]
      .map((tw) => ({ tw, d: hdist2(tw.pos, e.pos) }))
      .filter((o) => o.d < FLASHER_RADIUS * FLASHER_RADIUS)
      .sort((a, b) => a.d - b.d)
      .slice(0, 2);
    for (const { tw } of near) tw.blindTimer = Math.max(tw.blindTimer, 1.4);
    this.scene.flashBang(e.pos, 2.4);
    this.sound.flash();
  }

  private damage(e: Enemy, amount: number, pen: number, tw: Tower | null): boolean {
    if (!e.alive || e.invuln > 0) return false;
    const eff = amount >= 1e8 ? amount : amount * (1 - e.def.armor * (1 - pen));
    e.lastHit = this.time;
    let rest = eff;
    if (e.shield > 0) {
      const a = Math.min(e.shield, rest);
      e.shield -= a;
      rest -= a;
    }
    e.hp -= rest;
    if (e.hp <= 0) {
      this.kill(e, tw);
      return true;
    }
    return false;
  }

  private kill(e: Enemy, tw: Tower | null): void {
    e.alive = false;
    let reward = e.def.reward + Math.floor(this.waveIndex / 3);
    if (tw) {
      tw.kills++;
      reward += tw.auraEcon;
      const p = tw.def.passive;
      if (p.kind === 'killStreak') {
        tw.streak = Math.min(p.b, tw.streak + 1);
        tw.streakTimer = p.c;
      }
    }
    this.money += reward;
    this.kills++;
    const hp = e.hitPoint(this.v3);
    this.scene.sparks(hp, e.def.color, 12, 4);
    for (let i = 0; i < 6; i++) {
      this.scene.particle(
        {
          pos: hp,
          vel: new THREE.Vector3((Math.random() - 0.5) * 2, 1 + Math.random() * 2, (Math.random() - 0.5) * 2),
          life: 0.8,
          size0: 0.5,
          size1: 1.2,
          color: 0x52525b,
          color1: 0x27272a,
          alpha: 0.5,
          drag: 1.5,
        },
        false,
      );
    }
    if (e.def.kind === 'spinbot') {
      this.scene.explosion(e.pos, 4);
      this.sound.grenade();
      this.sound.bossDrone(false);
      this.cb.toast(`+$${reward}`, 'gold');
    } else {
      this.sound.kill();
    }
    // Посмертные эффекты новых врагов
    if (e.def.kind === 'flasher') this.popFlash(e);
    if (e.def.kind === 'noob') {
      if (Math.random() < 0.5) {
        this.money += NOOB_BONUS;
        this.scene.sparks(hp, 0xfacc15, 16, 4);
        this.sound.coin();
      } else {
        const ground = e.route.sample(e.dist, this.v2).y;
        this.smokes.push(this.scene.addSmoke(e.pos.clone().setY(ground), 2.6, 3.0));
      }
    }
    e.model.dispose();
  }

  /* ------------------------------- Утилиты ------------------------------- */

  private tryUtility(tw: Tower, dt: number): void {
    tw.utilTimer -= dt;
    if (tw.utilTimer > 0) return;
    const p = tw.def.passive;
    const kind: ThrowableKind = p.kind === 'flash' ? 'flash' : p.kind === 'molotov' ? 'molotov' : p.kind === 'heGrenade' ? 'he' : 'trap';
    const range = tw.stats.range + 1;
    const r2 = range * range;
    const R = p.kind === 'flash' || p.kind === 'heGrenade' ? p.c : 2.4;
    let best: THREE.Vector3 | null = null;
    let bestCount = 0;
    for (const e of this.enemies) {
      if (!e.alive || e.def.flying || hdist2(e.pos, tw.pos) > r2) continue;
      let n = 0;
      for (const o of this.enemies) if (o.alive && !o.def.flying && hdist2(o.pos, e.pos) < R * R) n++;
      // предпочитаем цели в дыму — утилита его рассеет
      if (e.inSmoke) n += 2;
      if (n > bestCount) {
        bestCount = n;
        best = e.pos;
      }
    }
    if (!best) {
      for (const s of this.smokes) {
        if (s.solid && hdist2(s.pos, tw.pos) < r2) {
          best = s.pos;
          break;
        }
      }
    }
    if (!best) {
      tw.utilTimer = 0.4;
      return;
    }
    const from = tw.pos.clone().setY(tw.pos.y + 1.7);
    const to = best.clone();
    const obj = buildThrowable(kind);
    obj.position.copy(from);
    this.root.add(obj);
    this.throws.push({ obj, from, to, t: 0, dur: 0.5 + Math.sqrt(hdist2(from, to)) * 0.025, kind, tower: tw });
    tw.utilTimer = p.a;
  }

  private updateThrows(dt: number): void {
    for (const th of this.throws) {
      th.t += dt / th.dur;
      const k = Math.min(1, th.t);
      th.obj.position.lerpVectors(th.from, th.to, k);
      th.obj.position.y += Math.sin(Math.PI * k) * 3;
      th.obj.rotation.x += dt * 12;
      th.obj.rotation.z += dt * 7;
      if (th.kind === 'molotov' && Math.random() < 0.6) {
        this.scene.particle({ pos: th.obj.position, vel: new THREE.Vector3(0, 0.6, 0), life: 0.3, size0: 0.35, size1: 0.05, color: 0xffb347, color1: 0xb02000 });
      }
      if (th.t >= 1) this.resolveThrow(th);
    }
    this.throws = this.throws.filter((th) => th.t < 1);
  }

  private resolveThrow(th: ThrowFx): void {
    th.obj.removeFromParent();
    const tw = th.tower;
    const p = tw.def.passive;
    const power = 1 + 0.35 * tw.tier;
    const pos = th.to;
    switch (th.kind) {
      case 'flash': {
        const R = p.c;
        const stun = p.b * (1 + 0.15 * tw.tier);
        for (const e of this.enemies) {
          if (!e.alive || hdist2(e.pos, pos) > R * R) continue;
          // Босс и АФК-зомби почти не реагируют на флешки
          e.stun = Math.max(e.stun, e.def.kind === 'spinbot' || e.def.kind === 'afk' ? stun * 0.3 : stun);
        }
        this.clearSmokes(pos, R + 1);
        this.scene.flashBang(pos, R);
        this.sound.flash();
        break;
      }
      case 'molotov': {
        const R = 2.2 + 0.2 * tw.tier;
        const vis = this.scene.addFire(pos.clone(), R, p.c);
        this.fires.push({ vis, dps: p.b * power, tower: tw });
        this.clearSmokes(pos, R + 1);
        this.sound.molotov();
        break;
      }
      case 'he': {
        const R = p.c;
        const dmg = p.b * power;
        for (const e of this.enemies) {
          if (!e.alive || hdist2(e.pos, pos) > R * R) continue;
          this.damage(e, dmg, 0.5, tw);
        }
        this.clearSmokes(pos, R + 1.5);
        this.scene.explosion(pos, R);
        this.sound.grenade();
        break;
      }
      case 'trap': {
        this.slowZones.push({ pos: pos.clone(), radius: 2.6, factor: p.b, life: p.c + tw.tier, pulse: 0 });
        this.clearSmokes(pos, 3.2);
        this.scene.shockwave(pos, 2.6, 0x38bdf8, 0.6);
        this.sound.trap();
        break;
      }
    }
  }

  private updateZones(dt: number): void {
    for (const f of this.fires) {
      if (!f.vis.alive) continue;
      const r2 = f.vis.radius * f.vis.radius;
      for (const e of this.enemies) {
        if (!e.alive || e.def.flying || hdist2(e.pos, f.vis.pos) > r2) continue;
        this.damage(e, f.dps * dt, 0.6, f.tower && this.towers.has(f.tower.id) ? f.tower : null);
      }
    }
    this.fires = this.fires.filter((f) => f.vis.alive);
    for (const z of this.slowZones) {
      z.life -= dt;
      z.pulse -= dt;
      if (z.pulse <= 0) {
        z.pulse = 0.6;
        this.scene.shockwave(z.pos, z.radius, 0x38bdf8, 0.6);
      }
      const r2 = z.radius * z.radius;
      for (const e of this.enemies) {
        // АФК-зомби не замедляется
        if (!e.alive || e.def.flying || e.def.kind === 'afk' || hdist2(e.pos, z.pos) > r2) continue;
        e.slowTimer = 0.25;
        e.slowFactor = Math.min(e.slowFactor, 1 - z.factor);
      }
    }
    this.slowZones = this.slowZones.filter((z) => z.life > 0);
  }

  /* ---------------------------- Конец волны/матча ------------------------ */

  private waveComplete(): void {
    const w = this.waves[this.waveIndex - 1];
    const { rate, cap } = this.bankRate;
    const interest = Math.min(cap, Math.floor(this.money * rate));
    this.money += w.bonus + interest;
    this.forceBuyActive = false;
    this.sound.waveClear();
    this.sound.bossDrone(false);
    this.cb.toast(t('waveCleared', { n: w.number, bonus: w.bonus }), 'good');
    if (interest > 0) this.cb.toast(t('interest', { p: Math.round(rate * 100), amount: interest }), 'gold');
    if (this.waveIndex >= this.waves.length) {
      this.finish(true);
      return;
    }
    this.phase = 'prep';
    if (this.autoWave) this.autoTimer = 5;
  }

  private finish(victory: boolean): void {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    this.placing = null;
    this.picked = null;
    this.sound.bossDrone(false);
    if (victory) this.sound.victory();
    else this.sound.defeat();
    const cleared = victory ? this.waves.length : Math.max(0, this.waveIndex - 1);
    const d = this.map.difficulty;
    const credits = cleared * (10 + 2 * d) + (victory ? 150 + 50 * d : 0) + Math.floor(this.kills / 5);
    const idx = MAP_ORDER.indexOf(this.map.id);
    const next = victory && idx >= 0 && idx < MAP_ORDER.length - 1 ? MAP_ORDER[idx + 1] : null;
    this.cb.ended({
      mapId: this.map.id,
      victory,
      wavesCleared: cleared,
      totalWaves: this.waves.length,
      kills: this.kills,
      credits,
      hpLeft: this.hp,
      unlockedNext: next,
    });
  }

  /* ------------------------ Визуальные состояния UI ---------------------- */

  private tierBadge(tw: Tower): string {
    const c = roleColorCss(tw.def.role);
    if (tw.blindTimer > 0) return `<span class="tier-badge is-lag is-blind">${t('blind')}</span>`;
    if (tw.lagTimer > 0) return `<span class="tier-badge is-lag">${t('lag')}</span>`;
    const tox = tw.toxic ? ' is-toxic' : '';
    return `<span class="tier-badge${tox}" style="--c:${c}">T${tw.tier + 1}</span>`;
  }

  private updateVisualState(dt: number): void {
    // Метки бойцов
    for (const tw of this.towers.values()) {
      tw.marker.setState(this.selected === tw ? 'selected' : this.hoverTower === tw ? 'hover' : 'idle');
      tw.marker.update(dt);
      // Бейджи тиров, LAG и ослепления
      this.labels.setHtml(`tower-${tw.id}`, this.tierBadge(tw));
    }

    // Курсор установки: место под мышью в режиме установки или место, выбранное тапом
    const spot = this.placing ? this.hoverSpot : this.picked;
    if (spot && this.phase !== 'ended') {
      const color = this.placing ? ROLE_COLORS[this.placing.role] : 0x00f0ff;
      this.cursor.show(spot.pos, spot.ok, color);
      this.cursor.update(dt);
      this.cursorLabelPos.copy(spot.pos).setY(spot.pos.y + 1.15);
      const star = spot.elevated && this.map.highGround.length ? ' <i>★</i>' : '';
      this.labels.setHtml('cursor', spot.ok ? `${loc(spot.name)}${star}` : this.spotFailText(spot.reason));
      this.labels.setClass('cursor', spot.ok ? 'lbl-slot' : 'lbl-slot is-bad');
      this.labels.setVisible('cursor', true);
    } else {
      this.cursor.hide();
      this.labels.setVisible('cursor', false);
    }

    // Кольцо дальности
    if (this.placing && this.hoverSpot?.ok) {
      this.scene.showRange(this.hoverSpot.pos, this.previewRange(this.placing, this.hoverSpot.elevated), ROLE_COLORS[this.placing.role]);
    } else if (this.selected) {
      this.scene.showRange(this.selected.pos, this.selected.stats.range, ROLE_COLORS[this.selected.def.role]);
    } else {
      this.scene.hideRange();
    }
  }
}
