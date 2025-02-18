import WebTorrent from "webtorrent";
import cliProgress from "cli-progress";
import chalk from "chalk";

// Helper to format ms into "Xh Ym Zs"
function formatDuration(durationMs: number): string {
  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  let parts = [];
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(" ");
}

export async function downloadTorrent(
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
        " | ETA: {eta_formatted}",
    },
    cliProgress.Presets.shades_classic
  );
  console.log(chalk.bold(`Downloading torrent to: ${downloadPath}`));
  console.log(chalk.bold(`Game: ${gameTitle}`));
  if (source) console.log(chalk.magenta(`Source: ${source}`));
  return new Promise((resolve, reject) => {
    client.add(magnetLink, { path: downloadPath }, (torrent) => {
      console.log(chalk.bold(`Started downloading: ${torrent.name}`));
      bar.start(100, 0, { eta_formatted: "0s" });
      torrent.on("download", () => {
        const progress = Math.floor(torrent.progress * 100);
        const remaining = torrent.timeRemaining;
        // Use check to see if remaining time is valid
        const etaFormatted =
          !remaining || isNaN(remaining) ? "0s" : formatDuration(remaining);
        bar.update(progress, { eta_formatted: etaFormatted });
      });
      torrent.on("done", () => {
        bar.update(100, { eta_formatted: "0s" });
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
