import type { Grid } from "./grid";
import type { Stats } from "./stats";

export interface GoalProgress {
  label: string;
  /** 0..1 */
  progress: number;
  done: boolean;
  detail: string;
}

export interface Scenario {
  id: string;
  name: string;
  blurb: string;
  goals(stats: Stats, grid: Grid): GoalProgress[];
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const pct = (n: number) => `${Math.round(n * 100)}%`;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

function homesGoal(stats: Stats, target: number): GoalProgress {
  return {
    label: `Add ${fmt(target)} homes`,
    progress: clamp01(stats.net / target),
    done: stats.net >= target,
    detail: `${fmt(stats.net)} / ${fmt(target)}`,
  };
}

function transitShareGoal(stats: Stats, target: number): GoalProgress {
  const share = stats.transitShare ?? 0;
  return {
    label: `${pct(target)} of new homes within ½ mile of a station`,
    progress: clamp01(share / target),
    done: stats.added > 0 && share >= target,
    detail: stats.transitShare === null ? "—" : pct(share),
  };
}

/** MBTA Communities Act "rapid transit communities" (Boston is exempt from the law). */
const RAPID_TRANSIT_COMMUNITIES = [
  "Braintree",
  "Brookline",
  "Cambridge",
  "Chelsea",
  "Everett",
  "Malden",
  "Medford",
  "Milton",
  "Newton",
  "Quincy",
  "Revere",
  "Somerville",
];

export const SCENARIOS: Scenario[] = [
  {
    id: "home-for-everyone",
    name: "A Home for Everyone",
    blurb:
      "The state's 2025 housing plan says Massachusetts needs 222,000 more homes by 2035. Find room for them.",
    goals: (stats) => [homesGoal(stats, 222_000)],
  },
  {
    id: "transit-first",
    name: "Transit First",
    blurb: "Add 150,000 homes, and put nearly all of them within a short walk of the T.",
    goals: (stats) => [homesGoal(stats, 150_000), transitShareGoal(stats, 0.8)],
  },
  {
    id: "no-sprawl",
    name: "No Sprawl",
    blurb:
      "Hit the 222,000-home target without paving over farms and forests: build where people already live.",
    goals: (stats) => [
      homesGoal(stats, 222_000),
      {
        label: "Fewer than 5,000 homes in rural areas",
        progress: stats.added > 0 ? clamp01(1 - stats.addedGreenfield / 5000) : 0,
        done: stats.added > 0 && stats.addedGreenfield < 5000,
        detail: `${fmt(stats.addedGreenfield)} in rural areas`,
      },
    ],
  },
  {
    id: "rapid-transit-communities",
    name: "Rapid Transit Communities",
    blurb:
      "Inspired by the MBTA Communities Act's 25% standard: grow the housing stock of all 12 rapid transit communities by a quarter.",
    goals: (stats, grid) => {
      const met = RAPID_TRANSIT_COMMUNITIES.map((name) => {
        const t = grid.towns.indexOf(name);
        const growth = stats.towns.get(t)?.growth ?? 0;
        return { name, growth };
      });
      const done = met.filter((m) => m.growth >= 0.25);
      const behind = met
        .filter((m) => m.growth < 0.25)
        .map((m) => `${m.name} ${pct(m.growth)}`)
        .join(", ");
      return [
        {
          label: "Each community grows by 25%",
          progress: done.length / met.length,
          done: done.length === met.length,
          detail: `${done.length} / ${met.length}${behind ? ` · still to go: ${behind}` : ""}`,
        },
      ];
    },
  },
  {
    id: "sandbox",
    name: "Sandbox",
    blurb: "No goals. Upzone, downzone, build the city you want.",
    goals: () => [],
  },
];

export function getScenario(id: string): Scenario {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
}
