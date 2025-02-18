import { fileURLToPath } from "url";
import path from "path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import fs from "fs/promises";
import chalk from "chalk";
import axios from "axios";
import { parse } from "node-html-parser";

const JSON_FOLDER = path.resolve(__dirname, "../JSON");

export interface GameEntry {
  title: string;
  uris: string[];
  uploadDate?: string;
  fileSize?: string;
  repackLinkSource?: string;
  source?: string;
}

export async function searchLocalDatabases(
  query: string
): Promise<GameEntry[]> {
  try {
    const jsonFiles = await fs.readdir(JSON_FOLDER);
    let allGames: GameEntry[] = [];
    for (const file of jsonFiles) {
      const databasePath = path.resolve(JSON_FOLDER, file);
      try {
        const rawData = await fs.readFile(databasePath, "utf-8");
        let database: GameEntry[];
        try {
          const parsedData = JSON.parse(rawData);
          if (parsedData.downloads && Array.isArray(parsedData.downloads)) {
            database = parsedData.downloads;
          } else if (Array.isArray(parsedData)) {
            database = parsedData;
          } else {
            console.warn(
              chalk.bold(`Skipping ${file}: Unexpected JSON structure`)
            );
            continue;
          }
          database = database.map((game) => ({
            ...game,
            source: path.parse(file).name,
          }));
          const matchedGames = database.filter((game) =>
            game.title.toLowerCase().includes(query.toLowerCase())
          );
          allGames.push(...matchedGames);
        } catch (parseError) {
          console.error(chalk.red(`Error parsing ${file}:`), parseError);
        }
      } catch (readError) {
        console.error(chalk.red(`Error reading ${file}:`), readError);
      }
    }
    return allGames;
  } catch (error) {
    console.error(chalk.red("Error searching local databases:"), error);
    return [];
  }
}

export async function searchFitgirlTorrent(
  query: string
): Promise<GameEntry | null> {
  // Only one retry
  const maxAttempts = 1;
  let attempt = 0;
  while (attempt < maxAttempts) {
    try {
      const formattedQuery = query.replace(/\s+/g, "-").toLowerCase();
      const url = `https://fitgirl-repacks.site/${formattedQuery}`;
      console.log(`\nSearching for '${query}' on FitGirl Repacks...`);
      const response = await axios.get(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          Referer: "https://fitgirl-repacks.site/",
          "sec-fetch-dest": "document",
          "sec-fetch-mode": "navigate",
          "sec-fetch-site": "none",
          "sec-fetch-user": "?1",
          "sec-ch-ua":
            '"Chromium";v="115", "Not A;Brand";v="99", "Google Chrome";v="115"',
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"Windows"',
        },
      });
      const root = parse(response.data);
      const magnetLink = root
        .querySelector('a[href^="magnet:"]')
        ?.getAttribute("href");
      if (!magnetLink) return null;
      return {
        title: query,
        uris: [magnetLink],
        source: "FitGirl Repacks",
      };
    } catch (error: any) {
      if (error.response && error.response.status === 403) {
        // wait 5 seconds before retrying
        await new Promise((resolve) => setTimeout(resolve, 5000));
        attempt++;
      } else {
        console.error(chalk.red("Error fetching the torrent:"), error);
        return null;
      }
    }
  }
  console.error(
    chalk.red(
      "\nExceeded maximum retries fetching FitGirl Repacks. Make sure you have a disabled VPN."
    )
  );
  return null;
}

export function calculateSimilarity(query: string, title: string): number {
  const queryWords = query.toLowerCase().split(/\s+/);
  const titleWords = title.toLowerCase().split(/\s+/);
  const commonWords = queryWords.filter((word) => titleWords.includes(word));
  return commonWords.length / queryWords.length;
}
