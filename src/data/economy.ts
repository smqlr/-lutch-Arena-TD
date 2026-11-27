/**
 * Мета-экономика: кредиты и гемы.
 * Курс: 100 гемов = 10 000 кредитов (1 гем = 100 кредитов). Обмен только в одну сторону: гемы → кредиты.
 * Гемы зарабатываются просмотром рекламы: каждые ADS_PER_GEM_REWARD просмотров дают GEM_REWARD гемов.
 */

export const CREDITS_PER_GEM = 100;
/** Кредиты за один просмотр рекламы из меню */
export const AD_CREDITS = 100;
/** Сколько просмотров рекламы (любой — из меню, эйрдроп, удвоение) нужно для награды гемами */
export const ADS_PER_GEM_REWARD = 10;
export const GEM_REWARD = 25;
/** Пакеты обмена гемов на кредиты */
export const GEM_PACKS = [10, 50, 100] as const;
/** Награда за прохождение обучения */
export const TUTORIAL_CREDITS = 200;
export const TUTORIAL_GEMS = 5;

/** Цена в гемах для покупки за гемы (юниты, карты) */
export function gemPrice(credits: number): number {
  return Math.max(1, Math.ceil(credits / CREDITS_PER_GEM));
}
