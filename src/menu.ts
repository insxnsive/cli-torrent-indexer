import inquirer from "inquirer";
import chalk from "chalk";
import ora from "ora";
import fs from "fs/promises";

import { fileURLToPath } from "url";
import path from "path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import {
  searchLocalDatabases,
  searchFitgirlTorrent,
  calculateSimilarity,
  GameEntry,
} from "./search";
import { downloadTorrent } from "./download";
import { checkProviders } from "./providers";

// Main function – performs game search and download
export async function main(
  presetGameName?: string,
  presetDownloadPath?: string
) {
  if (!presetGameName) {
    await checkProviders();
  }
  let query: string;
  if (presetGameName) {
    query = presetGameName;
  } else {
    const answer = await inquirer.prompt([
      {
        type: "input",
        name: "query",
        message: chalk.bold("Enter the name of the game:"),
        validate: (input: string) =>
          input.trim().length > 0 || "Please enter a game name",
      },
    ]);
    query = answer.query;
  }
  const spinner = ora({
    text: "Searching local databases...",
    color: "cyan",
  }).start();
  const localResults = await searchLocalDatabases(query);
  let fitgirlResult: GameEntry | null = await searchFitgirlTorrent(query);
  if (fitgirlResult) {
    localResults.unshift(fitgirlResult);
  }
  if (localResults.length === 0) {
    spinner.fail("No game found in local databases or on FitGirl Repacks.");
    return;
  }
  spinner.succeed("Local databases search complete.");
  localResults.sort(
    (a, b) =>
      calculateSimilarity(query, b.title) - calculateSimilarity(query, a.title)
  );
  let selectedGame: GameEntry;
  if (localResults.length > 1) {
    const { chosenIndex } = await inquirer.prompt([
      {
        type: "list",
        name: "chosenIndex",
        message: chalk.bold("Multiple games found. Select one:"),
        choices: [
          ...localResults.map((game, index) => ({
            name: `${index + 1}. ${
              index === 0 && fitgirlResult ? "⭐ Top Result: " : ""
            }${game.title} ${game.source ? chalk.dim(`(${game.source})`) : ""}`,
            value: index,
          })),
          { name: "0. Go Back", value: -1 },
        ],
      },
    ]);
    if (chosenIndex === -1) return;
    selectedGame = localResults[chosenIndex];
  } else {
    selectedGame = localResults[0];
  }
  spinner.stop();

  let resolvedPath: string;
  if (presetDownloadPath) {
    resolvedPath = path.resolve(presetDownloadPath);
  } else {
    const { downloadPath } = await inquirer.prompt([
      {
        type: "input",
        name: "downloadPath",
        message: chalk.bold("Enter the download path:"),
        default: process.cwd(),
        validate: async (input: string) => {
          try {
            await fs.access(input);
            return true;
          } catch {
            return "Invalid path. Please enter a valid directory.";
          }
        },
      },
    ]);
    resolvedPath = path.resolve(downloadPath);
  }

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
        choices: selectedGame.uris.map((uri, index) => ({
          name: `${index + 1}. ${uri}`,
          value: uri,
        })),
      },
    ]);
    selectedMagnetLink = chosenUri;
  } else {
    selectedMagnetLink = selectedGame.uris[0];
  }
  console.log(chalk.bold("\n📦 Game Details:"));
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
}

// List games from a folder
export async function listGames(): Promise<void> {
  const configPath = path.join(__dirname, "../games-folder.json");
  let gamesFolder: string;
  try {
    const configRaw = await fs.readFile(configPath, "utf-8");
    const config = JSON.parse(configRaw);
    gamesFolder = config.gamesFolder;
  } catch (error) {
    const answer = await inquirer.prompt([
      {
        type: "input",
        name: "gamesFolder",
        message: chalk.bold("Enter the path for your games folder:"),
        default: process.cwd(),
      },
    ]);
    gamesFolder = answer.gamesFolder;
    await fs.writeFile(configPath, JSON.stringify({ gamesFolder }, null, 2));
  }
  let folders: string[] = [];
  try {
    const dirents = await fs.readdir(gamesFolder, { withFileTypes: true });
    folders = dirents.filter((dir) => dir.isDirectory()).map((dir) => dir.name);
  } catch (error) {
    console.error(chalk.red("Error reading your games folder:"), error);
    return;
  }
  if (folders.length === 0) {
    console.log(
      chalk.bold("No game folders found in the specified games folder.")
    );
    return;
  }
  const { selected } = await inquirer.prompt([
    {
      type: "list",
      name: "selected",
      message: chalk.bold("Select a game folder:"),
      choices: [
        ...folders.map((folder, index) => `${index + 1}. ${folder}`),
        new inquirer.Separator("------------"),
        "0. Back",
      ],
    },
  ]);
  if (selected === "0. Back") return;
  const { action } = await inquirer.prompt([
    {
      type: "list",
      name: "action",
      message: chalk.bold(
        `What do you want to do with "${selected.replace(/^\d+\.\s/, "")}"?`
      ),
      choices: ["1. Reinstall", "2. Uninstall", "3. Back"],
    },
  ]);
  if (action === "3. Back") return;
  const folderPath = path.join(gamesFolder, selected.replace(/^\d+\.\s/, ""));
  if (action === "2. Uninstall") {
    await fs.rm(folderPath, { recursive: true, force: true });
    console.log(
      chalk.bold(
        `Game folder '${selected.replace(/^\d+\.\s/, "")}' uninstalled.`
      )
    );
  } else if (action === "1. Reinstall") {
    await fs.rm(folderPath, { recursive: true, force: true });
    console.log(
      chalk.bold(
        `Game folder '${selected.replace(
          /^\d+\.\s/,
          ""
        )}' removed. Reinstalling...`
      )
    );
    await main(selected.replace(/^\d+\.\s/, ""), gamesFolder);
  }
}

// New function to explicitly set the games folder
async function setGamesFolder(): Promise<void> {
  const configPath = path.join(__dirname, "../games-folder.json");
  const { gamesFolder } = await inquirer.prompt([
    {
      type: "input",
      name: "gamesFolder",
      message: chalk.bold("Enter a new path for your games folder:"),
      default: process.cwd(),
    },
  ]);
  await fs.writeFile(configPath, JSON.stringify({ gamesFolder }, null, 2));
  console.log(chalk.green("Games folder updated successfully."));
}

// Show main menu
export async function showMenu(): Promise<void> {
  let exit = false;
  while (!exit) {
    const { option } = await inquirer.prompt([
      {
        type: "list",
        name: "option",
        message: chalk.bold("Select an option:"),
        choices: [
          "1. Search Games",
          "2. List Games",
          "3. Add Provider",
          "4. Set Games Folder",
          "5. Exit",
        ],
      },
    ]);
    switch (option) {
      case "1. Search Games":
        await main();
        break;
      case "2. List Games":
        await listGames();
        break;
      case "3. Add Provider":
        const { add } = await inquirer.prompt({
          type: "list",
          name: "add",
          message: "Do you want to add a new provider?",
          choices: ["1. Yes", "2. No"],
        });
        if (add === "1. Yes") {
          const { addProvider } = await import("./providers");
          await addProvider();
        }
        break;
      case "4. Set Games Folder":
        await setGamesFolder();
        break;
      case "5. Exit":
        exit = true;
        break;
    }
  }
}
