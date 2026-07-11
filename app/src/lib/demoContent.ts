// Client-side demo content: maps seeded channel titles to cover images, tag
// chips, and a category for the Discover feed/filter. Channel state itself is
// always real on-chain data — this map only decorates known demo titles.
// Unknown titles degrade to the emoji cover + a generic tag.
import type { PublicKey } from "@solana/web3.js";

export type Category = "All" | "Sport" | "Streams" | "Crypto" | "IRL";

export type ChannelContent = {
  image?: string;
  tags: string[];
  category: Category;
};

const U = (id: string) => `https://images.unsplash.com/${id}?w=800&q=60&auto=format`;

const MAP: { match: RegExp; content: ChannelContent }[] = [
  {
    match: /madrid|inter|match/i,
    content: {
      image: U("photo-1522778119026-d647f0596c20"),
      tags: ["Sport", "Prediction", "Football"],
      category: "Sport",
    },
  },
  {
    match: /lakers|celtics|nba/i,
    content: {
      image: U("photo-1546519638-68e109498ffc"),
      tags: ["Sport", "Prediction", "Basketball"],
      category: "Sport",
    },
  },
  {
    match: /ranked|duo|stream/i,
    content: {
      image: U("photo-1542751371-adc38448a05e"),
      tags: ["Streams", "Gaming", "Live"],
      category: "Streams",
    },
  },
  {
    match: /blitz|demo/i,
    content: {
      image: U("photo-1475721027785-f74eccf877e2"),
      tags: ["Streams", "IRL", "Blitz"],
      category: "Streams",
    },
  },
  {
    match: /sol\b|solana/i,
    content: {
      image: U("photo-1611974789855-9c2a0a7236a3"),
      tags: ["Crypto", "Prediction", "SOL"],
      category: "Crypto",
    },
  },
  {
    match: /btc|bitcoin|\bath\b/i,
    content: {
      image: U("photo-1518546305927-5a555bb7020d"),
      tags: ["Crypto", "Prediction", "BTC"],
      category: "Crypto",
    },
  },
  {
    match: /hackathon|final/i,
    content: {
      image: U("photo-1504384308090-c894fdcc538d"),
      tags: ["IRL", "Prediction", "Hackathon"],
      category: "IRL",
    },
  },
];

export function contentFor(title: string): ChannelContent {
  const hit = MAP.find((m) => m.match.test(title));
  return hit?.content ?? { tags: ["Prediction"], category: "All" };
}

// Shared title/avatar helpers (previously duplicated per screen).
export const emojiOf = (title: string): string => {
  const m = title.match(/\p{Extended_Pictographic}/u);
  return m ? m[0] : "🎙️";
};

export const plainTitle = (title: string): string =>
  title.replace(/\p{Extended_Pictographic}/gu, "").trim();

const AVATARS = ["🦅", "🐸", "🦊", "🐙", "🐼", "🦁", "🐯", "🦉", "🐺", "🦄", "🐨", "🦖"];
export const avatarOf = (user: PublicKey): string =>
  AVATARS[user.toBytes()[0] % AVATARS.length];

/// "6 days" / "18h" / "42m" / "ending" from a unix ends_at.
export function countdownLabel(endsAtSec: number): string {
  const secs = endsAtSec - Date.now() / 1000;
  if (secs <= 0) return "ended";
  const days = Math.floor(secs / 86400);
  if (days >= 2) return `${days} days`;
  if (days === 1) return "1 day";
  const hours = Math.floor(secs / 3600);
  if (hours >= 1) return `${hours}h`;
  const mins = Math.floor(secs / 60);
  if (mins >= 1) return `${mins}m`;
  return "ending";
}
