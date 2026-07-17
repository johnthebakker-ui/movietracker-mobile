import type { MediaSummary } from "./types";

type FranchiseMatch = { name: string; explicit: boolean };

const universeRules: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bharry potter\b/i, "Harry Potter Collection"], [/\bplanet of the apes\b/i, "Planet of the Apes Collection"],
  [/\bhunger games\b|\bballad of songbirds\b|\bsunrise on the reaping\b/i, "The Hunger Games Collection"],
  [/\blord of the rings\b|\bthe hobbit\b/i, "The Lord of the Rings Collection"], [/\bmaze runner\b/i, "Maze Runner Collection"],
  [/\bpirates of the caribbean\b/i, "Pirates of the Caribbean Collection"], [/\bpurge\b/i, "The Purge Collection"],
  [/\bnow you see me\b/i, "Now You See Me Collection"], [/\bdivergent\b|\binsurgent\b|\ballegiant\b/i, "Divergent Collection"],
  [/\bthe conjuring\b|\bannabelle\b|\bthe nun\b|\bla llorona\b/i, "The Conjuring Universe"], [/\binsidious\b/i, "Insidious Collection"],
  [/\bhappy death day\b/i, "Happy Death Day Collection"], [/\bevil dead\b|\barmy of darkness\b/i, "Evil Dead Collection"],
  [/\bsmile\b/i, "Smile Collection"], [/\ba quiet place\b/i, "A Quiet Place Collection"], [/\bdon'?t breathe\b/i, "Don't Breathe Collection"],
  [/\bfinal destination\b/i, "Final Destination Collection"], [/\bfear street\b/i, "Fear Street Collection"], [/\bscream\b/i, "Scream Collection"],
  [/\bhalloween\b/i, "Halloween Collection"], [/\bfriday the 13th\b/i, "Friday the 13th Collection"],
  [/\bnightmare on elm street\b|\bfreddy'?s dead\b|\bnew nightmare\b/i, "A Nightmare on Elm Street Collection"],
  [/\bterrifier\b/i, "Terrifier Collection"], [/\bthe strangers\b|\bstrangers:/i, "The Strangers Collection"],
  [/\bhell house llc\b/i, "Hell House LLC Collection"], [/\bv\/h\/s\b|\bvhs\b/i, "V/H/S Collection"],
  [/\bparanormal activity\b/i, "Paranormal Activity Collection"], [/\bsinister\b/i, "Sinister Collection"],
  [/\bthe ring\b|\brings\b/i, "The Ring Collection"], [/\bthe grudge\b|\bju on\b/i, "The Grudge Collection"],
  [/\bescape room\b/i, "Escape Room Collection"], [/\bcloverfield\b/i, "Cloverfield Collection"],
  [/\b28 days later\b|\b28 weeks later\b|\b28 years later\b/i, "28 Days Later Collection"], [/\bsaw\b|\bjigsaw\b/i, "Saw Collection"],
  [/\balien\b|\bprometheus\b|\balien covenant\b/i, "Alien Collection"], [/\bpredator\b|\bprey\b/i, "Predator Collection"],
  [/\bjurassic park\b|\bjurassic world\b/i, "Jurassic Park Collection"], [/\bmission:?\s*impossible\b/i, "Mission: Impossible Collection"],
  [/\bjohn wick\b|\bballerina\b/i, "John Wick Collection"],
  [/\bfast (and|&) furious\b|\bfast furious\b|\bfast x\b|\bf9\b|\bhobbs\b.*\bshaw\b/i, "Fast & Furious Collection"],
  [/\bgodzilla\b|\bkong\b|\bskull island\b/i, "Monsterverse Collection"], [/\bstar wars\b/i, "Star Wars Collection"],
  [/\bindiana jones\b/i, "Indiana Jones Collection"],
  [/\bavatar\b.*\b(last airbender|legend of aang)\b|\blegend of korra\b/i, "Avatar: The Last Airbender Collection"],
  [/\battack on titan\b/i, "Attack on Titan Collection"], [/\bchainsaw man\b/i, "Chainsaw Man Collection"],
  [/\bwreck it ralph\b|\bralph breaks the internet\b/i, "Wreck-It Ralph Collection"], [/\bincredibles\b/i, "The Incredibles Collection"],
  [/\bice age\b/i, "Ice Age Collection"], [/\bmadagascar\b/i, "Madagascar Collection"],
  [/\btoy story\b/i, "Toy Story Collection"], [/\bkung fu panda\b/i, "Kung Fu Panda Collection"],
  [/\bmonsters,?\s*(inc\.?|university|at work)\b/i, "Monsters, Inc. Collection"],
  [/\bzootopia\b|\bzootropolis\b/i, "Zootopia Collection"],
  [/\bhow to train your dragon\b/i, "How to Train Your Dragon Collection"],
  [/\bfinding (nemo|dory)\b/i, "Finding Nemo Collection"], [/^cars(?:\s+\d+)?$/i, "Cars Collection"]
];

export function listFranchiseName(item: MediaSummary): FranchiseMatch | null {
  const manual = item.franchiseGroup?.trim();
  if (manual) return { name: manual, explicit: true };
  const title = item.title.toLowerCase().replace(/[-_]/g, " ");
  const match = universeRules.find(([pattern]) => pattern.test(title));
  if (match) return { name: match[1], explicit: false };
  return item.collectionName ? { name: item.collectionName, explicit: false } : null;
}

export function groupFranchises(items: MediaSummary[]) {
  const groups = new Map<string, MediaSummary[]>();
  const explicit = new Set<string>();
  const other: MediaSummary[] = [];
  items.forEach(item => {
    const match = listFranchiseName(item);
    if (!match) return void other.push(item);
    if (match.explicit) explicit.add(match.name);
    groups.set(match.name, [...(groups.get(match.name) ?? []), item]);
  });
  for (const [name, group] of groups) {
    if (group.length < 2 && !explicit.has(name)) {
      groups.delete(name);
      other.push(...group);
    }
  }
  if (other.length) groups.set("Other titles", other);
  return groups;
}
