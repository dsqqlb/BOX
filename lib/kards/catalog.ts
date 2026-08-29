import { KardsCard, KardsCatalog } from './types';

export function cardImageUrl(path: string): string {
  return encodeURI(path);
}

export function buildCardMap(cards: KardsCard[]): Map<string, KardsCard> {
  return new Map(cards.map((card) => [card.id, card]));
}

export interface CardFilter {
  q: string;
  faction: string | null;
  cost: number | null;
}

export function filterCards(cards: KardsCard[], filter: CardFilter): KardsCard[] {
  const query = filter.q.trim().toLowerCase();
  return cards.filter((card) => {
    if (filter.faction && card.faction !== filter.faction) return false;
    if (filter.cost !== null && card.cost !== filter.cost) return false;
    if (query && !card.name.toLowerCase().includes(query) && !card.slug.toLowerCase().includes(query)) return false;
    return true;
  });
}

export function dominantFaction(cards: string[], cardMap: Map<string, KardsCard>): string | null {
  const counts = new Map<string, number>();
  for (const id of cards) {
    const card = cardMap.get(id);
    if (!card || card.faction === '中立') continue;
    counts.set(card.faction, (counts.get(card.faction) || 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [faction, count] of counts) {
    if (count > bestCount) {
      best = faction;
      bestCount = count;
    }
  }
  return best;
}

export function cardCounts(cards: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of cards) counts.set(id, (counts.get(id) || 0) + 1);
  return counts;
}

export function catalogIsReady(catalog: KardsCatalog | null): catalog is KardsCatalog {
  return !!catalog && catalog.cards.length > 0;
}
