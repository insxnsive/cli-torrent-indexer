import WebTorrent from "webtorrent";
import axios from "axios";
import { parse } from "node-html-parser";
import cliProgress from "cli-progress";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";
import inquirer from "inquirer";
import chalk from "chalk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface GameEntry {
  title: string;
  uris: string[];
  uploadDate?: string;
  fileSize?: string;
  repackLinkSource?: string;
  source?: string;
}

const BASE_URL = "https://fitgirl-repacks.site";
const JSON_FOLDER = path.resolve(__dirname, "./JSON");

async function searchLocalDatabases(query: string): Promise<GameEntry[]> {
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
            source: path.parse(file).name, // Use filename as source
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

async function searchFitgirlTorrent(query: string): Promise<GameEntry | null> {
  try {
    const formattedQuery = query.replace(/\s+/g, "-").toLowerCase();
    const url = `${BASE_URL}/${formattedQuery}`;
    console.log(chalk.bold(`Searching for '${query}' on FitGirl Repacks...`));
    const response = await axios.get(url);
    const root = parse(response.data);
    const magnetLink = root
      .querySelector('a[href^="magnet:"]')
      ?.getAttribute("href");

    if (!magnetLink) {
      return null;
    }

    return {
      title: query,
      uris: [magnetLink],
      source: "FitGirl Repacks",
    };
  } catch (error: any) {
    if (error.response && error.response.status === 404) {
      console.log(chalk.bold("Game not found on FitGirl Repacks."));
    } else {
      console.error(chalk.red("Error fetching the torrent:"), error.message);
    }
    return null;
  }
}

function calculateSimilarity(query: string, title: string): number {
  const queryWords = query.toLowerCase().split(/\s+/);
  const titleWords = title.toLowerCase().split(/\s+/);
  const commonWords = queryWords.filter((word) => titleWords.includes(word));
  return commonWords.length / queryWords.length;
}

async function downloadTorrent(
  magnetLink: string,
  downloadPath: string,
  gameTitle: string,
  source?: string
): Promise<void> {
  const client = new WebTorrent();
  const bar = new cliProgress.SingleBar(
    {
      format:
        chalk.bold("{bar}") +
        " | " +
        chalk.bold("{percentage}%") +
        " | " +
        chalk.bold("{eta_formatted}") +
        " | " +
        chalk.bold("{speed} MB/s") +
        " | " +
        chalk.bold("ETA: {timeRemaining}"),
    },
    cliProgress.Presets.shades_classic
  );

  console.log(chalk.bold(`Downloading torrent to: ${downloadPath}`));
  console.log(chalk.bold(`Game: ${gameTitle}`));
  if (source) console.log(chalk.magenta(`Source: ${source}`));

  return new Promise((resolve, reject) => {
    client.add(magnetLink, { path: downloadPath }, (torrent) => {
      console.log(chalk.bold(`Started downloading: ${torrent.name}`));
      bar.start(100, 0);

      torrent.on("download", () => {
        const progress = Math.floor(torrent.progress * 100);
        const speed = (torrent.downloadSpeed / 1024 / 1024).toFixed(2); // Convert to MB/s
        const timeRemaining = (torrent.timeRemaining / 1000 / 60).toFixed(2); // Convert to minutes
        bar.update(progress, { speed, timeRemaining });
      });

      torrent.on("done", () => {
        bar.update(100);
        bar.stop();
        console.log(chalk.bold("Download complete!"));
        client.destroy();
        resolve();
      });
    });

    client.on("error", (err: Error) => {
      console.error(chalk.red("Error during download:"), err.message);
      bar.stop();
      client.destroy();
      reject(err);
    });
  });
}

async function main() {
  try {
    const { query } = await inquirer.prompt([
      {
        type: "input",
        name: "query",
        message: chalk.bold("Enter the name of the game:"),
        validate: (input) =>
          input.trim().length > 0 || "Please enter a game name",
      },
    ]);

    const localResults = await searchLocalDatabases(query);

    let fitgirlResult: GameEntry | null = await searchFitgirlTorrent(query);
    if (fitgirlResult) {
      localResults.unshift(fitgirlResult);
    }

    if (localResults.length === 0) {
      console.log(
        chalk.bold("No game found in local databases or on FitGirl Repacks.")
      );
      return;
    }

    // Sort results by similarity to the query
    localResults.sort(
      (a, b) =>
        calculateSimilarity(query, b.title) -
        calculateSimilarity(query, a.title)
    );

    let selectedGame: GameEntry;
    if (localResults.length > 1) {
      const { chosenIndex } = await inquirer.prompt([
        {
          type: "list",
          name: "chosenIndex",
          message: chalk.bold("Multiple games found. Select one:"),
          choices: localResults.map((game, index) => ({
            name: `${index === 0 && fitgirlResult ? "⭐ Top Result: " : ""}${
              game.title
            } ${game.source ? chalk.dim(`(${game.source})`) : ""}`,
            value: index,
          })),
        },
      ]);

      selectedGame = localResults[chosenIndex];
    } else {
      selectedGame = localResults[0];
    }

    const { downloadPath } = await inquirer.prompt([
      {
        type: "input",
        name: "downloadPath",
        message: chalk.bold("Enter the download path:"),
        default: process.cwd(),
        validate: async (input) => {
          try {
            await fs.access(input);
            return true;
          } catch {
            return "Invalid path. Please enter a valid directory.";
          }
        },
      },
    ]);

    const resolvedPath = path.resolve(downloadPath);

    if (!selectedGame || !selectedGame.uris) {
      console.error(
        chalk.red("Error: selectedGame is undefined or missing uris.")
      );
      return;
    }

    let selectedMagnetLink: string;
    if (selectedGame.uris.length > 1) {
      const { chosenUri } = await inquirer.prompt([
        {
          type: "list",
          name: "chosenUri",
          message: chalk.bold("Multiple URIs found. Select one:"),
          choices: selectedGame.uris,
        },
      ]);
      selectedMagnetLink = chosenUri;
    } else {
      selectedMagnetLink = selectedGame.uris[0];
    }

    console.log(chalk.bold.bold("\n📦 Game Details:"));
    console.log(chalk.bold(`Title: ${selectedGame.title}`));
    if (selectedGame.source)
      console.log(chalk.magenta(`Source: ${selectedGame.source}`));
    if (selectedGame.uploadDate)
      console.log(chalk.bold(`Upload Date: ${selectedGame.uploadDate}`));
    if (selectedGame.fileSize)
      console.log(chalk.bold(`File Size: ${selectedGame.fileSize}`));
    if (selectedGame.repackLinkSource)
      console.log(chalk.dim(`Repack Link: ${selectedGame.repackLinkSource}`));

    await downloadTorrent(
      selectedMagnetLink,
      resolvedPath,
      selectedGame.title,
      selectedGame.source
    );
  } catch (error) {
    console.error(chalk.red("An error occurred:"), error);
  }
}

main();
