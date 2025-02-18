import axios from "axios";
import fs from "fs/promises";
import inquirer from "inquirer";
import chalk from "chalk";

import { fileURLToPath } from "url";
import path from "path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const JSON_FOLDER = path.resolve(__dirname, "../JSON");

export async function addProvider(): Promise<void> {
  let addMore = true;
  while (addMore) {
    const { providerUrl } = await inquirer.prompt({
      type: "input",
      name: "providerUrl",
      message:
        "Open this URL: https://hydralinks.cloud\nSelect Copy Link on your desired game provider and paste it here:",
    });
    if (!providerUrl.startsWith("https://hydralinks.cloud/sources/")) {
      console.log(
        chalk.red(
          "Invalid URL. Please input a URL that starts with https://hydralinks.cloud/sources/"
        )
      );
      continue;
    }
    try {
      const response = await axios.get(providerUrl);
      const segments = providerUrl.split("/");
      const fileName = segments[segments.length - 1];
      const writePath = path.join(JSON_FOLDER, fileName);
      await fs.writeFile(writePath, JSON.stringify(response.data, null, 2));
      console.log(chalk.green(`Provider ${fileName} added.`));
    } catch (err) {
      console.error(chalk.red("Error fetching provider:"), err);
    }
    const { proceed } = await inquirer.prompt({
      type: "list",
      name: "proceed",
      message: "Do you want to proceed to search games or add more providers?",
      choices: ["1. Proceed", "2. Add More"],
    });
    if (proceed === "1. Proceed") {
      addMore = false;
    }
  }
}

export async function checkProviders(): Promise<void> {
  try {
    await fs.access(JSON_FOLDER);
  } catch {
    await fs.mkdir(JSON_FOLDER, { recursive: true });
  }
  const files = await fs.readdir(JSON_FOLDER);
  const jsonFiles = files.filter((f) => f.endsWith(".json"));
  if (jsonFiles.length === 0) {
    const { download } = await inquirer.prompt({
      type: "list",
      name: "download",
      message:
        "Seems like you don't have any providers set. Would you like to download all the game libraries available?",
      choices: ["1. Yes", "2. No"],
    });
    if (download === "1. Yes") {
      await addProvider();
    }
  }
}
